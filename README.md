# pi-gpt-config

Adds a `/gpt_config` command to pi for configuring two GPT-oriented behaviors from a TUI panel:

- `Personality`: `none`, `friendly`, `pragmatic`
- `Fast mode`: `on`, `off`

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
```

## Persistence

State is stored in the **current pi session branch** using custom session entries.

Restoration happens on:
- initial session load: `session_start`
- new/resume session: `session_switch`
- fork: `session_fork`
- tree navigation: `session_tree`

Practical behavior:
- same session: settings persist
- `/fork`: settings persist into the fork branch state if present there
- `/tree`: settings follow the selected branch history
- `/new`: new session restores that session's own state, usually defaults
- `/resume`: restores the resumed session's saved state
- pi restart + reopen same session: restores saved state
- completely fresh session: starts from defaults

This is **session-scoped persistence**, not global persistence.

## TUI behavior

The panel uses pi's native custom UI APIs and `SettingsList`.
It also shows a footer status summary like:

```text
GPT cfg: friendly · fast on
```

If fast mode is enabled but unsupported for the current model, the footer shows:

```text
GPT cfg: friendly · fast on*
```

and the panel explains that the current model/provider ignores it.

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
- Fast mode is definitely sent by the extension on supported routes because it mutates the actual outgoing payload.
- Whether the upstream/provider truly honors `service_tier: "priority"` depends on the proxy/backend, not just this extension.
