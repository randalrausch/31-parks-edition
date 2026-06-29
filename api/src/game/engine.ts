/**
 * The shared, pure game engine — the SAME tested rules the client runs. Imported
 * directly from the app source (single repo) so the server can never drift from
 * the client. esbuild inlines this into the deployed bundle; there is no separate
 * engine artifact to keep in sync.
 */
export * from "../../../src/game/edgeEntry";
