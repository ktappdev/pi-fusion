# pi-fusion

A configurable pi extension that replicates OpenRouter's Fusion behavior using
the authed models pi already has access to.

## What it does

When you invoke the `fusion` tool (or run `/fusion`), pi:

1. Picks a panel of authed models (configurable, default is a diverse panel).
2. Sends your prompt to each model in parallel.
3. Sends all panel responses to a judge model.
4. The judge returns structured analysis:
   - **consensus** — points most models agree on
   - **contradictions** — disagreements with each model's stance
   - **partial_coverage** — points only some models covered
   - **unique_insights** — ideas raised by a single model
   - **blind_spots** — topics no panel model addressed
5. The outer model receives the analysis and raw responses and writes a final answer.

If no config exists, it auto-picks a diverse panel from `ctx.modelRegistry.getAvailable()`.

## Installation

### npm package

```bash
pi install npm:pi-fusion
```

### GitHub package

```bash
pi install git:github.com/syntheticrecon/pi-fusion
```

### Local development checkout

```bash
git clone https://github.com/syntheticrecon/pi-fusion.git
cd pi-fusion
npm install
npm run check
npm test
pi -e .
```

Or install a local checkout into pi:

```bash
pi install /path/to/pi-fusion
```

Run `/reload` in an existing pi session after changing or installing the extension.

## Configuration

Create one of:

- `~/.pi/agent/fusion.json` (global)
- `<cwd>/.pi/fusion.json` (project-local, overrides global)

Project-local `fusion.json` is only loaded for trusted projects.

Quick-start:

```
/fusion-setup     # choose panel and judge via UI
/fusion           # toggle forced Fusion mode on/off
/fusion-status    # show current mode, panel, and judge
```

Optional config template:

```
/fusion-init      # creates .pi/fusion.json template
/fusion-config    # show active config
```

Example `fusion.json`:

```json
{
  "panel": [
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-4.1",
    "google/gemini-2.5-pro"
  ],
  "judge": "anthropic/claude-opus-4-5",
  "maxPanelModels": 3,
  "maxPanelOutputTokens": 2048,
  "maxCompletionTokens": 4096,
  "temperature": 0.3
}
```

### Configuration fields

| Field | Default | Description |
|-------|---------|-------------|
| `panel` | auto-diverse | Array of model identifiers in `provider/id` form. Only authed models are used. |
| `judge` | current model, then first panel model | Model identifier in `provider/id` form. |
| `maxPanelModels` | 3 | Max panel size (1–8). |
| `maxPanelOutputTokens` | 2048 | Max tokens per panel response. |
| `maxCompletionTokens` | 4096 | Max tokens for the judge analysis. |
| `temperature` | 0.3 | Sampling temperature for panel and judge. |

If no config is provided, fusion picks a diverse panel from authed models.

## Usage

### As a tool

Ask the agent to use it:

```
Use fusion to compare the pros and cons of REST vs GraphQL for a new API.
```

The model calls the `fusion` tool, receives the structured analysis, and
answers from multiple perspectives.

### Slash commands

Daily use is intentionally small:

- `/fusion-setup` — choose panel and judge.
- `/fusion` — toggle between `available` and `forced` mode.
- `/fusion off` — fully disable fusion for the session; model tool calls are blocked.
- `/fusion available` — allow the active model to decide when fusion is useful.
- `/fusion forced` — force every normal prompt through fusion.
- `/fusion <prompt>` — force Fusion for one prompt, then let the active pi model answer normally.
- `/fusion-status` — show current mode, panel, and judge.

Advanced/debug commands remain available:

- `/fusion-report <prompt>` — run fusion directly and write the raw diagnostic panel/judge report into the editor.
- `/fusion-config` — view file config + session selection in a native settings list.
- `/fusion-init` — generate `.pi/fusion.json` (confirms before overwriting).

`/fusion-setup` controls:
  - **Type** to search/filter models.
  - **Tab** switches focus between search box and list.
  - **↑/↓** navigate the list (works from either focus).
  - **p** or **Space** toggles a model into/out of the panel.
  - **j** sets the highlighted model as judge (press again on the same model to unset).
  - **c** clears all selections.
  - **Enter** confirms.
  - **Esc** cancels.
### Simple workflow

Configure once:

```
/fusion-setup
```

Set session mode:

```
/fusion available # model-decided use
/fusion forced    # force every normal prompt through fusion
/fusion off       # fully disable/block fusion
```

`/fusion` with no arguments toggles between `available` and `forced`.

When mode is `forced`, normal prompts are automatically routed through the fusion tool before the active pi model answers.

When mode is `available`, the `fusion` tool is available and the active model may invoke it when the task genuinely benefits from multiple perspectives, critique, research, comparison, or expensive-to-be-wrong analysis.

When mode is `off`, fusion tool calls are blocked for the session.

Force Fusion once without changing the toggle:

```
/fusion <prompt>
```

### Overrides and context

Override the configured panel or judge per-call:

```
Please use the fusion tool with analysis_models ["anthropic/claude-sonnet-4-5", "openai/gpt-4.1"] and model "anthropic/claude-opus-4-5" to analyze whether we should migrate to Next.js App Router.
```

Panel and judge calls do not automatically see the whole pi conversation thread. The active model keeps the thread and decides what to send to fusion.

When prior conversation context matters, the model can either include the relevant context directly in `prompt` or ask fusion to include recent turns:

```json
{
  "prompt": "Evaluate the architecture decision we just discussed.",
  "context_mode": "recent",
  "context_turns": 6
}
```

`context_mode` defaults to `"none"`. `context_turns` is clamped to 1–10 and defaults to 4. The judge receives the same context-expanded task text the panel saw, plus the panel responses.

## How models are resolved

- `provider/id` identifiers are resolved with `ModelRegistry.find(provider, id)`.
- Identifiers without a `provider/` prefix are matched by exact model `id` across all providers.
- Only models that pass `registry.hasConfiguredAuth(model)` are used.
- If an explicitly configured panel model is not authed, it is skipped with a warning.

## Session state

`/fusion-setup` saves the selected panel and judge in the session. `/fusion` saves the current mode (`available`, `forced`, or `off`). On `/resume`, the extension restores the last selection and footer state.

Use `/fusion off` to fully disable/block fusion for the session.

## Development

```bash
npm install   # installs peer deps for type checking
npm run check # TypeScript --noEmit
npm test      # runs the test files under src/__tests__/
npm pack --dry-run
```

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the GitHub issue templates.

## Differences from OpenRouter Fusion

- Uses pi's authed models instead of OpenRouter's catalog.
- Does not inject `openrouter:web_search` or `openrouter:web_fetch` into panel/judge calls (pi has its own tools; the outer model can still use them).
- No recursion-depth header is needed because inner calls use `complete()` directly and never see the `fusion` tool.
- Adds interactive panel/judge selection via `/fusion-setup`.
- Adds session modes: `available`, `forced`, and `off`.
- Adds config validation, diagnostic reports, and session-state persistence.
