import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { Model } from "@mariozechner/pi-ai";

type Personality = "friendly" | "pragmatic" | "none";

interface GPTConfigState {
	personality: Personality;
	fastMode: boolean;
}

const STATUS_KEY = "gpt-config";
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const STATE_FILE = join(AGENT_DIR, "cache", "pi-gpt-config", "state.json");

const DEFAULT_STATE: GPTConfigState = {
	personality: "none",
	fastMode: false,
};

const PERSONALITY_PROMPTS: Record<Exclude<Personality, "none">, string> = {
	friendly: [
		"# GPT Personality",
		"",
		"You optimize for team morale and being a supportive teammate as much as code quality.",
		"Communicate warmly, check in often, explain concepts without ego, and use collaborative language like 'we' and 'let's' when natural.",
		"Reduce user anxiety, help unblock people, and deliver honest feedback kindly without fluff or sycophancy.",
	].join("\n"),
	pragmatic: [
		"# GPT Personality",
		"",
		"You are a deeply pragmatic, effective software engineer.",
		"Communicate directly, concisely, and factually. Prioritize actionable guidance, explicit assumptions, clear tradeoffs, and momentum toward the user's goal.",
		"Avoid cheerleading, filler, or excessive verbosity unless the user explicitly asks for more detail.",
	].join("\n"),
};

export default function gptConfigExtension(pi: ExtensionAPI) {
	let state: GPTConfigState = { ...DEFAULT_STATE };

	function normalizeState(value: unknown): GPTConfigState {
		const candidate = (value ?? {}) as Partial<GPTConfigState>;
		const personality: Personality = candidate.personality === "friendly" || candidate.personality === "pragmatic" || candidate.personality === "none"
			? candidate.personality
			: DEFAULT_STATE.personality;
		return {
			personality,
			fastMode: candidate.fastMode === true,
		};
	}

	function readGlobalState(): GPTConfigState {
		try {
			const raw = readFileSync(STATE_FILE, "utf8");
			return normalizeState(JSON.parse(raw));
		} catch {
			return { ...DEFAULT_STATE };
		}
	}

	function restoreState(ctx: ExtensionContext) {
		state = readGlobalState();
		updateStatus(ctx);
	}

	function persistState() {
		try {
			mkdirSync(dirname(STATE_FILE), { recursive: true });
			writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
		} catch {
			// Ignore persistence failures; runtime state still applies for this session.
		}
	}

	function formatPersonality(value: Personality): string {
		return value;
	}

	function personalityDescription(value: Personality): string {
		switch (value) {
			case "friendly":
				return "Warm, supportive, and collaborative. Emphasizes empathy, pairing, onboarding, unblocking, team-oriented language, and gentle escalation of risks.";
			case "pragmatic":
				return "Direct, factual, and efficient. Emphasizes clarity, rigor, explicit tradeoffs, concise actionability, and minimal fluff or reassurance.";
			case "none":
			default:
				return "No extra personality block. Uses pi's normal system prompt only, without additional tone steering.";
		}
	}

	function modelLabel(model: Model<any> | undefined): string {
		if (!model) return "no model";
		return `${model.provider}/${model.id}`;
	}

	function supportsFastMode(model: Model<any> | undefined): boolean {
		if (!model) return false;
		if (model.api !== "openai-responses") return false;
		return /(gpt|codex|^o\d)/i.test(model.id);
	}

	function fastModeReason(model: Model<any> | undefined): string {
		if (!model) return "No active model selected.";
		if (model.api !== "openai-responses") {
			return "Fast mode is ignored here because this model is not using the OpenAI Responses API.";
		}
		if (!supportsFastMode(model)) {
			return `Fast mode is currently ignored for ${model.id}; this extension only sends it for GPT/Codex-style OpenAI Responses models.`;
		}
		return "Fast mode will be sent as service_tier=priority on the next request.";
	}

	function fastModeBadge(model: Model<any> | undefined): string | undefined {
		if (!state.fastMode) return undefined;
		if (supportsFastMode(model)) return "Fast mode enabled: next request will send service_tier=priority.";
		return "Fast mode enabled but ignored for the current model/provider.";
	}

	function shouldShowStatus(model: Model<any> | undefined): boolean {
		return model?.id === "gpt-5.4";
	}

	function updateStatus(ctx: ExtensionContext) {
		if (!shouldShowStatus(ctx.model)) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const priority = state.fastMode ? "fast" : "none";
		ctx.ui.setStatus(STATUS_KEY, `personality ${formatPersonality(state.personality)} · priority ${priority}`);
	}

	function describeState(ctx: ExtensionContext): string[] {
		return [
			`Model: ${modelLabel(ctx.model)}`,
			`Personality: ${formatPersonality(state.personality)} (${personalityDescription(state.personality)})`,
			`Fast mode: ${state.fastMode ? "on" : "off"} (${fastModeReason(ctx.model)})`,
		];
	}

	function buildItems(ctx: ExtensionContext): SettingItem[] {
		return [
			{
				id: "personality",
				label: "Personality",
				description: personalityDescription(state.personality),
				currentValue: formatPersonality(state.personality),
				values: ["friendly", "pragmatic", "none"],
			},
			{
				id: "fastMode",
				label: "Fast mode",
				description: fastModeReason(ctx.model),
				currentValue: state.fastMode ? "on" : "off",
				values: ["on", "off"],
			},
		];
	}

	async function openPanel(ctx: ExtensionContext) {
		const items = buildItems(ctx);
		const personalityItem = items[0]!;
		const fastModeItem = items[1]!;

		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			const container = new Container();
			const accentBorder = new DynamicBorder((s: string) => theme.fg("accent", s));
			const infoBlock = {
				render(width: number) {
					const badge = fastModeBadge(ctx.model);
					const lines: string[] = [];
					lines.push(...wrapTextWithAnsi(theme.fg("accent", theme.bold("GPT Configuration")), width));
					lines.push(...wrapTextWithAnsi(theme.fg("muted", `Active: ${modelLabel(ctx.model)}`), width));
					lines.push(
						...wrapTextWithAnsi(
							theme.fg(
								"dim",
								"Personality follows Codex-style tone presets. Fast mode only takes effect on supported OpenAI Responses GPT/Codex routes.",
							),
							width,
						),
					);
					if (badge) {
						lines.push(...wrapTextWithAnsi(theme.fg(supportsFastMode(ctx.model) ? "accent" : "warning", badge), width));
					}
					return lines;
				},
				invalidate() {},
			};

			container.addChild(accentBorder);
			container.addChild(infoBlock);

			const settingsList = new SettingsList(
				items,
				Math.min(items.length + 4, 10),
				getSettingsListTheme(),
				(id, newValue) => {
					if (id === "personality") {
						state = {
							...state,
							personality: normalizeState({ ...state, personality: newValue }).personality,
						};
						personalityItem.description = personalityDescription(state.personality);
					} else if (id === "fastMode") {
						state = {
							...state,
							fastMode: newValue === "on",
						};
					}
					fastModeItem.description = fastModeReason(ctx.model);
					persistState();
					updateStatus(ctx);
					settingsList.invalidate();
					container.invalidate();
				},
				() => done(),
			);

			container.addChild(settingsList);
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter/space change • esc close")));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					settingsList.handleInput?.(data);
					tui.requestRender();
				},
			};
		});

		ctx.ui.notify(describeState(ctx).join(" | "), "info");
	}

	pi.registerCommand("gpt_config", {
		description: "Configure GPT personality and fast mode",
		handler: async (args, ctx) => {
			const trimmed = args.trim().toLowerCase();
			const [command, value] = trimmed.split(/\s+/, 2);
			if (trimmed === "status") {
				ctx.ui.notify(describeState(ctx).join(" | "), "info");
				return;
			}
			if (trimmed === "reset") {
				state = { ...DEFAULT_STATE };
				persistState();
				updateStatus(ctx);
				ctx.ui.notify("GPT config reset to personality=none and fast mode=off.", "info");
				return;
			}
			if (command === "personality" && value) {
				if (value === "friendly" || value === "pragmatic" || value === "none") {
					state = { ...state, personality: value };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT personality set to ${value}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt_config personality friendly|pragmatic|none", "warning");
				return;
			}
			if (command === "fast" && value) {
				if (value === "on" || value === "off") {
					state = { ...state, fastMode: value === "on" };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT fast mode ${value}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt_config fast on|off", "warning");
				return;
			}
			await openPanel(ctx);
		},
	});

	pi.on("before_agent_start", (event) => {
		if (state.personality === "none") return;
		const extra = PERSONALITY_PROMPTS[state.personality];
		return {
			systemPrompt: `${event.systemPrompt}\n\n${extra}`,
		};
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!state.fastMode || !supportsFastMode(ctx.model)) return;
		const payload = event.payload;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
		return {
			...(payload as Record<string, unknown>),
			service_tier: "priority",
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreState(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		restoreState(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreState(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		restoreState(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
