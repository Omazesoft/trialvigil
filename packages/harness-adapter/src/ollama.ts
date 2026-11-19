// Optional Ollama adapter — OFF by default.
// Only active when BOTH OLLAMA_HOST and OLLAMA_MODEL are set.
// The demo must work with no Ollama running. Failures are soft: callers
// treat a null return as "Ollama unavailable, continue without it".
// SPDX-License-Identifier: Apache-2.0

export function ollamaAvailable(): boolean {
  return Boolean(process.env.OLLAMA_HOST && process.env.OLLAMA_MODEL);
}

/** One-shot completion against a local Ollama server. Returns null on any failure. */
export async function ollamaComplete(prompt: string, timeoutMs = 15_000): Promise<string | null> {
  const host = process.env.OLLAMA_HOST;
  const model = process.env.OLLAMA_MODEL;
  if (!host || !model) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${host.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { response?: string };
      return typeof data.response === "string" ? data.response : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
