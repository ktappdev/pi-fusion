/**
 * Tests for pi-fusion config validation.
 */

import { validateConfig, MAX_PANEL_MODELS_HARD_LIMIT, DEFAULT_MAX_PANEL_MODELS } from "../config.ts";

function test(name: string, fn: () => void | Promise<void>) {
	Promise.resolve(fn()).then(
		() => console.log(`✓ ${name}`),
		(err) => {
			console.error(`✗ ${name}:`, err);
			process.exitCode = 1;
		},
	);
}

test("validates empty config with warnings", () => {
	const result = validateConfig({});
	if (!result.valid) throw new Error("empty config should be valid");
	if (result.warnings.length === 0) throw new Error("expected warnings for empty config");
});

test("rejects non-object config", () => {
	const result = validateConfig(null);
	if (result.valid) throw new Error("null config should be invalid");
});

test("rejects oversized panel", () => {
	const result = validateConfig({ panel: Array.from({ length: MAX_PANEL_MODELS_HARD_LIMIT + 1 }, (_, i) => `m${i}`) });
	if (result.valid) throw new Error("oversized panel should be invalid");
});

test("rejects out-of-range maxPanelModels", () => {
	const result = validateConfig({ maxPanelModels: 0 });
	if (result.valid) throw new Error("maxPanelModels=0 should be invalid");
});

test("accepts valid config", () => {
	const result = validateConfig({
		panel: ["anthropic/claude-sonnet-4-5"],
		judge: "anthropic/claude-opus-4-5",
		maxPanelModels: DEFAULT_MAX_PANEL_MODELS,
		maxPanelOutputTokens: 1024,
		maxCompletionTokens: 2048,
		temperature: 0.5,
	});
	if (!result.valid) throw new Error(`expected valid: ${result.errors.join(", ")}`);
});

test("rejects invalid temperature", () => {
	const result = validateConfig({ temperature: 3 });
	if (result.valid) throw new Error("temperature=3 should be invalid");
});
