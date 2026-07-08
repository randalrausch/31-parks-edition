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
export const APP_VERSION = "0.11.0";

/** Wire-contract version. Bump ONLY on a breaking client↔server change. */
export const PROTOCOL_VERSION = 2;

/**
 * Schema version of a persisted GameState. Stamped into every new game by
 * createGameState and checked by the server before it feeds a stored state back
 * into the engine. Bump this ONLY when a change to the GameState shape makes an
 * older serialized game unreadable by the current engine — a game whose stored
 * stateVersion doesn't match is failed with a clear "started on an older
 * version" message instead of crashing the op with a generic 500. A game with no
 * stateVersion field predates versioning and is treated as version 1.
 */
export const STATE_VERSION = 1;
