import { geminiStream } from "./gemini-client";
import {
  CONTINUE_PROMPT,
  MAX_CONTINUATIONS,
  defaultCloudModel,
  normalizeCloudProvider,
  safeCloudBaseUrl,
  sanitizeCloudModel,
  type CloudProviderId,
} from "./cloud-provider";

const OPENAI_URLS: Partial<Record<CloudProviderId, string>> = {
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
};
import type { ChatSettings } from "./types";

interface StreamOpts {
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

type Msg = { role: "user" | "assistant"; content: string };
type Pick = (data: string, end: { cut: boolean }) => string | undefined;

async function* readSse(
  response: Response,
  signal: AbortSignal | undefined,
  pick: Pick,
  end: { cut: boolean }
): AsyncIterable<string> {
  if (!response.ok || !response.body) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "The API key was rejected. Check the provider and key in Cortex settings."
        : "Cloud chat could not answer just now."
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const read = (line: string): string | undefined => {
    if (!line.startsWith("data:")) return undefined;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return undefined;
    return pick(data, end);
  };
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const text = read(line);
        if (text) yield text;
      }
    }
    // The last event may arrive without a trailing newline.
    const tail = read(buffer + decoder.decode());
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export function pickOpenAI(data: string, end: { cut: boolean }): string | undefined {
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
    };
    if (parsed.choices?.[0]?.finish_reason === "length") end.cut = true;
    return parsed.choices?.[0]?.delta?.content;
  } catch {
    return undefined;
  }
}

export function pickAnthropic(data: string, end: { cut: boolean }): string | undefined {
  try {
    const parsed = JSON.parse(data) as { delta?: { text?: string; stop_reason?: string } };
    if (parsed.delta?.stop_reason === "max_tokens") end.cut = true;
    return parsed.delta?.text;
  } catch {
    return undefined;
  }
}

/** Runs one request, and asks the same model to carry on while it keeps running out of room. */
async function* withContinuation(
  prompt: string,
  signal: AbortSignal | undefined,
  run: (messages: Msg[], end: { cut: boolean }) => AsyncIterable<string>
): AsyncIterable<string> {
  const messages: Msg[] = [{ role: "user", content: prompt }];
  let answer = "";
  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const end = { cut: false };
    for await (const chunk of run(messages, end)) {
      answer += chunk;
      yield chunk;
    }
    if (!end.cut || !answer || signal?.aborted) return;
    messages.splice(1, messages.length - 1, { role: "assistant", content: answer }, { role: "user", content: CONTINUE_PROMPT });
  }
}

async function* openAiCompatible(
  url: string,
  model: string,
  messages: Msg[],
  apiKey: string,
  opts: StreamOpts,
  end: { cut: boolean }
): AsyncIterable<string> {
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxOutputTokens ?? 2048,
      messages: [...(opts.systemPrompt ? [{ role: "system", content: opts.systemPrompt }] : []), ...messages],
    }),
    signal: opts.signal,
  });
  yield* readSse(response, opts.signal, pickOpenAI, end);
}

const ANTHROPIC_HEADERS = {
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
};

async function* anthropicStream(
  model: string,
  messages: Msg[],
  apiKey: string,
  opts: StreamOpts,
  end: { cut: boolean }
): AsyncIterable<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, ...ANTHROPIC_HEADERS },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxOutputTokens ?? 2048,
      temperature: opts.temperature ?? 0.3,
      stream: true,
      system: opts.systemPrompt,
      messages,
    }),
    signal: opts.signal,
  });
  yield* readSse(response, opts.signal, pickAnthropic, end);
}

export async function* cloudStream(
  prompt: string,
  settings: ChatSettings,
  opts: StreamOpts
): AsyncIterable<string> {
  const id: CloudProviderId = normalizeCloudProvider(settings.cloudProvider);
  const model = sanitizeCloudModel(settings.cloudModel, defaultCloudModel(id));
  if (id === "gemini") {
    yield* geminiStream(prompt, {
      apiKey: settings.geminiApiKey,
      model: model || undefined,
      systemPrompt: opts.systemPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      signal: opts.signal,
    });
    return;
  }
  if (id === "anthropic") {
    const pick = model || defaultCloudModel("anthropic");
    yield* withContinuation(prompt, opts.signal, (messages, end) =>
      anthropicStream(pick, messages, settings.geminiApiKey, opts, end)
    );
    return;
  }
  const url = id === "custom" ? safeCloudBaseUrl(settings.cloudBaseUrl ?? "") : OPENAI_URLS[id];
  if (!url || !model) {
    throw new Error("Add an https endpoint and a model id in Cortex settings.");
  }
  yield* withContinuation(prompt, opts.signal, (messages, end) =>
    openAiCompatible(url, model, messages, settings.geminiApiKey, opts, end)
  );
}

/** Models that cannot write a chat answer. */
const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|image|audio|transcri|realtime|rerank|guard|aqa|imagen|veo/i;

/**
 * The model ids this key can call, from the provider's own list. Read only:
 * nothing is sent but the key the provider already receives for chat.
 */
export async function listCloudModels(provider: unknown, apiKey: string, baseUrl?: string): Promise<string[]> {
  const id = normalizeCloudProvider(provider);
  const key = apiKey.trim();
  if (!key) throw new Error("Add an API key first.");
  let url = "";
  let headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (id === "gemini") {
    url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200";
    headers = { "x-goog-api-key": key };
  } else if (id === "anthropic") {
    url = "https://api.anthropic.com/v1/models?limit=100";
    headers = { "x-api-key": key, ...ANTHROPIC_HEADERS };
  } else if (id === "custom") {
    const base = safeCloudBaseUrl(baseUrl ?? "");
    if (!base) throw new Error("Add the endpoint URL first.");
    url = `${base.replace(/\/chat\/completions$/i, "")}/models`;
  } else {
    url = String(OPENAI_URLS[id]).replace(/\/chat\/completions$/, "/models");
  }
  const res = await fetch(url, { headers, redirect: "error" });
  if (res.status === 401 || res.status === 403) throw new Error("The API key was rejected.");
  if (!res.ok) throw new Error("The provider did not return a model list.");
  const body = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
    data?: { id?: string }[];
  };
  const ids =
    id === "gemini"
      ? (body.models ?? [])
          .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
          .map((m) => String(m.name ?? "").replace(/^models\//, ""))
      : (body.data ?? []).map((m) => String(m.id ?? ""));
  const clean = ids.filter((m) => sanitizeCloudModel(m, "") === m && !NOT_CHAT.test(m));
  return [...new Set(clean)].sort().slice(0, 200);
}
