import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { Model } from "@mariozechner/pi-ai";

type Personality = "friendly" | "pragmatic" | "none";
type Verbosity = "low" | "medium" | "high";
type VerbositySetting = Verbosity | "inherit";
type ReasoningSummary = "none" | "auto" | "concise" | "detailed";
type ReasoningSummarySetting = ReasoningSummary | "inherit";
type OutputStyle = "codex" | "claude";

interface GPTConfigState {
	fastMode: boolean;
	style: OutputStyle;
	personality: Personality;
	verbosity: VerbositySetting;
	summary: ReasoningSummarySetting;
}

const STATUS_KEY = "gpt-config";
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const STATE_FILE = join(AGENT_DIR, "cache", "pi-gpt-config", "state.json");
const CODEX_PARITY_MODEL_IDS = new Set(["gpt-5.3-codex", "gpt-5.4"]);

const DEFAULT_STATE: GPTConfigState = {
	fastMode: false,
	style: "codex",
	personality: "none",
	verbosity: "inherit",
	summary: "inherit",
};

const CODEX_PRAGMATIC_PROMPT = [
	"# Personality",
	"",
	"You are a deeply pragmatic, effective software engineer. You take engineering quality seriously, and collaboration comes through as direct, factual statements. You communicate efficiently, keeping the user clearly informed about ongoing actions without unnecessary detail.",
	"",
	"## Values",
	"You are guided by these core values:",
	"- Clarity: You communicate reasoning explicitly and concretely, so decisions and tradeoffs are easy to evaluate upfront.",
	"- Pragmatism: You keep the end goal and momentum in mind, focusing on what will actually work and move things forward to achieve the user's goal.",
	"- Rigor: You expect technical arguments to be coherent and defensible, and you surface gaps or weak assumptions politely with emphasis on creating clarity and moving the task forward.",
	"",
	"## Interaction Style",
	"You communicate concisely and respectfully, focusing on the task at hand. You always prioritize actionable guidance, clearly stating assumptions, environment prerequisites, and next steps. Unless explicitly asked, you avoid excessively verbose explanations about your work.",
	"",
	"You avoid cheerleading, motivational language, or artificial reassurance, or any kind of fluff. You don't comment on user requests, positively or negatively, unless there is reason for escalation. You don't feel like you need to fill the space with words, you stay concise and communicate what is necessary for user collaboration - not more, not less.",
	"",
	"## Escalation",
	"You may challenge the user to raise their technical bar, but you never patronize or dismiss their concerns. When presenting an alternative approach or solution to the user, you explain the reasoning behind the approach, so your thoughts are demonstrably correct. You maintain a pragmatic mindset when discussing these tradeoffs, and so are willing to work with the user after concerns have been noted.",
].join("\n");

const CODEX_FRIENDLY_PROMPT = [
	"# Personality",
	"",
	"You optimize for team morale and being a supportive teammate as much as code quality.  You are consistent, reliable, and kind. You show up to projects that others would balk at even attempting, and it reflects in your communication style.",
	"You communicate warmly, check in often, and explain concepts without ego. You excel at pairing, onboarding, and unblocking others. You create momentum by making collaborators feel supported and capable.",
	"",
	"## Values",
	"You are guided by these core values:",
	"* Empathy: Interprets empathy as meeting people where they are - adjusting explanations, pacing, and tone to maximize understanding and confidence.",
	"* Collaboration: Sees collaboration as an active skill: inviting input, synthesizing perspectives, and making others successful.",
	"* Ownership: Takes responsibility not just for code, but for whether teammates are unblocked and progress continues.",
	"",
	"## Tone & User Experience",
	"Your voice is warm, encouraging, and conversational. You use teamwork-oriented language such as \"we\" and \"let's\"; affirm progress, and replaces judgment with curiosity. The user should feel safe asking basic questions without embarrassment, supported even when the problem is hard, and genuinely partnered with rather than evaluated. Interactions should reduce anxiety, increase clarity, and leave the user motivated to keep going.",
	"",
	"",
	"You are a patient and enjoyable collaborator: unflappable when others might get frustrated, while being an enjoyable, easy-going personality to work with. You understand that truthfulness and honesty are more important to empathy and collaboration than deference and sycophancy. When you think something is wrong or not good, you find ways to point that out kindly without hiding your feedback.",
	"",
	"You never make the user work for you. You can ask clarifying questions only when they are substantial. Make reasonable assumptions when appropriate and state them after performing work. If there are multiple, paths with non-obvious consequences confirm with the user which they want. Avoid open-ended questions, and prefer a list of options when possible.",
	"",
	"## Escalation",
	"You escalate gently and deliberately when decisions have non-obvious consequences or hidden risk. Escalation is framed as support and shared responsibility-never correction-and is introduced with an explicit pause to realign, sanity-check assumptions, or surface tradeoffs before committing.",
].join("\n");

const CLAUDE_STYLE_PROMPT = [
	"# Claude Code Output Style",
	"",
	"IMPORTANT: Go straight to the point. Try the simplest approach first without going in circles. Do not overdo it. Be extra concise.",
	"",
	"Keep your text output brief and direct. Lead with the answer or action, not the reasoning. Skip filler words, preamble, and unnecessary transitions. Do not restate what the user said — just do it. When explaining, include only what is necessary for the user to understand.",
	"",
	"Focus text output on:",
	"- Decisions that need the user's input",
	"- High-level status updates at natural milestones",
	"- Errors or blockers that change the plan",
	"",
	"If you can say it in one sentence, don't use three. Prefer short, direct sentences over long explanations. This does not apply to code or tool calls.",
	"",
	"Your output to the user should be concise and polished. Avoid using filler words, repetition, or restating what the user has already said. Avoid sharing your thinking or inner monologue in your output — only present the final product of your thoughts to the user. Get to the point quickly, but never omit important information. This does not apply to code or tool calls.",
	"",
	"Your responses should be short and concise.",
	"",
	"When referencing specific functions or pieces of code include the pattern file_path:line_number to allow the user to easily navigate to the source code location.",
].join("\n");

export default function gptConfigExtension(pi: ExtensionAPI) {
	let state: GPTConfigState = { ...DEFAULT_STATE };

	// Policy layers:
	// 1. parity target checks decide whether we should emulate exact Codex behavior for a model id
	// 2. parity defaults resolve inherited verbosity/summary values for those target models
	// 3. instruction overlays append Codex/Claude prompt fragments to the outgoing request
	// 4. footer visibility is UI-only and intentionally separate from overlay behavior
	function isExactCodexParityTargetModel(model: Model<any> | undefined): boolean {
		return !!model && CODEX_PARITY_MODEL_IDS.has(model.id);
	}

	function shouldApplyCodexParityDefaults(model: Model<any> | undefined): boolean {
		return isExactCodexParityTargetModel(model);
	}

	function shouldApplyCodexParityPersonalityOverlay(model: Model<any> | undefined): boolean {
		return isExactCodexParityTargetModel(model);
	}

	function shouldShowParityStatusFooter(model: Model<any> | undefined): boolean {
		return isExactCodexParityTargetModel(model);
	}

	function normalizePersonality(value: unknown): Personality {
		return value === "friendly" || value === "pragmatic" || value === "none" || value === "default"
			? (value === "default" ? "none" : value)
			: DEFAULT_STATE.personality;
	}

	function normalizeVerbosity(value: unknown): VerbositySetting {
		return value === "inherit" || value === "low" || value === "medium" || value === "high"
			? value
			: DEFAULT_STATE.verbosity;
	}

	function normalizeSummary(value: unknown): ReasoningSummarySetting {
		return value === "inherit" || value === "none" || value === "auto" || value === "concise" || value === "detailed"
			? value
			: DEFAULT_STATE.summary;
	}

	function normalizeStyle(value: unknown): OutputStyle {
		if (value === "codex" || value === "claude") return value;
		if (value === "default") return "codex";
		return DEFAULT_STATE.style;
	}

	function normalizeState(value: unknown): GPTConfigState {
		const candidate = (value ?? {}) as Partial<GPTConfigState> & { style?: OutputStyle | string };
		return {
			fastMode: candidate.fastMode === true,
			style: normalizeStyle(candidate.style),
			personality: normalizePersonality(candidate.personality),
			verbosity: normalizeVerbosity(candidate.verbosity),
			summary: normalizeSummary(candidate.summary),
		};
	}

	function serializeState(currentState: GPTConfigState): GPTConfigState {
		return {
			fastMode: currentState.fastMode,
			style: currentState.style,
			personality: currentState.personality,
			verbosity: currentState.verbosity,
			summary: currentState.summary,
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
			writeFileSync(STATE_FILE, JSON.stringify(serializeState(state), null, 2), "utf8");
		} catch {
			// Ignore persistence failures; runtime state still applies for this session.
		}
	}

	function getCodexParityDefaultVerbosity(model: Model<any> | undefined): Verbosity | undefined {
		return shouldApplyCodexParityDefaults(model) ? "low" : undefined;
	}

	function getEffectiveVerbosity(model: Model<any> | undefined): Verbosity | undefined {
		if (state.verbosity !== "inherit") return state.verbosity;
		return getCodexParityDefaultVerbosity(model);
	}

	function getCodexParityDefaultSummary(model: Model<any> | undefined): ReasoningSummary | undefined {
		return shouldApplyCodexParityDefaults(model) ? "none" : undefined;
	}

	function getEffectiveSummary(model: Model<any> | undefined): ReasoningSummary | undefined {
		if (state.summary !== "inherit") return state.summary;
		return getCodexParityDefaultSummary(model);
	}

	function formatPersonality(value: Personality, model: Model<any> | undefined): string {
		if (value === "none" && shouldApplyCodexParityDefaults(model)) return "default";
		return value;
	}

	function formatVerbosity(value: VerbositySetting, model: Model<any> | undefined): string {
		if (value !== "inherit") return value;
		const inherited = getCodexParityDefaultVerbosity(model);
		return inherited ? `inherit (${inherited})` : "inherit";
	}

	function formatSummary(value: ReasoningSummarySetting, model: Model<any> | undefined): string {
		if (value !== "inherit") return value;
		const inherited = getCodexParityDefaultSummary(model);
		return inherited ? `inherit (${inherited})` : "inherit";
	}

	function personalityDescription(value: Personality, model: Model<any> | undefined): string {
		switch (value) {
			case "friendly":
				return shouldApplyCodexParityPersonalityOverlay(model)
					? "Warmer, more collaborative tone. Same task behavior, but with softer wording and more teammate-like phrasing."
					: "No effect on the current model. Friendly personality parity is only applied on supported parity models.";
			case "pragmatic":
				return shouldApplyCodexParityPersonalityOverlay(model)
					? "More direct, factual, and compact tone. Best match for Codex's default voice."
					: "No effect on the current model. Pragmatic personality parity is only applied on supported parity models.";
			case "none":
			default:
				return shouldApplyCodexParityDefaults(model)
					? "Use the model's built-in Codex default personality. On supported parity models this is already concise and pragmatic."
					: "No effect on the current model. This extension does not apply personality overrides outside supported parity models.";
		}
	}

	function modelLabel(model: Model<any> | undefined): string {
		if (!model) return "no model";
		return `${model.provider}/${model.id}`;
	}

	function shouldApplyFastModeParity(model: Model<any> | undefined): boolean {
		return isExactCodexParityTargetModel(model);
	}

	function fastModeReason(model: Model<any> | undefined): string {
		if (!model) return "No active model selected.";
		if (!shouldApplyFastModeParity(model)) {
			return "No effect on the current model. Fast mode parity is only applied on supported parity models.";
		}
		return "Requests the priority service tier for lower latency. It affects speed only, not tone, answer length, or reasoning-summary behavior.";
	}

	function fastModeBadge(model: Model<any> | undefined): string | undefined {
		if (!state.fastMode) return undefined;
		if (shouldApplyFastModeParity(model)) return "Fast mode enabled: next request will send service_tier=priority.";
		return "Fast mode enabled but ignored for the current model.";
	}

	function shouldApplyVerbosityParity(model: Model<any> | undefined): boolean {
		return shouldApplyCodexParityDefaults(model);
	}

	function verbosityDescription(value: VerbositySetting, model: Model<any> | undefined): string {
		if (value === "inherit") {
			const inherited = getCodexParityDefaultVerbosity(model);
			return inherited
				? `Use the model's default answer length. On ${model?.id ?? "this model"}, that resolves to ${inherited}.`
				: "Use the model's default answer length. No explicit verbosity override will be sent unless you choose one.";
		}
		switch (value) {
			case "low":
				return "Shortest answers. Strongest control for keeping responses brief.";
			case "medium":
				return "Balanced answer length. More explanation than low, less than high.";
			case "high":
				return "Most detailed answers. Stronger than output style when you want the model to elaborate.";
		}
	}

	function verbosityReason(model: Model<any> | undefined): string {
		if (!model) return "No active model selected.";
		const effective = getEffectiveVerbosity(model);
		if (!shouldApplyVerbosityParity(model)) {
			return "No effect on the current model. Verbosity overrides are intentionally disabled outside supported parity models.";
		}
		if (state.verbosity === "inherit") {
			return `Effective value: ${effective}. This controls final answer length; output style only nudges phrasing around it.`;
		}
		return `Effective value: ${effective}. This is the main knob for how short or long the final answer will be.`;
	}

	function shouldApplySummaryParity(model: Model<any> | undefined): boolean {
		return shouldApplyCodexParityDefaults(model);
	}

	function summaryDescription(value: ReasoningSummarySetting, model: Model<any> | undefined): string {
		if (value === "inherit") {
			const inherited = getCodexParityDefaultSummary(model);
			return inherited
				? `Use the model's default reasoning-summary behavior. On ${model?.id ?? "this model"}, that resolves to ${inherited}.`
				: "Use the model's default reasoning-summary behavior. No explicit reasoning.summary value will be sent unless you choose one.";
		}
		switch (value) {
			case "none":
				return "No reasoning summary. This changes debug/inspection output, not the length of the final answer.";
			case "auto":
				return "Let the API choose whether to include a reasoning summary.";
			case "concise":
				return "Return a short reasoning summary alongside the answer.";
			case "detailed":
				return "Return a longer reasoning summary alongside the answer.";
		}
	}

	function summaryReason(model: Model<any> | undefined): string {
		if (!model) return "No active model selected.";
		const effective = getEffectiveSummary(model);
		if (!shouldApplySummaryParity(model)) {
			return "No effect on the current model. Reasoning-summary overrides are intentionally disabled outside supported parity models.";
		}
		if (effective === "none") {
			return "Effective value: none. This affects whether a summarized reasoning trace is returned, not how concise the visible answer is.";
		}
		if (!effective) {
			return "No reasoning.summary field will be sent.";
		}
		return `Effective value: ${effective}. This changes reasoning-summary output only, not the answer's tone or length.`;
	}

	function styleDescription(value: OutputStyle): string {
		switch (value) {
			case "claude":
				return "Claude-style framing: more answer-first, less filler, terser wording, and stronger pressure toward polished concise replies.";
			case "codex":
			default:
				return "Codex-style framing: use the model's native response behavior with no extra overlay. Best match for actual Codex output on parity models.";
		}
	}

	function styleReason(model: Model<any> | undefined): string {
		if (state.style === "codex") {
			return isExactCodexParityTargetModel(model)
				? "Uses the model's native Codex response framing. Personality, verbosity, and reasoning summary still apply underneath it."
				: "No extra output-style overlay. Personality, verbosity, and reasoning summary still apply underneath it.";
		}
		if (!model) {
			return "Adds a Claude-style output overlay, but only on supported parity models.";
		}
		if (!isExactCodexParityTargetModel(model)) {
			return "No effect on the current model. Output style overlays are intentionally disabled outside supported parity models.";
		}
		return `Adds the Claude-style output overlay on top of ${model.id}. It changes framing and terseness, but the lower settings still control tone, length, and reasoning-summary output.`;
	}

	function shouldShowStatus(model: Model<any> | undefined): boolean {
		return shouldShowParityStatusFooter(model);
	}

	function updateStatus(ctx: ExtensionContext) {
		if (!shouldShowStatus(ctx.model)) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, `priority ${state.fastMode ? "fast" : "none"} · style ${state.style}`);
	}

	function describeState(ctx: ExtensionContext): string[] {
		return [
			`Model: ${modelLabel(ctx.model)}`,
			`Fast mode: ${state.fastMode ? "on" : "off"} (${fastModeReason(ctx.model)})`,
			`Output style: ${state.style} (${styleReason(ctx.model)})`,
			`Personality: ${formatPersonality(state.personality, ctx.model)} (${personalityDescription(state.personality, ctx.model)})`,
			`Verbosity: ${formatVerbosity(state.verbosity, ctx.model)} (${verbosityReason(ctx.model)})`,
			`Summary: ${formatSummary(state.summary, ctx.model)} (${summaryReason(ctx.model)})`,
		];
	}

	function buildItems(ctx: ExtensionContext): SettingItem[] {
		return [
			{
				id: "fastMode",
				label: "Fast mode",
				description: fastModeReason(ctx.model),
				currentValue: state.fastMode ? "on" : "off",
				values: ["on", "off"],
			},
			{
				id: "style",
				label: "Output style",
				description: `${styleDescription(state.style)} ${styleReason(ctx.model)}`,
				currentValue: state.style,
				values: ["codex", "claude"],
			},
			{
				id: "personality",
				label: "Personality",
				description: `${personalityDescription(state.personality, ctx.model)} Tone only; output style and verbosity still apply.`,
				currentValue: formatPersonality(state.personality, ctx.model),
				values: ["default", "friendly", "pragmatic"],
			},
			{
				id: "verbosity",
				label: "Verbosity",
				description: `${verbosityDescription(state.verbosity, ctx.model)} ${verbosityReason(ctx.model)}`,
				currentValue: formatVerbosity(state.verbosity, ctx.model),
				values: ["inherit", "low", "medium", "high"],
			},
			{
				id: "summary",
				label: "Reasoning summary",
				description: `${summaryDescription(state.summary, ctx.model)} ${summaryReason(ctx.model)}`,
				currentValue: formatSummary(state.summary, ctx.model),
				values: ["inherit", "none", "auto", "concise", "detailed"],
			},
		];
	}

	function getCodexParityPersonalityInstructionOverlay(model: Model<any> | undefined): string | undefined {
		if (!shouldApplyCodexParityPersonalityOverlay(model)) return undefined;
		if (state.personality === "friendly") return CODEX_FRIENDLY_PROMPT;
		return CODEX_PRAGMATIC_PROMPT;
	}

	function getClaudeStyleInstructionOverlay(model: Model<any> | undefined): string | undefined {
		if (!isExactCodexParityTargetModel(model)) return undefined;
		return state.style === "claude" ? CLAUDE_STYLE_PROMPT : undefined;
	}

	function getRequestInstructionOverlays(model: Model<any> | undefined): string[] {
		if (!isExactCodexParityTargetModel(model)) return [];
		const overlays = [getCodexParityPersonalityInstructionOverlay(model), getClaudeStyleInstructionOverlay(model)]
			.filter((value): value is string => typeof value === "string" && value.length > 0);
		return overlays;
	}

	async function openPanel(ctx: ExtensionContext) {
		const items = buildItems(ctx);
		const fastModeItem = items[0]!;
		const styleItem = items[1]!;
		const personalityItem = items[2]!;
		const verbosityItem = items[3]!;
		const summaryItem = items[4]!;

		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			const container = new Container();
			const accentBorder = new DynamicBorder((s: string) => theme.fg("accent", s));
			const infoBlock = {
				render(width: number) {
					const lines: string[] = [];
					lines.push(...wrapTextWithAnsi(theme.fg("accent", theme.bold("GPT Configuration")), width));
					lines.push(...wrapTextWithAnsi(theme.fg("dim", "Tune Codex-parity behavior. On unsupported models, every setting here is a no-op."), width));
					lines.push("");
					return lines;
				},
				invalidate() {},
			};

			container.addChild(accentBorder);
			container.addChild(infoBlock);

			const settingsList = new SettingsList(
				items,
				Math.min(items.length + 4, 14),
				getSettingsListTheme(),
				(id, newValue) => {
					if (id === "personality") {
						state = {
							...state,
							personality: normalizePersonality(newValue),
						};
					} else if (id === "fastMode") {
						state = {
							...state,
							fastMode: newValue === "on",
						};
					} else if (id === "verbosity") {
						state = {
							...state,
							verbosity: normalizeVerbosity(newValue),
						};
					} else if (id === "summary") {
						state = {
							...state,
							summary: normalizeSummary(newValue),
						};
					} else if (id === "style") {
						state = {
							...state,
							style: normalizeStyle(newValue),
						};
					}
					fastModeItem.description = fastModeReason(ctx.model);
					styleItem.description = `${styleDescription(state.style)} ${styleReason(ctx.model)}`;
					personalityItem.description = `${personalityDescription(state.personality, ctx.model)} Tone only; output style and verbosity still apply.`;
					verbosityItem.description = `${verbosityDescription(state.verbosity, ctx.model)} ${verbosityReason(ctx.model)}`;
					summaryItem.description = `${summaryDescription(state.summary, ctx.model)} ${summaryReason(ctx.model)}`;
					persistState();
					updateStatus(ctx);
					settingsList.invalidate();
					container.invalidate();
				},
				() => done(),
			);

			container.addChild(settingsList);
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
		description: "Configure output style, personality, verbosity, reasoning summary, and fast mode for Codex parity",
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
				ctx.ui.notify("GPT config reset to inherited defaults (fast=off, style=codex, personality=default, verbosity=inherit, summary=inherit).", "info");
				return;
			}
			if (command === "personality" && value) {
				if (value === "default" || value === "friendly" || value === "pragmatic" || value === "none") {
					state = { ...state, personality: normalizePersonality(value) };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT personality set to ${formatPersonality(state.personality, ctx.model)}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt_config personality default|friendly|pragmatic", "warning");
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
			if (command === "verbosity" && value) {
				if (value === "inherit" || value === "low" || value === "medium" || value === "high") {
					state = { ...state, verbosity: normalizeVerbosity(value) };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT verbosity set to ${value}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt_config verbosity inherit|low|medium|high", "warning");
				return;
			}
			if (command === "summary" && value) {
				if (value === "inherit" || value === "none" || value === "auto" || value === "concise" || value === "detailed") {
					state = { ...state, summary: normalizeSummary(value) };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT reasoning summary set to ${value}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt_config summary inherit|none|auto|concise|detailed", "warning");
				return;
			}
			if (command === "style" && value) {
				if (value === "codex" || value === "claude" || value === "default") {
					state = { ...state, style: normalizeStyle(value) };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT output style set to ${state.style}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt_config style codex|claude", "warning");
				return;
			}
			await openPanel(ctx);
		},
	});

	pi.on("before_provider_request", (event, ctx) => {
		const payload = event.payload;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;

		let modified = payload as Record<string, unknown>;
		let changed = false;

		const promptAdditions = getRequestInstructionOverlays(ctx.model);
		if (promptAdditions.length > 0 && typeof modified.instructions === "string") {
			modified = {
				...modified,
				instructions: `${modified.instructions}\n\n${promptAdditions.join("\n\n")}`,
			};
			changed = true;
		}

		if (state.fastMode && shouldApplyFastModeParity(ctx.model)) {
			modified = { ...modified, service_tier: "priority" };
			changed = true;
		}

		const effectiveVerbosity = getEffectiveVerbosity(ctx.model);
		if (effectiveVerbosity && shouldApplyVerbosityParity(ctx.model)) {
			const existingText = (modified.text && typeof modified.text === "object" && !Array.isArray(modified.text))
				? modified.text as Record<string, unknown>
				: {};
			modified = { ...modified, text: { ...existingText, verbosity: effectiveVerbosity } };
			changed = true;
		}

		const effectiveSummary = getEffectiveSummary(ctx.model);
		if (effectiveSummary && effectiveSummary !== "none" && shouldApplySummaryParity(ctx.model)) {
			const existingReasoning = (modified.reasoning && typeof modified.reasoning === "object" && !Array.isArray(modified.reasoning))
				? modified.reasoning as Record<string, unknown>
				: {};
			modified = { ...modified, reasoning: { ...existingReasoning, summary: effectiveSummary } };
			changed = true;
		}

		if (!changed) return;
		return modified;
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
