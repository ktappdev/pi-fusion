/**
 * Low-level LLM calls for pi-fusion.
 */

import { complete, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { modelDisplay } from "./models.ts";

export async function callModelText(
	registry: ModelRegistry,
	model: Model<Api>,
	systemPrompt: string,
	userText: string,
	maxTokens: number,
	temperature: number,
	signal: AbortSignal | undefined,
): Promise<AssistantMessage> {
	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		throw new Error(auth.ok ? `No API key for ${modelDisplay(model)}` : auth.error);
	}

	const response = await complete(
		model,
		{
			systemPrompt,
			messages: [{ role: "user", content: userText, timestamp: Date.now() }],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			signal,
			maxTokens,
			temperature,
		},
	);

	if (response.stopReason === "error" || response.stopReason === "aborted") {
		throw new Error(response.errorMessage ?? `Model stopped with reason: ${response.stopReason}`);
	}
	return response;
}

export function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}
