# pi-gpt-config

Adds a `/gpt_config` command to pi for configuring GPT-oriented behaviors from a TUI panel:

- `Personality`: `none`, `friendly`, `pragmatic`
- `Fast mode`: `on`, `off`
- `Verbosity`: `low`, `medium`, `high`
- `Reasoning summary`: `auto`, `concise`, `detailed`

Extension path:
- `index.ts`

## What it does

### Personality

Personality is implemented as **system-prompt injection**.
It does not rely on a provider-specific API field.

Modes:
- `none`: no extra personality block; uses pi's normal system prompt only
- `friendly`: warmer, more collaborative, more supportive tone
- `pragmatic`: more direct, factual, concise, and tradeoff-oriented tone

Because this is prompt-based, personality applies across models.

### Fast mode

Fast mode is implemented as **provider payload mutation**.
When enabled on supported models, the extension adds:

```json
{
  "service_tier": "priority"
}
```

This matches the backend wire behavior used by Codex for its fast-mode tier.

Fast mode is only sent when the current model looks supported:
- model API is `openai-responses`
- model id looks like a GPT/Codex-style model

Unsupported models are left untouched.

### Verbosity

Verbosity is implemented as **provider payload mutation** using the OpenAI Responses API `text.verbosity` field.
It controls how expansive the final written answer should be — this is about the surface response the user sees, not the hidden reasoning process.

Values:
- `low`: short, concise final answers
- `medium`: balanced output length (API default — no payload modification sent)
- `high`: longer, more detailed final answers

When set to a non-default value, the extension adds:

```json
{
  "text": { "verbosity": "low" }
}
```

Verbosity is only sent when:
- model API is `openai-responses`
- model id looks like a GPT/Codex-style model

Prompts can still further steer output length on top of this setting.

### Reasoning summary

Reasoning summary is implemented as **provider payload mutation** using the OpenAI Responses API `reasoning.summary` field.
It controls whether the API returns a summary of the model's reasoning process — this is for visibility into how the model thinks, not about the final answer length.

Values:
- `auto`: let the API decide whether to include a reasoning summary (API default — no payload modification sent)
- `concise`: include a brief summary of the model's reasoning
- `detailed`: include a thorough summary of the model's reasoning

When set to a non-default value, the extension adds:

```json
{
  "reasoning": { "summary": "concise" }
}
```

Reasoning summary is only sent when:
- model API is `openai-responses`
- model id looks like a GPT/Codex/reasoning-style model (GPT, Codex, o-series)

### How verbosity and summary relate

They are complementary and control different things:

- `reasoning.summary` = "Show me how the model reasoned, in summarized form."
- `text.verbosity` = "How long/detailed should the final answer itself be?"

You can combine them freely. For example:
- Brief final answer with `verbosity: low`, while still getting a reasoning summary via `summary: concise`
- Long final answer with `verbosity: high` and no reasoning summary
- Both, or neither, depending on your use case

## Command

Open the TUI panel:

```text
/gpt_config
```

Non-interactive subcommands:

```text
/gpt_config status
/gpt_config reset
/gpt_config personality friendly
/gpt_config personality pragmatic
/gpt_config personality none
/gpt_config fast on
/gpt_config fast off
/gpt_config verbosity low
/gpt_config verbosity medium
/gpt_config verbosity high
/gpt_config summary auto
/gpt_config summary concise
/gpt_config summary detailed
```

## Persistence

State is stored in a **global JSON file** under pi's cache directory:

- `~/.pi/agent/cache/pi-gpt-config/state.json`

If `PI_CODING_AGENT_DIR` is set, the extension uses:

- `$PI_CODING_AGENT_DIR/cache/pi-gpt-config/state.json`

Restoration happens on:
- initial session load: `session_start`
- new/resume session: `session_switch`
- fork: `session_fork`
- tree navigation: `session_tree`

Practical behavior:
- same session: settings persist
- `/new`: keeps the last saved global config
- `/resume`: keeps the last saved global config
- `/fork`: keeps the last saved global config
- `/tree`: keeps the last saved global config
- pi restart: restores the last saved global config
- completely fresh pi launch: restores the last saved global config if `state.json` exists, otherwise defaults

This is now **global persistence**, not session-scoped persistence.

## TUI behavior

The panel uses pi's native custom UI APIs and `SettingsList`.
On `gpt-5.4`, it also shows a footer status summary like:

```text
personality friendly · priority fast · verbosity low · summary concise
```

Non-default verbosity and summary values are shown; defaults (`medium` / `auto`) are omitted to keep the status bar clean.

If everything is at defaults, the footer shows:

```text
personality none · priority none
```

The footer is hidden for models other than `gpt-5.4`.

## TypeScript / editor support

This extension folder includes:
- `tsconfig.json`
- `package.json`

The local `tsconfig.json` points at pi's globally installed package typings so editors can resolve:
- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-ai`
- `@mariozechner/pi-tui`

## Notes

- Personality is definitely real because it changes the effective system prompt.
- Fast mode, verbosity, and reasoning summary are definitely sent by the extension on supported routes because they mutate the actual outgoing payload.
- Whether the upstream/provider truly honors `service_tier: "priority"`, `text.verbosity`, or `reasoning.summary` depends on the proxy/backend, not just this extension.
- The extension safely spreads into existing `text` and `reasoning` objects in the payload, preserving any fields already set by the provider or other extensions (e.g., `reasoning.effort`).
