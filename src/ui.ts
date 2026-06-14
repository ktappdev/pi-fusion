/**
 * Native pi TUI components for pi-fusion.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSelectListTheme, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Input,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	SettingsList,
	type SettingItem,
	Text,
} from "@earendil-works/pi-tui";
import type { FusionConfig } from "./config.ts";
import { modelDisplay } from "./models.ts";
import type { Api, Model } from "./types.ts";

interface ModelInfo {
	id: string;
	identifier: string;
	provider: string;
	name: string;
}

interface ModelSelectState {
	selectedIds: Set<string>;
	judgeId: string | undefined;
}

function toModelInfo(available: Model<Api>[]): ModelInfo[] {
	return available.map((m) => ({
		id: m.id,
		identifier: modelDisplay(m),
		provider: m.provider,
		name: m.name,
	}));
}

function makeSelectItems(
	models: ModelInfo[],
	selectedIds: Set<string>,
	judgeId: string | undefined,
): SelectItem[] {
	return models.map((m) => {
		const isPanel = selectedIds.has(m.identifier);
		const isJudge = judgeId === m.identifier;
		let label = m.identifier;
		const badges: string[] = [];
		if (isPanel) badges.push("panel");
		if (isJudge) badges.push("judge");
		if (badges.length > 0) label += ` [${badges.join("+")}]`;
		return {
			value: m.identifier,
			label,
			description: `${m.provider} • ${m.name}`,
		};
	});
}

function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) return models;
	return models.filter(
		(m) =>
			m.identifier.toLowerCase().includes(trimmed) ||
			m.name.toLowerCase().includes(trimmed) ||
			m.provider.toLowerCase().includes(trimmed),
	);
}

function statusForState(state: ModelSelectState): string {
	const panel = Array.from(state.selectedIds);
	const judge = state.judgeId;
	if (panel.length === 0) return "No panel selected";
	if (!judge || !state.selectedIds.has(judge)) {
		return `${panel.length} panel model${panel.length === 1 ? "" : "s"}, judge: auto`;
	}
	return `${panel.length} panel model${panel.length === 1 ? "" : "s"}, judge: ${judge}`;
}

/**
 * Open a native pi custom component for selecting panel and judge.
 * Returns null if cancelled.
 */
export async function selectPanelAndJudge(
	ctx: ExtensionContext,
	available: Model<Api>[],
	initialSelectedIds: Set<string>,
	initialJudgeId: string | undefined,
): Promise<{ selectedIds: Set<string>; judgeId: string | undefined } | null> {
	if (!ctx.hasUI) return null;

	const models = toModelInfo(available);
	const state: ModelSelectState = {
		selectedIds: new Set(initialSelectedIds),
		judgeId: initialJudgeId,
	};

	return ctx.ui.custom<{ selectedIds: Set<string>; judgeId: string | undefined } | null>(
		(tui, theme, _kb, done) => {
			let query = "";
			let searchFocused = false;
			let lastToggledIdentifier: string | undefined;

			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Configure Fusion Panel"))));

			const statusLine = new Text(theme.fg("dim", statusForState(state)));
			const hint = new Text(
				theme.fg("dim", "Type to search • Space toggles panel • j sets judge • Enter confirms • Esc cancels"),
			);
			container.addChild(statusLine);
			container.addChild(hint);

			const searchInput = new Input();
			searchInput.setValue(query);
			searchInput.onSubmit = () => {
				searchFocused = false;
				tui.requestRender();
			};
			container.addChild(searchInput);

			const handleSearchInput = (data: string) => {
				const before = searchInput.getValue();
				searchInput.handleInput(data);
				const after = searchInput.getValue();
				if (after !== before) {
					query = after;
					lastToggledIdentifier = undefined;
					refreshList();
				}
			};

			const filteredModels = () => filterModels(models, query);
			const allItems = () => makeSelectItems(filteredModels(), state.selectedIds, state.judgeId);

			const selectList = new SelectList(allItems(), Math.min(models.length, 12), getSelectListTheme());

			function refreshList() {
				const items = allItems();
				(selectList as any).items = items;
				(selectList as any).filteredItems = [...items];
				let idx = 0;
				if (lastToggledIdentifier) {
					const found = items.findIndex((i) => i.value === lastToggledIdentifier);
					if (found >= 0) idx = found;
				}
				(selectList as any).selectedIndex = idx;
				statusLine.setText(theme.fg("dim", statusForState(state)));
				selectList.invalidate();
				tui.requestRender();
			}

			function togglePanel(value: string) {
				lastToggledIdentifier = value;
				if (state.selectedIds.has(value)) {
					state.selectedIds.delete(value);
					if (state.judgeId === value) state.judgeId = undefined;
				} else {
					if (state.selectedIds.size >= 8) {
						hint.setText(theme.fg("warning", "Panel can have at most 8 models."));
						tui.requestRender();
						return;
					}
					state.selectedIds.add(value);
					if (!state.judgeId) state.judgeId = value;
				}
				refreshList();
			}

			function setJudge(value: string) {
				lastToggledIdentifier = value;
				if (!state.selectedIds.has(value)) {
					if (state.selectedIds.size >= 8) {
						hint.setText(theme.fg("warning", "Panel is full. Remove a model before setting judge."));
						tui.requestRender();
						return;
					}
					state.selectedIds.add(value);
				}
				state.judgeId = value;
				refreshList();
			}

			function confirm() {
				if (state.selectedIds.size === 0) {
					hint.setText(theme.fg("warning", "Select at least one panel model first."));
					tui.requestRender();
					return;
				}
				if (!state.judgeId || !state.selectedIds.has(state.judgeId)) {
					state.judgeId = Array.from(state.selectedIds)[0];
				}
				done({ selectedIds: new Set(state.selectedIds), judgeId: state.judgeId });
			}

			selectList.onSelect = () => {
				const item = selectList.getSelectedItem();
				if (item?.value) togglePanel(item.value);
			};
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(hint);
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			const originalListHandleInput = (selectList as any).handleInput.bind(selectList);
			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					if (matchesKey(data, Key.escape)) {
						done(null);
						return;
					}

					if (matchesKey(data, Key.tab)) {
						searchFocused = !searchFocused;
						tui.requestRender();
						return;
					}

					if (searchFocused) {
						if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
							searchFocused = false;
							originalListHandleInput(data);
							return;
						}
						handleSearchInput(data);
						return;
					}

					if (matchesKey(data, Key.space)) {
						const selected = selectList.getSelectedItem();
						if (selected) {
							lastToggledIdentifier = selected.value;
							selectList.onSelect?.(selected);
						}
						return;
					}

					if (data === "j") {
						const item = selectList.getSelectedItem();
						if (item?.value) setJudge(item.value);
						return;
					}

					if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
						confirm();
						return;
					}

					originalListHandleInput(data);
				},
			};
		},
	);
}

/**
 * Show the active config and session selection as a native SettingsList summary.
 * User can press Enter or Esc to dismiss.
 */
export async function showConfigSummary(
	ctx: ExtensionContext,
	config: FusionConfig,
	warnings: string[],
	errors: string[],
	sessionPanel?: string[],
	sessionJudge?: string,
): Promise<void> {
	if (!ctx.hasUI) {
		// Fallback for non-TUI modes: just notify.
		ctx.ui.notify(configDescription(config), errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "info");
		return;
	}

	const items: SettingItem[] = [];

	items.push({
		id: "panel",
		label: "Panel",
		currentValue: config.panel?.join(", ") ?? "auto (session selection)",
		description: "Models that answer the prompt in parallel.",
	});

	items.push({
		id: "judge",
		label: "Judge",
		currentValue: config.judge ?? "auto (first panel model)",
		description: "Model that produces structured analysis.",
	});

	items.push({
		id: "maxPanelModels",
		label: "Max Panel Models",
		currentValue: String(config.maxPanelModels ?? 3),
	});

	items.push({
		id: "maxPanelOutputTokens",
		label: "Panel Output Tokens",
		currentValue: String(config.maxPanelOutputTokens ?? 2048),
	});

	items.push({
		id: "maxCompletionTokens",
		label: "Judge Tokens",
		currentValue: String(config.maxCompletionTokens ?? 4096),
	});

	items.push({
		id: "temperature",
		label: "Temperature",
		currentValue: String(config.temperature ?? 0.3),
	});

	if (sessionPanel && sessionPanel.length > 0) {
		items.push({
			id: "sessionPanel",
			label: "Session Panel",
			currentValue: sessionPanel.join(", "),
			description: "Overrides file config for this session.",
		});
		items.push({
			id: "sessionJudge",
			label: "Session Judge",
			currentValue: sessionJudge ?? "auto",
			description: "Overrides file config for this session.",
		});
	}

	for (const w of warnings) {
		items.push({ id: `warn-${items.length}`, label: "⚠ Warning", currentValue: w });
	}
	for (const e of errors) {
		items.push({ id: `err-${items.length}`, label: "✗ Error", currentValue: e });
	}

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Fusion Configuration"))));
		container.addChild(new Text(theme.fg("dim", "Read-only summary. Use /fusion-panel to change models.")));

		const settingsList = new SettingsList(
			items,
			Math.min(items.length, 12),
			getSettingsListTheme(),
			() => {
				/* values are read-only */
			},
			() => done(undefined),
		);

		container.addChild(settingsList);
		container.addChild(new Text(theme.fg("dim", "Enter / Esc to close")));
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
					done(undefined);
					return;
				}
				settingsList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

/**
 * Show authed models in a native SelectList. Returns the selected identifier or null.
 */
export async function selectModelFromList(
	ctx: ExtensionContext,
	available: Model<Api>[],
	selectedIds: Set<string>,
	judgeId: string | undefined,
	includeAction?: boolean,
): Promise<{ action?: "panel" | "judge" | "run"; identifier?: string } | null> {
	if (!ctx.hasUI) return null;

	const models = toModelInfo(available);

	return ctx.ui.custom<{ action?: "panel" | "judge" | "run"; identifier?: string } | null>(
		(tui, theme, _kb, done) => {
			let query = "";
			let searchFocused = false;

			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Authed Models"))));
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						includeAction
							? "Select a model, then choose action. Space toggles panel, j sets judge."
							: "Select a model to see details. Enter confirms, Esc cancels.",
					),
				),
			);

			const searchInput = new Input();
			searchInput.setValue(query);
			searchInput.onSubmit = () => {
				searchFocused = false;
				tui.requestRender();
			};
			container.addChild(searchInput);

			const handleSearchInput = (data: string) => {
				const before = searchInput.getValue();
				searchInput.handleInput(data);
				const after = searchInput.getValue();
				if (after !== before) {
					query = after;
					refreshList();
				}
			};

			const filteredModels = () => filterModels(models, query);
			const allItems = () => makeSelectItems(filteredModels(), selectedIds, judgeId);
			const selectList = new SelectList(allItems(), Math.min(models.length, 12), getSelectListTheme());

			function refreshList() {
				const items = allItems();
				(selectList as any).items = items;
				(selectList as any).filteredItems = [...items];
				(selectList as any).selectedIndex = 0;
				selectList.invalidate();
				tui.requestRender();
			}

			selectList.onSelect = () => {
				const item = selectList.getSelectedItem();
				if (!item?.value) return;
				if (includeAction) {
					done({ action: "panel", identifier: item.value });
				} else {
					done({ identifier: item.value });
				}
			};
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						"Type to search • ↑↓ navigate • Enter select • Esc cancel" +
							(includeAction ? " • Space toggle panel • j set judge" : ""),
					),
				),
			);
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			const originalListHandleInput = (selectList as any).handleInput.bind(selectList);
			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					if (matchesKey(data, Key.escape)) {
						done(null);
						return;
					}

					if (matchesKey(data, Key.tab)) {
						searchFocused = !searchFocused;
						tui.requestRender();
						return;
					}

					if (searchFocused) {
						if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
							searchFocused = false;
							originalListHandleInput(data);
							return;
						}
						handleSearchInput(data);
						return;
					}

					if (includeAction) {
						if (matchesKey(data, Key.space)) {
							const item = selectList.getSelectedItem();
							if (item?.value) done({ action: "panel", identifier: item.value });
							return;
						}
						if (data === "j") {
							const item = selectList.getSelectedItem();
							if (item?.value) done({ action: "judge", identifier: item.value });
							return;
						}
						if (data === "r") {
							const item = selectList.getSelectedItem();
							if (item?.value) done({ action: "run", identifier: item.value });
							return;
						}
					}

					if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
						const item = selectList.getSelectedItem();
						if (item?.value) {
							done(includeAction ? { action: "run", identifier: item.value } : { identifier: item.value });
						}
						return;
					}

					originalListHandleInput(data);
				},
			};
		},
	);
}

/**
 * Render config status as plain text for print/notification fallback.
 */
export function renderConfigStatus(configText: string, warnings: string[], errors: string[]): string {
	const lines: string[] = [];
	lines.push(configText);
	if (errors.length > 0) {
		lines.push("\nErrors:");
		for (const e of errors) lines.push(`- ${e}`);
	}
	if (warnings.length > 0) {
		lines.push("\nWarnings:");
		for (const w of warnings) lines.push(`- ${w}`);
	}
	return lines.join("\n");
}

function configDescription(config: FusionConfig): string {
	const parts: string[] = [];
	if (config.panel) parts.push(`panel=[${config.panel.join(", ")}]`);
	if (config.judge) parts.push(`judge=${config.judge}`);
	parts.push(`maxPanelModels=${config.maxPanelModels ?? 3}`);
	parts.push(`maxPanelOutputTokens=${config.maxPanelOutputTokens ?? 2048}`);
	parts.push(`maxCompletionTokens=${config.maxCompletionTokens ?? 4096}`);
	parts.push(`temperature=${config.temperature ?? 0.3}`);
	return parts.join(", ");
}
