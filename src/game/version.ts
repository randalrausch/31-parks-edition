/**
 * Single source of truth for the app's human-facing version and the wire
 * protocol version. Both the frontend and the two backends read from here, so
 * the reported version can never drift between them.
 *
 * - APP_VERSION is maintained AUTOMATICALLY by the release workflow
 *   (.github/workflows/release.yml) from Conventional Commits — do not hand-edit
 *   it. The frontend appends a build number + short commit sha at build time.
 *
 * - PROTOCOL_VERSION is bumped MANUALLY, and only when the client↔server wire
 *   contract changes incompatibly (the op surface, the redacted-state shape, or
 *   seat-token semantics). A client and server reporting different
 *   PROTOCOL_VERSIONs cannot safely play together, so the client asks the user
 *   to refresh rather than talk to a server it may not understand.
 */

/** Human-facing semver. Maintained by the release workflow — do not hand-edit. */
export const APP_VERSION = "0.7.2";

/** Wire-contract version. Bump ONLY on a breaking client↔server change. */
export const PROTOCOL_VERSION = 1;
