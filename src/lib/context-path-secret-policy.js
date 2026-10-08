/**
 * Context-path secret predicate (pure, no IO).
 *
 * The literal below is moved verbatim from `project-context-files.js:18` @ 55f606c (absence-witness
 * evidence contract r3.4, D0). It is anchored, applied per `/`-segment and case-insensitive without
 * the `u` flag (ASCII letters only). Flags are exactly `i`: no `g`/`y`, so `.test` is stateless.
 * The collector (`isContextPathAllowed`), the create-destination absence-witness producer and, later,
 * the composer import this same symbol; it is never retyped.
 */
export const CONTEXT_SECRET_SEGMENT_PATTERN = /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.pypirc|credentials?(?:\..*)?|secrets?(?:\..*)?|service[-_]account(?:\..*)?|id_rsa|id_ed25519)$/i;

export function isContextSecretSegment(segment) { return CONTEXT_SECRET_SEGMENT_PATTERN.test(segment); }
