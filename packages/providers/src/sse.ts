/**
 * Minimal Server-Sent-Events reader shared by every streaming adapter.
 * Yields the joined `data:` payload of each event block. Handles CRLF (including
 * across chunk boundaries), multi-line data fields, comments (`:` lines) and a
 * trailing block with no final blank line. Never parses JSON itself — callers
 * decide how to treat a malformed block (they must not let one bad frame kill
 * the whole stream).
 */
const MAX_SSE_BUFFER_CHARS = 2 * 1024 * 1024;

function extractSseData(block: string): string | null {
  let out: string | null = null;
  for (const line of block.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const value = line.charCodeAt(5) === 32 ? line.slice(6) : line.slice(5);
    out = out === null ? value : `${out}\n${value}`;
  }
  return out;
}

export async function* readSseData(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  // Stateful ({ stream: true }) — must stay per-stream to avoid corrupting concurrent multi-byte UTF-8 streams.
  const decoder = new TextDecoder();
  let buffer = "";
  let endedWithCr = false;
  let streamDone = false;
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    while (true) {
      const { value, done } = await reader.read();
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      if (done) {
        streamDone = true;
        break;
      }
      let chunk = decoder.decode(value, { stream: true });
      if (endedWithCr && chunk.startsWith("\n")) {
        chunk = chunk.slice(1);
      }
      endedWithCr = chunk.endsWith("\r");
      buffer += chunk.replace(/\r\n?/g, "\n");
      if (buffer.length > MAX_SSE_BUFFER_CHARS) {
        throw new Error("SSE stream buffer exceeded 2 MB limit");
      }
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const data = extractSseData(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (data !== null) yield data;
        boundary = buffer.indexOf("\n\n");
      }
    }
    const tail = decoder.decode();
    if (tail) {
      const cleaned = endedWithCr && tail.startsWith("\n") ? tail.slice(1) : tail;
      buffer += cleaned.replace(/\r\n?/g, "\n");
    }
    if (buffer.trim()) {
      const data = extractSseData(buffer);
      if (data !== null) yield data;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!streamDone) {
      await reader.cancel().catch(() => undefined);
    }
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
  if (!external) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, external]);
  }
  const controller = new AbortController();
  const forward = (src: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(src.reason);
  };
  if (timeout.aborted) forward(timeout);
  else if (external.aborted) forward(external);
  else {
    const onTimeout = () => { external.removeEventListener("abort", onExternal); forward(timeout); };
    const onExternal = () => { timeout.removeEventListener("abort", onTimeout); forward(external); };
    timeout.addEventListener("abort", onTimeout, { once: true });
    external.addEventListener("abort", onExternal, { once: true });
  }
  return controller.signal;
}
