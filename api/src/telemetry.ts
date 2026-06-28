/**
 * Optional Application Insights. When APPLICATIONINSIGHTS_CONNECTION_STRING is
 * set (Function App setting), start the SDK to auto-collect requests, dependencies,
 * exceptions, and console logs — including Functions cold-start timing. A no-op
 * when unset, so local dev and tests pull in nothing. The SDK stays external to
 * the esbuild bundle and is loaded lazily only when configured.
 */
let started = false;

export function initTelemetry(): void {
  if (started) return;
  const conn = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!conn) return;
  started = true;
  import("applicationinsights")
    .then((ai) => {
      ai.setup(conn)
        .setAutoCollectConsole(true, true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setSendLiveMetrics(false)
        .start();
    })
    .catch(() => {
      /* telemetry is best-effort; never break the request path */
    });
}
