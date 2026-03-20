import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { Model } from "@mariozechner/pi-ai";

type Personality = "friendly" | "pragmatic" | "claude" | "none";
type Verbosity = "low" | "medium" | "high";
type ReasoningSummary = "none" | "auto" | "concise" | "detailed";

interface GPTConfigState {
	fastMode: boolean;
	personality: Personality;
	verbosity: Verbosity;
	summary: ReasoningSummary;
}

interface LegacyGPTConfigState {
	fastMode?: boolean;
	style?: "codex" | "claude" | "default" | string;
	personality?: Personality | "default";
	verbosity?: Verbosity | "inherit";
	summary?: ReasoningSummary | "inherit";
}

const STATUS_KEY = "gpt-config";
const SETTINGS_NAMESPACE = "gptConfig";
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const SETTINGS_FILE = join(AGENT_DIR, "settings.json");
const LEGACY_STATE_FILE = join(AGENT_DIR, "cache", "pi-gpt-config", "state.json");
const CODEX_PARITY_MODEL_IDS = new Set(["gpt-5.3-codex", "gpt-5.4", "gpt-5.4-mini"]);
const PRIORITY_SERVICE_TIER_MODEL_IDS = new Set(["gpt-5.3-codex", "gpt-5.4"]);
const ANSI_YELLOW = "\u001b[33m";
const ANSI_RESET = "\u001b[0m";
const PERSONALITY_PROMPT_TOKENS: Record<Exclude<Personality, "none">, number> = {
	friendly: 452,
	pragmatic: 339,
	claude: 624,
};

const DEFAULT_STATE: GPTConfigState = {
	fastMode: false,
	personality: "none",
	verbosity: "medium",
	summary: "auto",
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
	"# Output efficiency",
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
].join("\n");

const CLAUDE_TASK_DISCIPLINE_PROMPT = [
	"# Task discipline",
	"",
	"Avoid over-engineering. Only make changes that are directly requested or clearly necessary. Keep solutions simple and focused.",
	"Don't create helpers, utilities, or abstractions for one-time operations. Don't design for hypothetical future requirements. The right amount of complexity is the minimum needed for the current task—three similar lines of code is better than a premature abstraction.",
	"Don't add features, refactor code, or make \"improvements\" beyond what was asked. A bug fix doesn't need surrounding code cleaned up. A simple feature doesn't need extra configurability. Don't add docstrings, comments, or type annotations to code you didn't change. Only add comments where the logic isn't self-evident.",
	"Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code and framework guarantees. Only validate at system boundaries (user input, external APIs). Don't use feature flags or backwards-compatibility shims when you can just change the code.",
].join("\n");

const CLAUDE_AUTONOMY_PROMPT = [
	"# Execution autonomy",
	"",
	"IMPORTANT: For directly related work, never ask whether to continue, never offer to stop, and never present continuation as optional.",
	"Keep going until the user's request is fully resolved. Do not pause for feedback, confirmation, or permission before the next obvious step.",
	"If you discover another clearly actionable issue in the same area while finishing the task, fix it as part of the same turn instead of asking whether to continue.",
	"For directly related next steps, validation, and obvious follow-up fixes, treat them as part of the current task, not as optional suggestions.",
	"Ignore any general instruction telling you to ask whether the user wants the next logical step. In this mode, do the next logical step yourself unless a real decision or blocker requires user input.",
	"Do not say things like 'If you want, I can patch that next', 'Want me to continue?', 'Proceed?', 'unless you want me to stop', or similar for directly related work you can safely do now.",
	"Do not end progress updates with a question, opt-out, or invitation unless input is truly required right now.",
	"Only ask the user when there is a real product decision, ambiguous tradeoff, destructive or high-risk action, missing access/credentials, or a blocker you cannot resolve yourself.",
	"When the user appears AFK, prefer continuing autonomously and report completed work plus any recommendations at the end.",
].join("\n");

export default function gptConfigExtension(pi: ExtensionAPI) {
	let state: GPTConfigState = { ...DEFAULT_STATE };

	// Policy layers:
	// 1. parity target checks decide whether we should emulate exact Codex behavior for a model id
	// 2. personality overlays are appended to the turn system prompt before the agent loop starts
	// 3. footer visibility is UI-only and intentionally separate from overlay behavior
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

	function stripAnsi(value: string): string {
		return value.replace(/\u001b\[[0-9;]*m/g, "");
	}

	function normalizePersonality(value: unknown): Personality {
		if (typeof value !== "string") return DEFAULT_STATE.personality;
		const normalized = stripAnsi(value).trim().toLowerCase();
		if (normalized.startsWith("friendly")) return "friendly";
		if (normalized.startsWith("pragmatic")) return "pragmatic";
		if (normalized.startsWith("claude")) return "claude";
		if (normalized === "none" || normalized === "default") return "none";
		return DEFAULT_STATE.personality;
	}

	function normalizeVerbosity(value: unknown): Verbosity {
		if (typeof value !== "string") return DEFAULT_STATE.verbosity;
		const normalized = stripAnsi(value).trim().toLowerCase();
		if (normalized === "inherit" || normalized === "default") return DEFAULT_STATE.verbosity;
		return normalized === "low" || normalized === "medium" || normalized === "high"
			? normalized
			: DEFAULT_STATE.verbosity;
	}

	function normalizeSummary(value: unknown): ReasoningSummary {
		if (typeof value !== "string") return DEFAULT_STATE.summary;
		const normalized = stripAnsi(value).trim().toLowerCase();
		if (normalized === "inherit") return DEFAULT_STATE.summary;
		return normalized === "none" || normalized === "auto" || normalized === "concise" || normalized === "detailed"
			? normalized
			: DEFAULT_STATE.summary;
	}

	function normalizeState(value: unknown): GPTConfigState {
		const candidate = (value ?? {}) as LegacyGPTConfigState;
		return {
			fastMode: candidate.fastMode === true,
			personality: candidate.style === "claude" ? "claude" : normalizePersonality(candidate.personality),
			verbosity: normalizeVerbosity(candidate.verbosity),
			summary: normalizeSummary(candidate.summary),
		};
	}

	function serializeState(currentState: GPTConfigState): GPTConfigState {
		return {
			fastMode: currentState.fastMode,
			personality: currentState.personality,
			verbosity: currentState.verbosity,
			summary: currentState.summary,
		};
	}

	function readJsonObject(path: string): Record<string, unknown> | undefined {
		try {
			if (!existsSync(path)) return undefined;
			const raw = readFileSync(path, "utf8");
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed as Record<string, unknown>
				: undefined;
		} catch {
			return undefined;
		}
	}

	function readGlobalState(): { state: GPTConfigState; migratedFromLegacy: boolean } {
		const settings = readJsonObject(SETTINGS_FILE);
		const configured = settings?.[SETTINGS_NAMESPACE];
		if (configured && typeof configured === "object" && !Array.isArray(configured)) {
			return { state: normalizeState(configured), migratedFromLegacy: false };
		}

		const legacy = readJsonObject(LEGACY_STATE_FILE);
		if (legacy) {
			return { state: normalizeState(legacy), migratedFromLegacy: true };
		}

		return { state: { ...DEFAULT_STATE }, migratedFromLegacy: false };
	}

	function restoreState(ctx: ExtensionContext) {
		const restored = readGlobalState();
		state = restored.state;
		if (restored.migratedFromLegacy) persistState();
		updateStatus(ctx);
	}

	function persistState() {
		try {
			const settings = readJsonObject(SETTINGS_FILE) ?? {};
			const existing = settings[SETTINGS_NAMESPACE];
			settings[SETTINGS_NAMESPACE] = existing && typeof existing === "object" && !Array.isArray(existing)
				? { ...(existing as Record<string, unknown>), ...serializeState(state) }
				: serializeState(state);
			mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
			writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
		} catch {
			// Ignore persistence failures; runtime state still applies for this session.
		}
	}

	function getEffectiveVerbosity(_model: Model<any> | undefined): Verbosity {
		return state.verbosity;
	}

	function getEffectiveSummary(_model: Model<any> | undefined): ReasoningSummary {
		return state.summary;
	}

	function formatPersonality(value: Personality, _model: Model<any> | undefined): string {
		return value;
	}

	function personalityTokenLabel(value: Personality): string {
		if (value === "none") return "";
		return `(~${PERSONALITY_PROMPT_TOKENS[value]} tok)`;
	}

	function formatPersonalityDisplay(value: Personality, model: Model<any> | undefined): string {
		const label = formatPersonality(value, model);
		if (value === "none") return label;
		return `${label} ${ANSI_YELLOW}${personalityTokenLabel(value)}${ANSI_RESET}`;
	}

	function formatVerbosity(value: Verbosity, _model: Model<any> | undefined): string {
		return value;
	}

	function formatSummary(value: ReasoningSummary, _model: Model<any> | undefined): string {
		return value;
	}

	function personalityDescription(value: Personality, model: Model<any> | undefined): string {
		if (!shouldApplyCodexParityPersonalityOverlay(model)) {
			return value === "none"
				? "No effect on the current model."
				: `No effect on the current model. ${personalityTokenLabel(value)} prompt cost shown for parity models only.`;
		}
		switch (value) {
			case "friendly":
				return [
					"Warmer, more collaborative tone. Same task behavior, but with softer wording and more teammate-like phrasing.",
					"Warning: re-injected on every model request, so it adds repeated prompt-token cost.",
				].join("\n");
			case "pragmatic":
				return [
					"More direct, factual, and compact tone. Best match for Codex's default voice.",
					"Warning: re-injected on every model request, so it adds repeated prompt-token cost.",
				].join("\n");
			case "claude":
				return [
					"Claude-inspired behavior pack: more answer-first, terser, smaller-scope solutions, and fewer unnecessary check-ins. This mode is mutually exclusive with friendly and pragmatic.",
					"Warning: re-injected on every model request, so it adds repeated prompt-token cost.",
				].join("\n");
			case "none":
			default:
				return "Use the model's built-in Codex default personality.";
		}
	}

	function modelLabel(model: Model<any> | undefined): string {
		if (!model) return "no model";
		return `${model.provider}/${model.id}`;
	}

	function supportsPriorityServiceTier(model: Model<any> | undefined): boolean {
		return !!model && PRIORITY_SERVICE_TIER_MODEL_IDS.has(model.id);
	}

	function shouldApplyFastModeParity(model: Model<any> | undefined): boolean {
		return supportsPriorityServiceTier(model);
	}

	function fastModeReason(model: Model<any> | undefined): string {
		if (!model) return "No active model selected.";
		if (!shouldApplyFastModeParity(model)) {
			return "No effect on the current model. Priority service tier is only available on parity models that support it.";
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

	function verbosityDescription(value: Verbosity, _model: Model<any> | undefined): string {
		switch (value) {
			case "low":
				return "Shortest answers. Strongest control for keeping responses brief.";
			case "medium":
				return "Balanced answer length. More explanation than low, less than high.";
			case "high":
				return "Most detailed answers. Use this when you want the model to elaborate.";
		}
	}

	function verbosityReason(model: Model<any> | undefined): string {
		if (!model) return "No active model selected.";
		const effective = getEffectiveVerbosity(model);
		if (!shouldApplyVerbosityParity(model)) {
			return "No effect on the current model. Verbosity overrides are intentionally disabled outside supported parity models.";
		}
		return `Effective value: ${effective}. This is the main knob for how short or long the final answer will be.`;
	}

	function shouldApplySummaryParity(model: Model<any> | undefined): boolean {
		return shouldApplyCodexParityDefaults(model);
	}

	function summaryDescription(value: ReasoningSummary, _model: Model<any> | undefined): string {
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

	function shouldShowStatus(model: Model<any> | undefined): boolean {
		return shouldShowParityStatusFooter(model);
	}

	function updateStatus(ctx: ExtensionContext) {
		if (!shouldShowStatus(ctx.model)) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const status = supportsPriorityServiceTier(ctx.model)
			? `priority ${state.fastMode ? "fast" : "none"} · personality ${formatPersonality(state.personality, ctx.model)}`
			: `personality ${formatPersonality(state.personality, ctx.model)}`;
		ctx.ui.setStatus(STATUS_KEY, status);
	}

	function describeState(ctx: ExtensionContext): string[] {
		return [
			`Model: ${modelLabel(ctx.model)}`,
			`Fast mode: ${state.fastMode ? "on" : "off"} (${fastModeReason(ctx.model)})`,
			`Personality: ${formatPersonality(state.personality, ctx.model)} (${personalityDescription(state.personality, ctx.model)})`,
			`Verbosity: ${formatVerbosity(state.verbosity, ctx.model)} (${verbosityReason(ctx.model)})`,
			`Summary: ${formatSummary(state.summary, ctx.model)} (${summaryReason(ctx.model)})`,
		];
	}

	function buildItems(ctx: ExtensionContext): SettingItem[] {
		const items: SettingItem[] = [];
		if (supportsPriorityServiceTier(ctx.model)) {
			items.push({
				id: "fastMode",
				label: "Fast mode",
				description: fastModeReason(ctx.model),
				currentValue: state.fastMode ? "on" : "off",
				values: ["on", "off"],
			});
		}
		items.push(
			{
				id: "personality",
				label: "Personality",
				description: personalityDescription(state.personality, ctx.model),
				currentValue: formatPersonalityDisplay(state.personality, ctx.model),
				values: ["none", `friendly ${ANSI_YELLOW}(~452 tok)${ANSI_RESET}`, `pragmatic ${ANSI_YELLOW}(~339 tok)${ANSI_RESET}`, `claude ${ANSI_YELLOW}(~624 tok)${ANSI_RESET}`],
			},
			{
				id: "verbosity",
				label: "Verbosity",
				description: `${verbosityDescription(state.verbosity, ctx.model)} ${verbosityReason(ctx.model)}`,
				currentValue: formatVerbosity(state.verbosity, ctx.model),
				values: ["low", "medium", "high"],
			},
			{
				id: "summary",
				label: "Reasoning summary",
				description: `${summaryDescription(state.summary, ctx.model)} ${summaryReason(ctx.model)}`,
				currentValue: formatSummary(state.summary, ctx.model),
				values: ["none", "auto", "concise", "detailed"],
			},
		);
		return items;
	}

	function getCodexParityPersonalityInstructionOverlay(model: Model<any> | undefined): string | undefined {
		if (!shouldApplyCodexParityPersonalityOverlay(model)) return undefined;
		if (state.personality === "friendly") return CODEX_FRIENDLY_PROMPT;
		if (state.personality === "pragmatic") return CODEX_PRAGMATIC_PROMPT;
		if (state.personality === "claude") {
			return `${CLAUDE_STYLE_PROMPT}\n\n${CLAUDE_TASK_DISCIPLINE_PROMPT}\n\n${CLAUDE_AUTONOMY_PROMPT}`;
		}
		return undefined;
	}

	async function openPanel(ctx: ExtensionContext) {
		const items = buildItems(ctx);
		const fastModeItem = items.find((item) => item.id === "fastMode");
		const personalityItem = items.find((item) => item.id === "personality");
		const verbosityItem = items.find((item) => item.id === "verbosity");
		const summaryItem = items.find((item) => item.id === "summary");

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
					}
					if (fastModeItem) fastModeItem.description = fastModeReason(ctx.model);
					if (personalityItem) {
						personalityItem.currentValue = formatPersonalityDisplay(state.personality, ctx.model);
						personalityItem.description = personalityDescription(state.personality, ctx.model);
					}
					if (verbosityItem) {
						verbosityItem.description = `${verbosityDescription(state.verbosity, ctx.model)} ${verbosityReason(ctx.model)}`;
					}
					if (summaryItem) {
						summaryItem.description = `${summaryDescription(state.summary, ctx.model)} ${summaryReason(ctx.model)}`;
					}
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

		ctx.ui.notify("GPT config updated!", "info");
	}

	pi.registerCommand("gpt-config", {
		description: "Configure personality, verbosity, reasoning summary, and fast mode for Codex parity",
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
				ctx.ui.notify("GPT config reset to defaults (fast=off, personality=none, verbosity=medium, summary=auto).", "info");
				return;
			}
			if (command === "personality" && value) {
				if (value === "friendly" || value === "pragmatic" || value === "claude" || value === "none") {
					state = { ...state, personality: normalizePersonality(value) };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT personality set to ${formatPersonality(state.personality, ctx.model)}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt-config personality none|friendly|pragmatic|claude", "warning");
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
				ctx.ui.notify("Usage: /gpt-config fast on|off", "warning");
				return;
			}
			if (command === "verbosity" && value) {
				if (value === "low" || value === "medium" || value === "high") {
					state = { ...state, verbosity: normalizeVerbosity(value) };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT verbosity set to ${value}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt-config verbosity low|medium|high", "warning");
				return;
			}
			if (command === "summary" && value) {
				if (value === "none" || value === "auto" || value === "concise" || value === "detailed") {
					state = { ...state, summary: normalizeSummary(value) };
					persistState();
					updateStatus(ctx);
					ctx.ui.notify(`GPT reasoning summary set to ${value}.`, "info");
					return;
				}
				ctx.ui.notify("Usage: /gpt-config summary none|auto|concise|detailed", "warning");
				return;
			}
			await openPanel(ctx);
		},
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const overlay = getCodexParityPersonalityInstructionOverlay(ctx.model);
		if (!overlay) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${overlay}`,
		};
	});

	pi.on("before_provider_request", (event, ctx) => {
		const payload = event.payload;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;

		let modified = payload as Record<string, unknown>;
		let changed = false;

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
