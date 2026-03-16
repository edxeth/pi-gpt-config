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
- `Personality`: `none`, `friendly`, `pragmatic`, `claude`
- `Verbosity`: `low`, `medium`, `high`
- `Reasoning summary`: `none`, `auto`, `concise`, `detailed`

## Behavior
- `Fast mode` requests OpenAI priority service tier.
- `Personality` is the only prompt-bearing mode:
  - `none`: model's built-in Codex tone with no extra overlay
  - `friendly`: warmer, more collaborative
  - `pragmatic`: more direct, factual, compact
  - `claude`: Claude-inspired answer-first, terse, lower-overengineering, lower-check-in behavior
- Non-`none` personalities are re-injected on every model request, so they add repeated prompt-token cost.
- `Verbosity` controls answer length.
- `Reasoning summary` controls whether a summarized reasoning trace is requested back from the API. It does **not** disable internal reasoning.

## Defaults on parity models
- `Fast mode`: `off`
- `Personality`: `none`
- `Verbosity`: `medium`
- `Reasoning summary`: `auto`

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
/gpt_config personality none
/gpt_config personality friendly
/gpt_config personality pragmatic
/gpt_config personality claude
/gpt_config verbosity low
/gpt_config verbosity medium
/gpt_config verbosity high
/gpt_config summary none
/gpt_config summary auto
/gpt_config summary concise
/gpt_config summary detailed
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
- The footer only shows:
  - `priority`
  - `personality`
- The footer is only shown on the two parity models.

## Notes
- This extension mixes native API controls (`service_tier`, `text.verbosity`, `reasoning.summary`) with a single prompt overlay mode (`personality`).
- `personality=none` means no extra prompt overlay.
- `personality=claude` is a Claude-inspired prompt overlay, not provider-native Claude mode or true Claude parity.
- The Claude overlay also counter-pressures Codex-style optional check-ins by preferring autonomous continuation until a real blocker or decision appears.
- Backend support still depends on the upstream provider honoring the request fields.
