# pi-gpt-config

https://github.com/user-attachments/assets/3e29b8f1-1b48-4a51-89c0-0c070c83cd70

Adds a `/gpt-config` command to pi for **Codex-parity settings** on three models only:
- `gpt-5.3-codex`
- `gpt-5.4`
- `gpt-5.4-mini`

Outside those three models, every setting in this extension is a **no-op**.

## Install

```bash
pi install git:github.com/edxeth/pi-gpt-config
```

## Controls
- `Fast mode`: `on`, `off` (only shown for `gpt-5.3-codex` and `gpt-5.4`)
- `Personality`: `none`, `friendly`, `pragmatic`, `claude`
- `Verbosity`: `low`, `medium`, `high`
- `Reasoning summary`: `none`, `auto`, `concise`, `detailed`

## Behavior
- `Fast mode` requests OpenAI priority service tier on models that support it.
- `Personality` is the only prompt-bearing mode:
  - `none`: model's built-in Codex tone with no extra overlay
  - `friendly`: warmer, more collaborative
  - `pragmatic`: more direct, factual, compact
  - `claude`: Claude-inspired answer-first, terse, lower-overengineering, lower-check-in behavior
- Non-`none` personalities are re-injected on every model request, so they add repeated prompt-token cost.
- `Verbosity` controls answer length.
- `Reasoning summary` controls whether a summarized reasoning trace is requested back from the API. It does **not** disable internal reasoning.

## Defaults on parity models
- `Fast mode`: `off` on models that support priority service tier
- `Personality`: `none`
- `Verbosity`: `medium`
- `Reasoning summary`: `auto`

## Command
Open the panel:

```text
/gpt-config
```

Subcommands:

```text
/gpt-config status
/gpt-config reset
/gpt-config fast on
/gpt-config fast off
/gpt-config personality none
/gpt-config personality friendly
/gpt-config personality pragmatic
/gpt-config personality claude
/gpt-config verbosity low
/gpt-config verbosity medium
/gpt-config verbosity high
/gpt-config summary none
/gpt-config summary auto
/gpt-config summary concise
/gpt-config summary detailed
```

## Persistence
State is stored globally in `settings.json` under the `gptConfig` namespace:

```text
~/.pi/agent/settings.json
```

If `PI_CODING_AGENT_DIR` is set:

```text
$PI_CODING_AGENT_DIR/settings.json
```

Persisted shape:

```json
{
  "gptConfig": {
    "fastMode": false,
    "personality": "none",
    "verbosity": "medium",
    "summary": "auto"
  }
}
```

Legacy state from `~/.pi/agent/cache/pi-gpt-config/state.json` is migrated on load.

## TUI
- The panel explains what each setting does.
- The panel hides `Fast mode` on `gpt-5.4-mini`.
- The footer shows:
  - `priority` and `personality` on `gpt-5.3-codex` and `gpt-5.4`
  - `personality` only on `gpt-5.4-mini`
- The footer is only shown on the three parity models.

## Notes
- This extension mixes native API controls (`service_tier`, `text.verbosity`, `reasoning.summary`) with a single prompt overlay mode (`personality`). `gpt-5.4-mini` gets the verbosity/summary/personality behavior but not `service_tier`.
- `personality=none` means no extra prompt overlay.
- `personality=claude` is a Claude-inspired prompt overlay, not provider-native Claude mode or true Claude parity.
- The Claude overlay also counter-pressures Codex-style optional check-ins by preferring autonomous continuation until a real blocker or decision appears.
- Backend support still depends on the upstream provider honoring the request fields.
