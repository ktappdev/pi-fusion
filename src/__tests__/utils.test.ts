/**
 * Tests for pi-fusion utilities.
 */

import { extractJson, mapWithConcurrencyLimit } from "../utils.ts";

function test(name: string, fn: () => void | Promise<void>) {
	Promise.resolve(fn()).then(
		() => console.log(`✓ ${name}`),
		(err) => {
			console.error(`✗ ${name}:`, err);
			process.exitCode = 1;
		},
	);
}

test("extractJson parses plain JSON", () => {
	const result = extractJson<{ ok: boolean }>('{"ok":true}');
	if (result?.ok !== true) throw new Error("expected ok=true");
});

test("extractJson parses fenced JSON", () => {
	const result = extractJson<{ ok: boolean }>("```json\n{\"ok\":true}\n```");
	if (result?.ok !== true) throw new Error("expected ok=true from fence");
});

test("extractJson returns undefined for invalid text", () => {
	const result = extractJson<{ ok: boolean }>("not json");
	if (result !== undefined) throw new Error("expected undefined");
});

test("mapWithConcurrencyLimit runs all tasks", async () => {
	const inputs = [1, 2, 3, 4, 5];
	const results = await mapWithConcurrencyLimit(inputs, 2, async (n) => n * 2);
	if (results.join(",") !== "2,4,6,8,10") throw new Error(`unexpected results: ${results}`);
});

test("mapWithConcurrencyLimit handles empty input", async () => {
	const results = await mapWithConcurrencyLimit<number, number>([], 2, async (n) => n);
	if (results.length !== 0) throw new Error("expected empty results");
});
