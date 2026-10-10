import { fetch } from "@tauri-apps/plugin-http";
import { state, secrets } from "./store";

export interface Msg {
  role: "user" | "assistant";
  content: string;
}

export const PROVIDERS = [
  { id: "anthropic", name: "Claude", secret: "anthropic" },
  { id: "openai", name: "OpenAI", secret: "openai" },
  { id: "google", name: "Gemini", secret: "google" },
  { id: "ollama", name: "Ollama (local)", secret: "" },
  { id: "lmstudio", name: "LM Studio (local)", secret: "" },
];

async function* lines(res: Response): AsyncGenerator<string> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
    }
  }
  if (buf) yield buf;
}

const sseData = (l: string) => (l.startsWith("data:") ? l.slice(5).trim() : null);

/** Streams the reply text chunk by chunk. */
export async function* streamChat(provider: string, messages: Msg[], signal?: AbortSignal): AsyncGenerator<string> {
  const s = state.settings;
  const model = s.models[provider];
  const json = { "content-type": "application/json" };

  if (provider === "anthropic") {
    const key = await secrets.get("anthropic");
    if (!key) throw new Error("NO_KEY");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { ...json, "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 2048, stream: true, messages }),
    });
    for await (const l of lines(res)) {
      const d = sseData(l);
      if (!d) continue;
      try {
        const j = JSON.parse(d);
        if (j.type === "content_block_delta" && j.delta?.text) yield j.delta.text as string;
        if (j.type === "error") throw new Error(j.error?.message ?? "API error");
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
    return;
  }

  if (provider === "openai" || provider === "lmstudio") {
    const key = provider === "openai" ? await secrets.get("openai") : null;
    if (provider === "openai" && !key) throw new Error("NO_KEY");
    const base = provider === "openai" ? "https://api.openai.com" : s.lmUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      signal,
      headers: { ...json, ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, stream: true, messages }),
    });
    for await (const l of lines(res)) {
      const d = sseData(l);
      if (!d || d === "[DONE]") continue;
      try {
        const c = JSON.parse(d).choices?.[0]?.delta?.content;
        if (c) yield c as string;
      } catch {
        /* partial line */
      }
    }
    return;
  }

  if (provider === "google") {
    const key = await secrets.get("google");
    if (!key) throw new Error("NO_KEY");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal,
      headers: { ...json, "x-goog-api-key": key },
      body: JSON.stringify({ contents: messages.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })) }),
    });
    for await (const l of lines(res)) {
      const d = sseData(l);
      if (!d) continue;
      try {
        const c = JSON.parse(d).candidates?.[0]?.content?.parts?.[0]?.text;
        if (c) yield c as string;
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (provider === "ollama") {
    const res = await fetch(`${s.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      signal,
      headers: json,
      body: JSON.stringify({ model, stream: true, messages }),
    });
    for await (const l of lines(res)) {
      if (!l) continue;
      try {
        const c = JSON.parse(l).message?.content;
        if (c) yield c as string;
      } catch {
        /* ignore */
      }
    }
    return;
  }
  throw new Error("Unknown provider");
}
