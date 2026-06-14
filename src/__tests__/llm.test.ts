/**
 * Tests for provider/model request compatibility.
 */

import { getSupportsTemperature } from "../llm.ts";
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

function fakeModel(provider: string, id: string, overrides: Partial<Model<Api>> = {}): Model<Api> {
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
		...overrides,
	};
}

test("openai-codex provider rejects temperature even when id does not contain codex", () => {
	const model = fakeModel("openai-codex", "gpt-5.5");
	if (getSupportsTemperature(model)) throw new Error("expected openai-codex/gpt-5.5 to omit temperature");
});

test("compat.supportsTemperature=false overrides heuristics", () => {
	const model = fakeModel("anthropic", "claude-opus-4-8", {
		compat: { supportsTemperature: false } as Model<Api>["compat"],
	});
	if (getSupportsTemperature(model)) throw new Error("expected compat.supportsTemperature=false to omit temperature");
});

test("ordinary openai-compatible model keeps temperature", () => {
	const model = fakeModel("openai", "gpt-4.1");
	if (!getSupportsTemperature(model)) throw new Error("expected regular model to support temperature");
});
