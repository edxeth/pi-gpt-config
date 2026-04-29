# pi-gpt-config

https://github.com/user-attachments/assets/3e29b8f1-1b48-4a51-89c0-0c070c83cd70

Adds a `/gpt-config` command to pi for **Codex-parity settings** on four models only:
- `gpt-5.3-codex`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.5`

Outside those four models, every setting in this extension is a **no-op**.

## Install

```bash
pi install git:github.com/edxeth/pi-gpt-config
```

## Controls
- `Fast mode`: `on`, `off` (only shown for `gpt-5.3-codex`, `gpt-5.4`, and `gpt-5.5`)
- `Personality`: `none`, `friendly`, `pragmatic`, `claude`
- `Verbosity`: `low`, `medium`, `high`
- `Reasoning summary`: `none`, `auto`, `concise`, `detailed`
- `Tool discipline`: `off`, `on`
- `Footer`: `show`, `hide`

## Behavior
- `Fast mode` requests OpenAI priority service tier on models that support it.
- `Personality` controls the compact tone overlay:
  - `none`: model/pi default tone with no extra overlay
  - `friendly`: warmer, more collaborative (50-token overlay)
  - `pragmatic`: more direct, factual, compact (54-token overlay)
  - `claude`: Claude Code-style short, direct communication based on Claude Code tone/output-efficiency guidance (73-token overlay)
- Non-`none` personalities append one compact `<personality>` system-prompt overlay for the current agent turn.
- `Verbosity` controls answer length.
- `Reasoning summary` controls whether a summarized reasoning trace is requested back from the API. It does **not** disable internal reasoning.
- `Tool discipline` adds a native-tool system-prompt contract that treats shell substitutions for Pi's built-in `find`, `grep`, `read`, `edit`, and `write` tools as task failures. When enabled, it adds a 260-token overlay.
- For serious work, set `personality`, `verbosity`, `summary`, and `toolDiscipline` before starting. If you change one mid-session, start a fresh session or reload; these settings affect the model request/system prompt lifecycle. `Fast mode` is the exception because it only requests priority service tier, and `Footer` is UI-only.

## Defaults on parity models
- `Fast mode`: `off` on models that support priority service tier
- `Personality`: `none`
- `Verbosity`: `medium`
- `Reasoning summary`: `auto`
- `Tool discipline`: `off`
- `Footer`: `show`

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
/gpt-config discipline off
/gpt-config discipline on
/gpt-config footer show
/gpt-config footer hide
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
    "summary": "auto",
    "toolDiscipline": "off",
    "showFooter": true
  }
}
```

Legacy state from `~/.pi/agent/cache/pi-gpt-config/state.json` is migrated on load.

## TUI
- The panel explains what each setting does.
- The panel hides `Fast mode` on `gpt-5.4-mini`.
- The footer shows:
  - `priority`, `personality`, and tool discipline status on `gpt-5.3-codex`, `gpt-5.4`, and `gpt-5.5`
  - `personality` and tool discipline status on `gpt-5.4-mini`
- The footer is only shown on the four parity models.

## Notes
- This extension mixes native API controls (`service_tier`, `text.verbosity`, `reasoning.summary`) with prompt/tool policy overlays (`personality`, `toolDiscipline`). `gpt-5.4-mini` gets the verbosity/summary/personality/tool-discipline behavior but not `service_tier`.
- `personality=none` means no extra prompt overlay.
- `personality=claude` is a compact Claude Code-style overlay, not provider-native Claude mode or full Claude Code prompt parity.
- Personality and tool-discipline overlays are intentionally small deltas instead of full alternate system prompts, preserving pi's harness instructions and reducing repeated prompt-token cost.
- Avoid toggling model-behavior settings mid-session for serious work. Set `personality`, `verbosity`, `summary`, and `toolDiscipline` first, then start a fresh session or reload. `Fast mode` is safe to toggle mid-session because it only changes priority service tier; `Footer` is UI-only.
- Backend support still depends on the upstream provider honoring the request fields.
