/**
 * Minimal Server-Sent-Events reader shared by every streaming adapter.
 * Yields the joined `data:` payload of each event block. Handles CRLF,
 * multi-line data fields, comments (`:` lines) and a trailing block with no
 * final blank line. Never parses JSON itself — callers decide how to treat a
 * malformed block (they must not let one bad frame kill the whole stream).
 */
export async function* readSseData(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", onAbort, { once: true });
  const dataOf = (block: string): string | null => {
    const lines = block.split("\n").filter((line) => line.startsWith("data:"));
    if (lines.length === 0) return null;
    return lines.map((line) => line.slice(5).replace(/^ /, "")).join("\n");
  };
  try {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    while (true) {
      const { value, done } = await reader.read();
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const data = dataOf(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (data !== null) yield data;
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const data = dataOf(buffer);
      if (data !== null) yield data;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try { reader.releaseLock(); } catch { /* already released by cancel */ }
  }
}

/** Parse one SSE data payload; a malformed frame yields null instead of throwing. */
export function parseSseJson<T>(data: string): T | null {
  if (!data || data === "[DONE]") return null;
  try { return JSON.parse(data) as T; } catch { return null; }
}

/** AbortSignal that fires on timeout OR when the caller's signal aborts. */
export function combinedSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([timeout, external]) : timeout;
}
