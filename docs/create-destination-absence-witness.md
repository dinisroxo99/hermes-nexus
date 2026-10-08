# Create-destination absence witness producer (v1)

Status: **producer only (D0 + D1)**. The module is not wired into the route, the adapter or the
composer. Nothing here lifts a create, flips a hard flag or exposes anything over HTTP or a plugin.
`WRITE` stays classification only. Evidence contract: absence-witness evidence contract **r3.4**
(`/workspace/plans/hermes-nexus-arch-absence-witness-evidence-contract-r3.4.md`, sha256
`39ed2298f8be8c7899b89c6feb47de09edf88156c625841e2240d3bb5bed0b90`), secret-name option **S2a**.

## Modules

| File | Role |
|---|---|
| `src/lib/context-path-secret-policy.js` | D0: the collector's secret clause, moved verbatim from `project-context-files.js:18`; exports `CONTEXT_SECRET_SEGMENT_PATTERN` and `isContextSecretSegment`. `isContextPathAllowed` is unchanged (PA-26). |
| `src/lib/create-destination-absence-witness.js` | D1: `buildCreateDestinationAbsenceWitness({ projectRoot, request, expected, nestedProjectPaths, options })`, the read-only producer; also the pure `s2aSecretRuleRequiresUnknown` (the §3.3 S2a rule, exported for the N-2 white-box test). |
| `src/lib/create-destination-absence-witness-constants.js` | Pure constants (`CREATE_ABSENCE_WITNESS_HARD_FLAGS`, limits, G12 allow-list, vocabulary, reason priority) and `canonicalJson` (§2.6 P-7). No imports; the later composer evaluator imports this instead of the fs-using producer. |
| `src/lib/create-name-key.js` | The dual key `hn-create-name-key-v3`: `nameKey` (`K`), `kernelModelNameKey` (`Kk`), `namesCollide` (`K` equal or `Kk` equal), `kernelModelCodePoints` (`KM`). Pure. |
| `src/lib/unicode-data/` | Generated tables (`casefold-17.0.0.js`, `kernel-nfdicf-12.1.0.js`) and the Unicode License v3 notice. |
| `scripts/gen-create-name-key-tables.mjs` | Offline generator for both tables (checks the four raw sha256s first; `--write` / `--check`). |
| `vendor/unicode/` | Raw UCD 12.1.0 (`UnicodeData.txt`, `CaseFolding.txt`, `DerivedCoreProperties.txt`) and 17.0.0 `CaseFolding.txt`, the licence notice and a README with URLs, sizes and sha256s. Not copied into the Docker image. |

## What the producer does (and does not do)

- **Syscalls (G1/G2).** Directory opens only (`O_RDONLY | O_DIRECTORY | O_NOFOLLOW`): the root by its
  realpath (`fs.realpathSync.native`, raw bytes), every later component as
  `/proc/self/fd/<parentFd>/<segment>`, each verified with `readlink("/proc/self/fd/<fd>")` (raw bytes)
  against the UTF-8 bytes of the expected absolute path. `fstat(fd, { bigint: true })` gives
  `devIno` as exact decimal `dev:ino`; `statfs` gives `fsType` (`"0x" + (f_type >>> 0).toString(16)`);
  `lstat` is used for the native lookup of the basename, the `.git` probe of `a_1 … a_(k−1)` (never the
  root) and the ELOOP/ENOTDIR follow-up; `opendir`/`readdir` reads one parent listing per target with
  buffer names; every descriptor is closed. No regular file is opened and no file content is read by
  this module; nothing is created, written, renamed or deleted. Reading a directory may update its atime
  depending on mount options.
- **Live binding (§2.2).** Before pass 1 and after pass 2 the live revision and snapshot token are
  recomputed with the existing `readProjectRevision` + `collectContextSources` (excluded paths =
  `nestedProjectPaths`) + `createProviderSnapshot`, exactly like `project-impact-service.js`. The
  collector reads file contents under its own caps; the new code reads none.
- **Two passes (G3).** Every descriptor is closed after pass 1 and the chain is re-walked from the root.
  Any difference in chain states, `fsType`, `devIno`, reach or listing (raw-byte name multiset) between
  the passes is `listing_changed`; the native lookup is compared by class (`ENOENT` / `present` /
  `error`; P-6).
- **Complete or explicitly incomplete (G6).** Every way of not seeing a name is `complete:false` with a
  §2.4 `incompleteReason`. `filtersApplied` is always `[]`.
- **S2a.** Names matching the shared secret predicate are counted in `redactedSecretEntryCount` and never
  listed; `entryCount === entries.length + redactedSecretEntryCount`.
- **Filesystem allow-list (G12).** `0xef53` (ext2/3/4), `0x58465342` (xfs), `0x9123683e` (btrfs),
  `0x1021994` (tmpfs). Anything else (WSL2 `/mnt/*` 9p `0x1021997`, overlayfs `0x794c7630`, NTFS, FUSE,
  FAT, exFAT, CIFS/SMB, NFS, …) makes the target `complete:false, filesystem_unsupported`; the walk still
  continues to the parent and every other target is still walked (r3.4 PIN-5). The box's overlayfs
  `/tmp` and WSL `/mnt/*` worktrees therefore always give UNKNOWN.
- **Platform (G8).** One `lstat("/proc/self/fd")` per call, after the input checks, the Unicode gate and
  the path checks, before pass 1. If it fails (or `O_NOFOLLOW`, `O_DIRECTORY` or `fs.statfsSync` is
  missing), every target not already decided by P-2/P-5 is `descriptor_verification_unavailable` with an
  empty chain and no directory is opened. macOS therefore always gives UNKNOWN.

## Records

- Ancestor chain = root element `{ path: "", … }` first, then `s1`, `s1/s2`, … up to the parent, ending at
  the first non-`directory` state (§1.2 errno map). `fsType`/`devIno` are non-null exactly for
  `directory` elements.
- `enumeration` is `null` in exactly four situations: (a) the chain did not reach the parent (including
  every empty chain); (b) `entry_cap` (more than 1024 entries); (c) `witness_byte_cap`; (d) the parent
  was reached but its listing cannot be represented faithfully (a non-UTF-8 sibling name, a sibling name
  over 255 bytes, or a read error after a successful open). Case (d) is decided by that **condition**;
  the emitted reason follows the priority below, so a higher reason (for example `token_mismatch`) on an
  unrepresentable listing still has `enumeration: null` (Reviewer note N34-1). A partial, empty or lossy
  `entries` list is never emitted.
- Scope-out records (`absent`, `symlink`, `not_directory`, `repository_boundary`, `nested_project`,
  `device_boundary`) carry `ancestor_scope_out` (r3.4 GAP 2) unless a higher reason applies; their
  verdict is `parent_absent` / `ancestor_boundary` either way.
- **Reason priority (r3.4 PIN-2).** Pre-FS reasons first (`unicode_version_mismatch` › `segment_cap` ›
  path-level `non_utf8_name`), then `descriptor_verification_unavailable` › `listing_changed` ›
  `revision_changed` › `token_mismatch` › `filesystem_unsupported` › `unreadable` / `ancestor_scope_out` ›
  `entry_cap` › `non_utf8_name` › `name_too_long` › `native_lookup_error`. `witness_byte_cap` is a
  post-walk replacement.
- **Verdict.** The producer computes the same verdict the composer's R8 recomputes: boundary ›
  `parent_absent` › unreadable › incomplete › empty parent › native `present` › byte-equal entry ›
  dual-key collision › S2a rule (`n > 0` and `SECRET(K(base))` or `SECRET(Kk(base))`) › shape rule
  (`K` or `Kk` empty, or `~` followed by a digit) › `absent`.
- **Binding (P-4).** Top-level `projectId`, `repositoryId`, `worktreeId`, `project`, `revision` and
  `snapshotToken` are always the caller's expected values. On a mismatch the first differing pass
  supplies `provenance = { bindingMismatchReason, liveSnapshotToken, liveRevision }`; revision is
  preferred when both differ (PIN-3); an unavailable live observation is `live_observation_unavailable`.

### Implementation readings (not pinned verbatim by the contract; all fail closed)

- Every emitted observation (chain, enumeration, native lookup) comes from **pass 2**; pass 1 is only the
  bracket comparison. This extends P-6 ("the emitted `nativeLookup` is the pass-2 value") to the chain
  and listing; a difference is `listing_changed` in any case.
- The live observation runs before pass 1 and after pass 2 whenever the Unicode gate passes, including
  when G8 fails (§2.2 is read literally); with G8 failed no directory is opened by the producer's walk.
  Order: G8 `lstat` → live observation 1 → pass 1 → `afterFirstPass` → pass 2 → live observation 2.
- `observation.revisionStable` / `tokenStable` are `true` when both live observations produced a value and
  the two values are equal. A `complete:true` record additionally requires both to equal the expected
  values (otherwise every target is `revision_changed` / `token_mismatch`).
- A readlink **mismatch** on a component (G8) ends the chain before that component (the verified prefix
  is kept), consistent with the empty chain P-1 prescribes for an unverifiable root; a readlink **errno**
  is `unreadable` (§1.2).
- When the root path cannot be resolved by `realpath`, the root element is `unreadable`.
- **Name decoding (R-N3).** Every name read from the filesystem (listing entries, the root realpath) is
  decoded from its raw bytes with a fatal, BOM-preserving UTF-8 decoder
  (`new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`). A leading U+FEFF is kept, so a sibling
  `EF BB BF 78 2E 6A 73` is listed as `"\uFEFFx.js"`, distinct from `x.js` (§1.5, §2.1 case (d), §2.4); a
  target `x.js` next to it is a `K`/`Kk` collision, so `unknown`. Invalid UTF-8 is `non_utf8_name` (listing)
  or an `unreadable` root (realpath).
- **Byte-exact path verification (R-N2).** The root realpath is taken with `fs.realpathSync.native` in
  `buffer` encoding (the JS `fs.realpathSync` decodes each component lossily and can resolve to a
  different directory whose name is literally U+FFFD); a realpath that is not valid UTF-8 makes the root
  element `unreadable`. Every `readlink("/proc/self/fd/<fd>")` result is compared with the expected
  absolute path as raw bytes, never as a decoded string, so a lossy decode can only give
  `descriptor_verification_unavailable`, never a match.

## Witness byte cap (§2.4, G9)

After both passes every record is built in full. With `F_i` the canonical size of the full record,
`M_i` that of the minimal `witness_byte_cap` form and `m_i = min(F_i, M_i)`,
`S0 = size(witness with targets: []) + Σ m_i + (n − 1)`. If `S0 > 49152` the producer throws
`create_absence_witness_byte_cap_exceeded` and returns no witness. Otherwise, in `targets[]` order, a
record stays full iff `S0 + Σ(Δ kept) + Δ_i ≤ 49152` with `Δ_i = F_i − m_i`; else it is replaced by the
minimal form. The S0 pre-throw and the post-selection re-check of the emitted size are redundant with
each other (either alone meets §2.4; R-N1, Tester N-1) and are both kept as defence in depth. Records with `F_i ≤ M_i` (empty-chain `segment_cap` / path `non_utf8_name`) are never
capped. The emitted canonical JSON is always ≤ 49152 UTF-8 bytes. The only other throw is
`invalid_create_absence_witness_request` (exact input, §2.6 P-8). Neither is a composer reason code.

## Keys `K` and `Kk` (§1.5)

- `K(x) = post(NFD17(fold_CF17(NFD17(x))))` with full case folding (C+F) from Unicode 17.0.0
  `CaseFolding.txt` (sha256 `ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183`).
- `Kk(x) = post(KM(x))`. `KM` models the Linux `UTF8_NFDICF` key (tag `v6.17`, UCD 12.1.0 table): per
  code point the fully expanded fold-then-decompose mapping of the generated table `T12`, default
  ignorables as empty stoppers, canonical ordering by the 12.1.0 CCC of the emitted characters. `KM` is
  table-driven and never calls `String.prototype.normalize`.
- `post` = U+0131 → `i` and delete U+0307 (P4), delete Default_Ignorable_Code_Point (P5), trim trailing
  spaces/dots (P6), NFD (P7).
- Collision: `K` equal **or** `Kk` equal (pairwise; not transitive).
- The tables are generated by `scripts/gen-create-name-key-tables.mjs`, an independent implementation from
  the Unicode Standard and the UCD formats. No Linux kernel source, table or port is in the repository
  (GPL-2.0); the kernel is only an out-of-repo cross-check: the canonical KM listing reproduces the
  pinned digest **KM-3** `35428a6864b7ee7c3b842135f952c9163b68d4e7238f26149ff26d2b2061c97a` and the no-DI variant
  **KM-3b** `b08a8500c7c6fa9e28a021745ded7a0f1fd759ff22738cdc9f7d9675827367a3` (the shipped v6.12 table).
- Data from the Unicode Character Database is used under the Unicode License v3
  (`vendor/unicode/LICENSE-UNICODE-V3.txt`, `src/lib/unicode-data/LICENSE-UNICODE-V3.txt`).

## Runtime dependence

Results need a runtime reporting `process.versions.unicode === "17.0"` (Node 26 line; reference
v26.8.2). On any other runtime (including a Node build without ICU) the producer makes **no** filesystem,
git, collector or snapshot access and marks every target `complete:false, unicode_version_mismatch`
(P-3), so every create is UNKNOWN. **A runtime upgrade to a later Unicode version disables lifts until a
new contract revision re-pins it and is re-reviewed.** Tests read the version only through the internal
`options.runtimeUnicodeVersion` seam (presence decided by `Object.hasOwn`; an explicit `undefined` is a
mismatch); no test mutates `process.versions`.

## Residuals (contract §3.4)

- **R-K (kernel table in JS).** `Kk` models the kernel table instead of asking the kernel. Existing
  entries are always checked by the native `lstat` through the real kernel, so drift can only weaken
  declared-target independence for exotic pairs in casefold (`+F`) ext4/tmpfs directories; tmpfs mounted
  with an encoding view ≤ 3.2.0 and distribution patches to `fs/unicode` are accepted drift sources.
- **Point in time.** PROVEN-ABSENT (later, in the composer) means absent at the bracketed observation; no
  write-time guarantee; `requiresReobservation: true`.
- **Unauthenticated data.** `listingDigest` is a self-checksum; a self-consistent fabricated witness cannot
  be detected (same trust boundary as Pack/Impact).
- **Empty parent → UNKNOWN** (NF-2), so the first file of an empty directory is never proven absent.
- **Byte-cap utility cost.** Several targets in one large parent each carry the same listing, so later
  targets can be capped; pathological path lengths can make even the smallest witness exceed the cap
  (then no witness and every create is UNKNOWN).
- **Allow-list cost.** Overlayfs and WSL `/mnt/*` worktrees always give UNKNOWN.

## Tests

- `tests/create-destination-absence-witness.test.js`: PA-1 … PA-38 with the sub-lettered ids (PA-10b,
  PA-11b, PA-12b, PA-17b, PA-18b … PA-18f, PA-21b, PA-21c, PA-26b), plus the fix-round tests: B-1 / G-a(a)
  and G-a(b) (real-FS BOM-prefixed siblings), N-2 (white-box: the exported pure
  `s2aSecretRuleRequiresUnknown` fires on `SECRET(Kk)` alone and on `SECRET(K)` alone), and R-N2 (a
  non-UTF-8 root realpath with a U+FFFD look-alike directory; no native realpath on a Unicode mismatch; N-F1: seam readlink bytes `FF` for an expected `EF BF BD`, component and root, give DVU). Only S2a is implemented: the S1,
  S2b, S3 and S4 rows of PA-18/PA-19 are N/A, and PA-37/PA-38 run under S2a. Real-FS tests run on tmpfs
  (`/dev/shm`) or another allow-listed `os.tmpdir()`.
- `tests/create-name-key.test.js`: KM-1, KM-1b, KM-1c, KM-2 (the ten v6.17 `nfdicf_test_data` vectors as
  data), KM-3, KM-3b, KM-4, FZ-1 (seed `0x5EED0345`, 1,000,000 strings; independent oracle; 0 dual-key
  misses in both model variants).
- `tests/project-context-files.test.js`: PA-26 (D0 identity and `isContextPathAllowed` parity with a
  frozen 55f606c copy).
