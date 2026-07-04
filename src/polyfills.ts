/**
 * Tiny runtime shims for browsers a little behind the modern baseline. Imported
 * first in main.tsx so everything below can rely on them.
 *
 * AbortSignal.timeout (Chrome 103 / Safari 16 / Firefox 100) is used by both
 * backend clients to bound a request. Without this shim, an older browser throws
 * synchronously inside the request path and the failure is mis-reported as
 * "Couldn't reach the game server" on EVERY request — permanently — even though
 * the network is fine. The shim keeps online play working down to the
 * structuredClone floor (Safari 15.4) that solo already requires.
 */
if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(
        typeof DOMException === "function"
          ? new DOMException("The operation timed out.", "TimeoutError")
          : new Error("The operation timed out."),
      );
    }, ms);
    return controller.signal;
  };
}
