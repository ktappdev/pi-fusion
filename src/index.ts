/**
 * pi-fusion: local multi-model deliberation inspired by OpenRouter Fusion.
 *
 * Runs a prompt against a panel of the authed models pi already has access to,
 * then asks a judge model to compare the responses and return structured
 * analysis (consensus, contradictions, partial coverage, unique insights,
 * blind spots). The outer model uses that analysis to write a better final
 * answer.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	configDescription,
	DEFAULT_MAX_COMPLETION_TOKENS,
	DEFAULT_TEMPERATURE,
	generateConfigExample,
	MAX_PANEL_MODELS_HARD_LIMIT,
	validateConfig,
} from "./config.ts";
import { resolveFusionModels, runFusion } from "./fusion.ts";
import { listAuthedModels, modelDisplay, resolveModelIdentifier } from "./models.ts";
import { renderConfigStatus, selectModelFromList, selectPanelAndJudge, showConfigSummary } from "./ui.ts";
import type { FusionOptions } from "./types.ts";

const FusionParams = Type.Object(
	{
		prompt: Type.String({
			description:
				"The question, task, or topic to analyze. Be specific enough for independent models to answer.",
		}),
		analysis_models: Type.Optional(
			Type.Array(
				Type.String({
					description:
						"Optional panel model identifiers in provider/id form (e.g. anthropic/claude-sonnet-4-5). Overrides fusion.json for this call.",
				}),
				{ minItems: 1, maxItems: MAX_PANEL_MODELS_HARD_LIMIT },
			),
		),
		judge_model: Type.Optional(
			Type.String({
				description:
					"Optional judge model identifier in provider/id form. Overrides fusion.json for this call.",
			}),
		),
		max_completion_tokens: Type.Optional(
			Type.Integer({
				description: "Max tokens for each panel response and the judge analysis.",
				default: DEFAULT_MAX_COMPLETION_TOKENS,
			}),
		),
		temperature: Type.Optional(
			Type.Number({
				description: "Sampling temperature for panel and judge calls (0–2).",
				minimum: 0,
				maximum: 2,
				default: DEFAULT_TEMPERATURE,
			}),
		),
	},
	{ description: "Multi-model deliberation parameters" },
);

function persistSessionState(pi: ExtensionAPI, selectedIds: Set<string>, judgeId: string | undefined) {
	pi.appendEntry("fusion-state", {
		selectedIds: Array.from(selectedIds),
		judgeId,
		timestamp: Date.now(),
	});
}

function restoreSessionState(ctx: ExtensionContext): { selectedIds: Set<string>; judgeId: string | undefined } | undefined {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === "fusion-state" && "data" in entry && entry.data) {
			const data = entry.data as { selectedIds?: string[]; judgeId?: string };
			return {
				selectedIds: new Set(data.selectedIds ?? []),
				judgeId: data.judgeId,
			};
		}
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "fusion",
		label: "Fusion",
		description: [
			"Multi-model deliberation tool inspired by OpenRouter Fusion.",
			"Use fusion when a single perspective is not enough: research questions, expert critique, compare/contrast tasks, or decisions where being wrong is expensive.",
			"Runs the prompt against a panel of authed models in parallel, then a judge compares responses and returns structured analysis (consensus, contradictions, partial coverage, unique insights, blind spots).",
			"Configure the panel and judge in ~/.pi/agent/fusion.json or .pi/fusion.json. Without a config, fusion picks a diverse panel from the authed models pi already has access to.",
		].join(" "),
		promptSnippet: "Run multi-model deliberation on complex research, critique, or comparison prompts.",
		promptGuidelines: [
			"Use the fusion tool when the user asks for multiple perspectives, expert critique, research synthesis, or comparison of complex topics.",
			"The fusion tool accepts a prompt and optional model overrides; it does not need file paths unless the prompt itself references them.",
		],
		parameters: FusionParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const options: FusionOptions = {
				analysis_models: params.analysis_models,
				judge_model: params.judge_model,
				max_completion_tokens: params.max_completion_tokens,
				temperature: params.temperature,
			};
			return runFusion(
				ctx.cwd,
				ctx.modelRegistry,
				ctx.model,
				params.prompt,
				ctx.isProjectTrusted(),
				options,
				signal,
				onUpdate,
			);
		},
	});

	pi.registerCommand("fusion", {
		description: "Run multi-model fusion on a prompt",
		handler: async (args, ctx) => {
			const prompt = args.trim();

			if (ctx.mode === "print") {
				if (!prompt) {
					console.log("Usage: /fusion <prompt>");
					return;
				}
				const result = await runFusion(
					ctx.cwd,
					ctx.modelRegistry,
					ctx.model,
					prompt,
					ctx.isProjectTrusted(),
					{},
					ctx.signal,
				);
				console.log(result.content[0].text);
				return;
			}

			if (ctx.mode === "json" || ctx.mode === "rpc") {
				ctx.ui.notify("Fusion command is only available in interactive and print modes", "error");
				return;
			}

			if (!prompt) {
				// No prompt provided: open panel selector, then ask for prompt.
				const available = ctx.modelRegistry.getAvailable().filter((m) => m.input.includes("text"));
				if (available.length === 0) {
					ctx.ui.notify("No authed text models available.", "error");
					return;
				}

				const sessionState = restoreSessionState(ctx);
				const { panel, judge } = await resolveFusionModels(
					ctx.cwd,
					ctx.modelRegistry,
					ctx.model,
					ctx.isProjectTrusted(),
					{},
				);

				const initialSelectedIds = sessionState?.selectedIds ?? new Set(panel.map(modelDisplay));
				const initialJudgeId = sessionState?.judgeId ?? modelDisplay(judge);

				const state = await selectPanelAndJudge(ctx, available, initialSelectedIds, initialJudgeId);
				if (!state || state.selectedIds.size === 0) {
					ctx.ui.notify("Panel selection cancelled", "info");
					return;
				}

				persistSessionState(pi, state.selectedIds, state.judgeId);
				updateStatus(ctx, state.selectedIds, state.judgeId);

				// Now ask for the prompt via editor.
				const promptText = await ctx.ui.editor("Fusion prompt:", "");
				if (!promptText?.trim()) {
					ctx.ui.notify("No prompt entered. Panel saved for this session.", "info");
					return;
				}

				pi.sendUserMessage(`/fusion ${promptText.trim()}`);
				return;
			}

			ctx.ui.setWorkingMessage("Running fusion panel...");
			try {
				const fusionResult = await runFusion(
					ctx.cwd,
					ctx.modelRegistry,
					ctx.model,
					prompt,
					ctx.isProjectTrusted(),
					{},
					ctx.signal,
				);
				ctx.ui.setEditorText(fusionResult.content[0].text);
				ctx.ui.notify("Fusion complete. Result prefilled in editor.", "info");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Fusion failed: ${message}`, "error");
			} finally {
				ctx.ui.setWorkingMessage();
			}
		},
	});

	pi.registerCommand("fusion-config", {
		description: "Validate and display the active fusion configuration",
		handler: async (_args, ctx) => {
			const { loadConfig } = await import("./config.ts");
			const raw = loadConfig(ctx.cwd, ctx.isProjectTrusted());
			const validation = validateConfig(raw);
			const sessionState = restoreSessionState(ctx);

			if (ctx.mode === "print") {
				const lines: string[] = [];
				lines.push("## File Config");
				lines.push(configDescription(validation.config));
				if (sessionState?.selectedIds.size) {
					lines.push("");
					lines.push("## Session Selection");
					lines.push(`Panel: ${Array.from(sessionState.selectedIds).join(", ")}`);
					lines.push(`Judge: ${sessionState.judgeId ?? "auto"}`);
				}
				if (validation.warnings.length) {
					lines.push("");
					lines.push("## Warnings");
					for (const w of validation.warnings) lines.push(`- ${w}`);
				}
				if (validation.errors.length) {
					lines.push("");
					lines.push("## Errors");
					for (const e of validation.errors) lines.push(`- ${e}`);
				}
				console.log(lines.join("\n"));
				return;
			}

			await showConfigSummary(
				ctx,
				validation.config,
				validation.warnings,
				validation.errors,
				sessionState?.selectedIds.size ? Array.from(sessionState.selectedIds) : undefined,
				sessionState?.judgeId,
			);
		},
	});

	pi.registerCommand("fusion-panel", {
		description: "Interactively select the fusion panel and judge",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("fusion-panel requires interactive mode", "error");
				return;
			}

			const available = ctx.modelRegistry.getAvailable().filter((m) => m.input.includes("text"));
			if (available.length === 0) {
				ctx.ui.notify("No authed text models available.", "error");
				return;
			}

			const sessionState = restoreSessionState(ctx);
			const { panel, judge, warnings } = await resolveFusionModels(
				ctx.cwd,
				ctx.modelRegistry,
				ctx.model,
				ctx.isProjectTrusted(),
				{},
			);

			const initialSelectedIds = sessionState?.selectedIds ?? new Set(panel.map(modelDisplay));
			const initialJudgeId = sessionState?.judgeId ?? modelDisplay(judge);

			const state = await selectPanelAndJudge(ctx, available, initialSelectedIds, initialJudgeId);

			if (!state) {
				ctx.ui.notify("Panel selection cancelled", "info");
				return;
			}

			if (state.selectedIds.size === 0) {
				ctx.ui.notify("At least one panel model must be selected", "error");
				return;
			}

			persistSessionState(pi, state.selectedIds, state.judgeId);
			updateStatus(ctx, state.selectedIds, state.judgeId);

			const panelNames = Array.from(state.selectedIds).join(", ");
			const judgeName = state.judgeId ?? Array.from(state.selectedIds)[0];
			ctx.ui.notify(`Panel: ${panelNames}\nJudge: ${judgeName}${warnings.length ? "\nWarnings: " + warnings.join("; ") : ""}`, "info");
		},
	});

	pi.registerCommand("fusion-init", {
		description: "Create a project-local .pi/fusion.json template",
		handler: async (_args, ctx) => {
			if (!ctx.isProjectTrusted()) {
				ctx.ui.notify("Project is not trusted; cannot write project-local config", "error");
				return;
			}

			const configPath = join(ctx.cwd, ".pi", "fusion.json");
			const example = generateConfigExample();
			writeFileSync(configPath, JSON.stringify(example, null, 2) + "\n", "utf8");

			if (ctx.hasUI) {
				const openConfig = await ctx.ui.confirm(
					"Created .pi/fusion.json",
					`Wrote template to ${configPath}. Open it in the editor to customize?`,
				);
				if (openConfig) {
					ctx.ui.setEditorText(JSON.stringify(example, null, 2));
				}
			} else {
				ctx.ui.notify(`Created ${configPath}`, "info");
			}
		},
	});

	pi.registerCommand("fusion-models", {
		description: "Browse authed models and add them to the fusion panel",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("fusion-models requires interactive mode", "error");
				return;
			}

			const available = ctx.modelRegistry.getAvailable().filter((m) => m.input.includes("text"));
			if (available.length === 0) {
				ctx.ui.notify("No authed text models available.", "error");
				return;
			}

			const sessionState = restoreSessionState(ctx);
			let selectedIds = sessionState?.selectedIds ?? new Set<string>();
			let judgeId = sessionState?.judgeId;
			let running = false;

			while (true) {
				const choice = await selectModelFromList(ctx, available, selectedIds, judgeId, !running);
				if (!choice || !choice.identifier) {
					if (selectedIds.size > 0) {
						persistSessionState(pi, selectedIds, judgeId);
						updateStatus(ctx, selectedIds, judgeId);
						ctx.ui.notify(`Saved ${selectedIds.size} panel model(s). Judge: ${judgeId ?? "auto"}`, "info");
					} else {
						ctx.ui.notify("No models selected", "info");
					}
					return;
				}

				const id = choice.identifier;
				if (choice.action === "panel") {
					if (selectedIds.has(id)) {
						selectedIds = new Set(Array.from(selectedIds).filter((x) => x !== id));
						if (judgeId === id) judgeId = undefined;
					} else {
						if (selectedIds.size >= 8) {
							ctx.ui.notify("Panel can have at most 8 models", "warning");
							continue;
						}
						selectedIds = new Set([...selectedIds, id]);
						if (!judgeId) judgeId = id;
					}
				} else if (choice.action === "judge") {
					if (!selectedIds.has(id)) {
						if (selectedIds.size >= 8) {
							ctx.ui.notify("Panel is full. Add this model to the panel first.", "warning");
							continue;
						}
						selectedIds = new Set([...selectedIds, id]);
					}
					judgeId = id;
				} else if (choice.action === "run") {
					if (!selectedIds.has(id)) {
						if (selectedIds.size >= 8) {
							ctx.ui.notify("Panel is full. Cannot add model.", "warning");
							continue;
						}
						selectedIds = new Set([...selectedIds, id]);
						if (!judgeId) judgeId = id;
					}
					persistSessionState(pi, selectedIds, judgeId);
					updateStatus(ctx, selectedIds, judgeId);
					running = true;
					break;
				}
			}

			if (running) {
				const promptText = await ctx.ui.editor("Fusion prompt:", "");
				if (!promptText?.trim()) {
					ctx.ui.notify("No prompt entered. Panel saved for this session.", "info");
					return;
				}
				pi.sendUserMessage(`/fusion ${promptText.trim()}`);
			}
		},
	});

	function updateStatus(
		ctx: ExtensionContext,
		selectedIds: Set<string>,
		judgeId: string | undefined,
	) {
		const panel = Array.from(selectedIds);
		if (panel.length === 0) {
			ctx.ui.setStatus("fusion", undefined);
			ctx.ui.setWidget("fusion-panel", undefined);
			return;
		}
		const judge = judgeId && selectedIds.has(judgeId) ? judgeId : panel[0];
		ctx.ui.setStatus("fusion", `${panel.length} panel model(s), judge: ${judge}`);
		ctx.ui.setWidget("fusion-panel", [
			`Panel: ${panel.join(", ")}`,
			`Judge: ${judge}`,
		]);
	}

	pi.on("session_start", async (_event, ctx) => {
		const state = restoreSessionState(ctx);
		if (state?.selectedIds.size) {
			updateStatus(ctx, state.selectedIds, state.judgeId);
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		const state = restoreSessionState(ctx);
		if (state?.selectedIds.size) {
			updateStatus(ctx, state.selectedIds, state.judgeId);
		}
	});
}
