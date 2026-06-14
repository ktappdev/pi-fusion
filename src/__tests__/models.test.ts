/**
 * Tests for pi-fusion model resolution and panel selection.
 */

import { modelDisplay, resolveModelIdentifier, selectDiversePanel } from "../models.ts";
import type { Api, Model } from "../types.ts";

function test(name: string, fn: () => void | Promise<void>) {
	Promise.resolve(fn()).then(
		() => console.log(`✓ ${name}`),
		(err) => {
			console.error(`✗ ${name}:`, err);
			process.exitCode = 1;
		},
	);
}

function fakeModel(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-completions" as Api,
		provider,
		baseUrl: "https://example.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

test("modelDisplay formats provider/id", () => {
	const display = modelDisplay(fakeModel("anthropic", "claude-sonnet-4-5"));
	if (display !== "anthropic/claude-sonnet-4-5") throw new Error(`unexpected display: ${display}`);
});

test("selectDiversePanel picks one per provider by default", () => {
	const models = [
		fakeModel("anthropic", "claude-sonnet-4-5"),
		fakeModel("anthropic", "claude-opus-4-5"),
		fakeModel("openai", "gpt-4.1"),
		fakeModel("google", "gemini-2.5-pro"),
	];
	const panel = selectDiversePanel(models, 3);
	const providers = new Set(panel.map((m) => m.provider));
	if (panel.length !== 3) throw new Error(`expected 3, got ${panel.length}`);
	if (providers.size !== 3) throw new Error("expected 3 distinct providers");
});

test("selectDiversePanel excludes non-text models", () => {
	const textModel = fakeModel("anthropic", "claude-sonnet-4-5");
	const imageOnly = { ...fakeModel("openai", "dall-e"), input: ["image"] as ("text" | "image")[] };
	const panel = selectDiversePanel([textModel, imageOnly], 2);
	if (panel.length !== 1) throw new Error(`expected 1 text model, got ${panel.length}`);
	if (panel[0].id !== "claude-sonnet-4-5") throw new Error("unexpected model");
});
