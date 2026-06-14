/**
 * Interactive UI helpers for pi-fusion.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text, matchesKey } from "@earendil-works/pi-tui";
import type { Api, Model } from "./types.ts";
import { modelDisplay } from "./models.ts";

interface ModelSelectState {
	selectedIds: Set<string>;
	judgeId: string | undefined;
}

export async function selectPanelAndJudge(
	ctx: ExtensionContext,
	available: Model<Api>[],
	initialSelectedIds: Set<string>,
	initialJudgeId: string | undefined,
): Promise<{ selectedIds: Set<string>; judgeId: string | undefined } | null> {
	if (!ctx.hasUI) return null;

	const identifiers = available.map(modelDisplay);
	const state: ModelSelectState = {
		selectedIds: new Set(initialSelectedIds),
		judgeId: initialJudgeId,
	};

	const result = await ctx.ui.custom<{ selectedIds: Set<string>; judgeId: string | undefined } | null>(
		(tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Configure Fusion Panel"))));
			container.addChild(new Text(theme.fg("dim", "Space toggles panel selection. Enter confirms.")));
			container.addChild(new Text(theme.fg("dim", "1–8 models allowed for the panel.")));

			function buildItems(): SelectItem[] {
				return identifiers.map((id) => {
					const isPanel = state.selectedIds.has(id);
					const isJudge = state.judgeId === id;
					let label = id;
					const badges: string[] = [];
					if (isPanel) badges.push("panel");
					if (isJudge) badges.push("judge");
					if (badges.length > 0) label += ` [${badges.join("+")}]`;
					return {
						value: id,
						label,
						description: isPanel ? "Press j to set as judge" : "Press space to add to panel",
					};
				});
			}

			const selectList = new SelectList(buildItems(), Math.min(identifiers.length, 12), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			selectList.onSelect = () => {
				const item = selectList.getSelectedItem();
				const value = item?.value;
				if (!value) return;
				if (state.selectedIds.has(value)) {
					state.selectedIds.delete(value);
					if (state.judgeId === value) state.judgeId = undefined;
				} else {
					if (state.selectedIds.size >= 8) return;
					state.selectedIds.add(value);
					if (!state.judgeId) state.judgeId = value;
				}
				selectList.setSelectedIndex(0);
				tui.requestRender();
			};

			selectList.onCancel = () => done(null);

			const originalHandleInput = (selectList as any).handleInput.bind(selectList);
			(selectList as any).handleInput = (data: string) => {
				if (data === "j") {
					const item = selectList.getSelectedItem();
					const value = item?.value;
					if (value && state.selectedIds.has(value)) {
						state.judgeId = value;
						selectList.setSelectedIndex(0);
						tui.requestRender();
						return;
					}
				}
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
					done({ selectedIds: new Set(state.selectedIds), judgeId: state.judgeId });
					return;
				}
				originalHandleInput(data);
			};

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "space toggle • j set judge • enter confirm • esc cancel")));
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					(selectList as any).handleInput(data);
				},
			};
		},
	);

	return result;
}

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
