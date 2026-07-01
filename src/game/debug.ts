/**
 * Lightweight client debug logging for troubleshooting online play.
 *
 * Off by default in production builds; on automatically during `npm run dev`.
 * Anyone can enable it on a deployed site from the console:
 *   localStorage.setItem("parks31.debug", "1")   // then reload
 * and disable with localStorage.removeItem("parks31.debug").
 *
 * Logs are namespaced ("[31:net] …") so they're easy to filter in the console.
 */
function debugEnabled(): boolean {
  try {
    if (localStorage.getItem("parks31.debug") === "1") return true;
  } catch {
    /* storage unavailable */
  }
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

const ON = debugEnabled();

export function dlog(scope: string, message: string, data?: unknown): void {
  if (!ON) return;
  if (data !== undefined) console.debug(`[31:${scope}] ${message}`, data);
  else console.debug(`[31:${scope}] ${message}`);
}

/**
 * Error-level logging — always on (errors matter in production too). Namespaced
 * like dlog so it's filterable, and it unwraps Error objects to their message
 * plus the full error for the stack.
 */
export function elog(scope: string, message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : error;
  if (error !== undefined) {
    console.error(`[31:${scope}] ${message}:`, detail, error);
  } else {
    console.error(`[31:${scope}] ${message}`);
  }
}
