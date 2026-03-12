# pi-gpt-config

https://github.com/user-attachments/assets/639bccff-e986-4061-b4ff-8f9fe8228feb

Adds a `/gpt_config` command to pi for **Codex-parity settings** on two models only:
- `gpt-5.3-codex`
- `gpt-5.4`

Outside those two models, every setting in this extension is a **no-op**.

## Install

```bash
pi install git:github.com/edxeth/pi-gpt-config
```

## Controls
- `Fast mode`: `on`, `off`
- `Output style`: `codex`, `claude`
- `Personality`: `default`, `friendly`, `pragmatic`
- `Verbosity`: `inherit`, `low`, `medium`, `high`
- `Reasoning summary`: `inherit`, `none`, `auto`, `concise`, `detailed`

## Behavior
- `Fast mode` requests OpenAI priority service tier.
- `Output style` changes answer framing:
  - `codex`: no extra overlay
  - `claude`: adds a Claude-inspired overlay for more answer-first, concise, lower-overengineering, lower-check-in behavior
- `Personality` changes tone:
  - `default`: model's built-in Codex tone with no extra personality overlay
  - `friendly`: warmer, more collaborative
  - `pragmatic`: more direct, factual, compact
- `Verbosity` controls answer length.
- `Reasoning summary` controls whether a summarized reasoning trace is requested back from the API. It does **not** disable internal reasoning.

## Defaults on parity models
- `Fast mode`: `off`
- `Output style`: `codex`
- `Personality`: `default`
- `Verbosity`: `inherit` → effective default `low`
- `Reasoning summary`: `inherit` → effective default `none`

## Command
Open the panel:

```text
/gpt_config
```

Subcommands:

```text
/gpt_config status
/gpt_config reset
/gpt_config fast on
/gpt_config fast off
/gpt_config style codex
/gpt_config style claude
/gpt_config personality default
/gpt_config personality friendly
/gpt_config personality pragmatic
/gpt_config verbosity inherit
/gpt_config verbosity low
/gpt_config verbosity medium
/gpt_config verbosity high
/gpt_config summary inherit
/gpt_config summary none
/gpt_config summary auto
/gpt_config summary concise
/gpt_config summary detailed
```

`/gpt_config personality none` is accepted as a backward-compatible alias for `default`.

## Persistence
State is stored globally at:

```text
~/.pi/agent/cache/pi-gpt-config/state.json
```

If `PI_CODING_AGENT_DIR` is set:

```text
$PI_CODING_AGENT_DIR/cache/pi-gpt-config/state.json
```

Persisted key order matches the TUI:

```json
{
  "fastMode": false,
  "style": "codex",
  "personality": "none",
  "verbosity": "inherit",
  "summary": "inherit"
}
```

## TUI
- The panel explains what each setting does.
- The footer only shows:
  - `priority`
  - `style`
- The footer is only shown on the two parity models.

## Notes
- This extension mixes native API controls (`service_tier`, `text.verbosity`, `reasoning.summary`) with prompt overlays (`codex` personality blocks and `claude` output style).
- `personality=default` / persisted `"none"` now means no extra personality overlay; only explicit `friendly` and `pragmatic` inject tone prompts.
- The `claude` output style is a Claude-inspired prompt overlay, not a provider-native Claude mode or true Claude parity.
- The Claude overlay also counter-pressures Codex-style optional check-ins by preferring autonomous continuation until a real blocker or decision appears.
- Backend support still depends on the upstream provider honoring the request fields.
