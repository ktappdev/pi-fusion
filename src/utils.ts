/**
 * General utilities for pi-fusion.
 */

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = Array.from({ length: limit }, async () => {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

export function extractJson<T>(text: string): T | undefined {
	// First try the whole thing.
	try {
		return JSON.parse(text) as T;
	} catch {
		// ignore
	}

	// Try to extract from markdown fences.
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	if (fenced && fenced[1]) {
		try {
			return JSON.parse(fenced[1]) as T;
		} catch {
			// ignore
		}
	}

	// Fall back to first { ... } block.
	const brace = text.match(/\{[\s\S]*\}/);
	if (brace) {
		try {
			return JSON.parse(brace[0]) as T;
		} catch {
			// ignore
		}
	}
	return undefined;
}
