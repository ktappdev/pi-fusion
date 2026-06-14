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

	const options: {
		apiKey: string;
		headers?: Record<string, string>;
		signal?: AbortSignal;
		maxTokens: number;
		temperature?: number;
	} = {
		apiKey: auth.apiKey,
		headers: auth.headers,
		signal,
		maxTokens,
	};

	// Some models (e.g. Anthropic Claude Opus 4.7+, OpenAI Codex) reject temperature.
	const supportsTemperature = getSupportsTemperature(model);
	if (supportsTemperature) {
		options.temperature = temperature;
	}

	const response = await complete(
		model,
		{
			systemPrompt,
			messages: [{ role: "user", content: userText, timestamp: Date.now() }],
		},
		options,
	);

	if (response.stopReason === "error" || response.stopReason === "aborted") {
		throw new Error(response.errorMessage ?? `Model stopped with reason: ${response.stopReason}`);
	}
	return response;
}

export function getSupportsTemperature(model: Model<Api>): boolean {
	const compat = (model as any).compat;
	if (compat && typeof compat.supportsTemperature === "boolean") {
		return compat.supportsTemperature;
	}
	// Heuristic: OpenAI Codex models/providers and Anthropic Opus 4.7+ commonly reject temperature.
	const provider = model.provider.toLowerCase();
	const id = model.id.toLowerCase();
	const baseUrl = model.baseUrl.toLowerCase();
	if (provider.includes("codex") || id.includes("codex") || baseUrl.includes("codex")) return false;
	if (provider === "anthropic" && /^claude-opus-4-[7-9]/.test(model.id)) return false;
	return true;
}

export function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}
