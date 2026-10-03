import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const PRODUCER_ID = "hermes-nexus.track-b.direct-coupling";
export const PRODUCER_VERSION = "1";
export const RULE_ID = "agent-manifest.machine-id-rule-source-equality";
export const RULE_VERSION = "1";
export const ANALYSIS_CAPABILITY = "literal-source-equality-and-one-sided-substitution";

export const A_REL = "src/lib/agent-manifest.js";
export const B_REL = "docs/project-icm.md";
export const AUTHORITY_REL = "docs/project-icm.md";

const HEADING = "## Machine-ID rule";
const AUTHORITY_SENTENCE = "Machine IDs for workspace IDs and agent IDs must match the implemented parser rule:";
const DOTDOT_SENTENCE = "Additional parser rule: IDs containing `..` are rejected.";
const PARSER_CITATION = "- `src/lib/agent-manifest.js`: canonical `AGENT.md` parser.";
const PATTERN_PREFIX = "const ID_PATTERN = /";
const PATTERN_SUFFIX = "/;";
const DELTA_FROM = "[a-z0-9.-]";
const DELTA_TO = "[a-z0-9._-]";
const PROBE = "a_b";
const HASH_COMMAND_FILE = "sha256 of the exact worktree bytes from fs.readFileSync, via node:crypto createHash('sha256').update(buffer).digest('hex')";
const HASH_COMMAND_BLOB = "sha256 of the exact bytes from git cat-file -p HEAD:<path>, via node:crypto createHash('sha256').update(buffer).digest('hex')";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function gitText(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).replace(/\n$/, "");
}

function gitBytes(root, args) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function requireOnce(text, needle, label) {
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`missing ${label}`);
  if (text.indexOf(needle, at + needle.length) !== -1) throw new Error(`ambiguous ${label}`);
  return { index: at, line: lineOf(text, at) };
}

export function extractDocumentedMachineIdRegex(text) {
  const heading = requireOnce(text, HEADING, "machine-id heading");
  const fenceAt = text.indexOf("```txt\n", heading.index);
  if (fenceAt < 0) throw new Error("missing machine-id regex fence");
  const start = fenceAt + "```txt\n".length;
  const end = text.indexOf("\n```", start);
  if (end < 0) throw new Error("unclosed machine-id regex fence");
  const regex = text.slice(start, end);
  if (regex.includes("\n") || regex.length === 0) throw new Error("machine-id regex fence is not one line");
  return { regex, line: lineOf(text, start) };
}

export function extractIdPattern(text) {
  const marker = requireOnce(text, PATTERN_PREFIX, "ID_PATTERN");
  const start = marker.index + PATTERN_PREFIX.length;
  const end = text.indexOf(PATTERN_SUFFIX, start);
  if (end < 0) throw new Error("unclosed ID_PATTERN");
  const regex = text.slice(start, end);
  if (regex.includes("\n") || regex.length === 0) throw new Error("ID_PATTERN is not one line");
  return { regex, start, end, line: lineOf(text, start) };
}

function dotDotInNormalizeId(text) {
  const norm = text.indexOf("function normalizeId");
  if (norm < 0) return null;
  const at = text.indexOf('value.includes("..")', norm);
  if (at < 0) return null;
  return { line: lineOf(text, at) };
}

export function applyIdPatternDelta(source) {
  const pattern = extractIdPattern(source);
  if (pattern.regex.split(DELTA_FROM).length !== 2) {
    throw new Error("ID_PATTERN does not contain exactly one [a-z0-9.-] class");
  }
  const changed = pattern.regex.replace(DELTA_FROM, DELTA_TO);
  const next = source.slice(0, pattern.start) + changed + source.slice(pattern.end);
  const again = extractIdPattern(next);
  if (again.regex !== changed) throw new Error("delta did not stay inside ID_PATTERN");
  return { before: pattern.regex, after: changed, source: next };
}

function requireObservation(observation) {
  if (!observation || typeof observation !== "object") throw new Error("observation required");
  for (const key of ["projectId", "repositoryIdentity", "worktreeId", "pack", "git"]) {
    if (typeof observation[key] !== "object" && (observation[key] === undefined || observation[key] === null || observation[key] === "")) {
      throw new Error(`missing observation.${key}`);
    }
  }
  if (typeof observation.projectId !== "string" || observation.projectId.length === 0) throw new Error("missing projectId");
  if (typeof observation.repositoryIdentity !== "string" || !/^[a-f0-9]{64}$/.test(observation.repositoryIdentity)) {
    throw new Error("repositoryIdentity must be the observed 64-hex value");
  }
  if (typeof observation.worktreeId !== "string" || !/^[a-f0-9]{64}$/.test(observation.worktreeId)) {
    throw new Error("worktreeId must be the observed 64-hex value");
  }
  const pack = observation.pack;
  for (const key of ["projectId", "branch", "commitSha", "httpStatus"]) {
    if (pack[key] === undefined || pack[key] === null || pack[key] === "") throw new Error(`missing pack.${key}`);
  }
  if (typeof pack.dirty !== "boolean") throw new Error("pack.dirty must be the observed boolean");
  if (typeof pack.hasRepositoryIdField !== "boolean") throw new Error("pack.hasRepositoryIdField must be the observed boolean");
  if (pack.hasRepositoryIdField && (typeof pack.repositoryId !== "string" || pack.repositoryId.length === 0)) {
    throw new Error("pack.repositoryId missing");
  }
  if (pack.projectId !== observation.projectId) throw new Error("observation projectId does not match the pack");
  if (pack.repositoryIdentity !== observation.repositoryIdentity) throw new Error("observation repositoryIdentity does not match the pack");
  if (pack.worktreeId !== observation.worktreeId) throw new Error("observation worktreeId does not match the pack");
  if (typeof observation.git.head !== "string" || typeof observation.git.branch !== "string") throw new Error("missing git observation");
}

export function produceStrongDirectCouplingWitness(checkoutRoot, observation) {
  requireObservation(observation);
  const head = gitText(checkoutRoot, ["rev-parse", "HEAD"]);
  const branch = gitText(checkoutRoot, ["branch", "--show-current"]);
  if (head !== observation.git.head) throw new Error("git HEAD does not match the observation");
  if (branch !== observation.git.branch) throw new Error("git branch does not match the observation");
  if (head !== observation.pack.commitSha) throw new Error("pack commitSha does not match git HEAD");

  const aBytes = fs.readFileSync(path.join(checkoutRoot, A_REL));
  const aHeadBytes = gitBytes(checkoutRoot, ["cat-file", "-p", `HEAD:${A_REL}`]);
  const bBytes = gitBytes(checkoutRoot, ["cat-file", "-p", `HEAD:${B_REL}`]);
  if (!Buffer.isBuffer(aBytes) || !aBytes.equals(aHeadBytes)) {
    throw new Error("A worktree bytes are not the HEAD blob; refusing to bind A");
  }
  const aText = aBytes.toString("utf8");
  const bText = bBytes.toString("utf8");

  const documented = extractDocumentedMachineIdRegex(bText);
  const authority = requireOnce(bText, AUTHORITY_SENTENCE, "authority sentence");
  const citation = requireOnce(bText, PARSER_CITATION, "parser citation");
  const dotDoc = requireOnce(bText, DOTDOT_SENTENCE, "documented dot-dot rule");
  const pattern = extractIdPattern(aText);
  const dotCode = dotDotInNormalizeId(aText);
  if (!dotCode) throw new Error("normalizeId does not reject '..'");

  if (pattern.regex !== documented.regex) {
    throw new Error("invariant is not initially satisfied; not emitting an established witness");
  }

  const delta = applyIdPatternDelta(aText);
  const changed = extractIdPattern(delta.source);
  const documentedAfter = extractDocumentedMachineIdRegex(bText);
  if (changed.regex === documentedAfter.regex) throw new Error("A-only change did not break the invariant");
  if (documentedAfter.regex !== documented.regex) throw new Error("B bytes changed during the one-sided check");

  const original = new RegExp(pattern.regex);
  const widened = new RegExp(changed.regex);
  const stated = new RegExp(documentedAfter.regex);
  if (original.test(PROBE) !== false || stated.test(PROBE) !== false || widened.test(PROBE) !== true || PROBE.includes("..")) {
    throw new Error("probe did not demonstrate a one-sided violation");
  }

  const aSha = sha256(aBytes);
  const bSha = sha256(bBytes);
  const headA = gitText(checkoutRoot, ["rev-parse", `HEAD:${A_REL}`]);
  const headB = gitText(checkoutRoot, ["rev-parse", `HEAD:${B_REL}`]);
  const workA = gitText(checkoutRoot, ["hash-object", A_REL]);
  const workB = gitText(checkoutRoot, ["hash-object", B_REL]);
  const aCovers = headA === workA;
  const bCovers = headB === workB;
  const branchesMatch = branch === observation.pack.branch;

  const howObserved = { ...(observation.howObserved ?? {}) };
  if (howObserved.repositoryId !== undefined && howObserved.repositoryIdentity === undefined) {
    howObserved.repositoryIdentity = howObserved.repositoryId;
  }
  delete howObserved.repositoryId;
  howObserved.contentHashes = "A: sha256 of worktree bytes, checked byte-equal to git cat-file -p HEAD:src/lib/agent-manifest.js. B and authority: sha256 of git cat-file -p HEAD:docs/project-icm.md.";
  const bNote = bCovers
    ? "sha256 is of git cat-file -p HEAD:docs/project-icm.md, and the worktree file matches that blob."
    : "sha256 is of git cat-file -p HEAD:docs/project-icm.md at the bound revision. The worktree file differs from that blob, so dirty worktree bytes are not this hash. Invariant, initial satisfaction, and the one-sided check use the revision bytes.";

  return {
    producer: { id: PRODUCER_ID, version: PRODUCER_VERSION },
    rule: { id: RULE_ID, version: RULE_VERSION },
    analysisCapability: ANALYSIS_CAPABILITY,
    pair: {
      direction: "A_to_B",
      A: {
        artifactPath: A_REL,
        locus: { symbol: "ID_PATTERN", line: pattern.line, excerpt: `${PATTERN_PREFIX}${pattern.regex}${PATTERN_SUFFIX}` }
      },
      B: {
        artifactPath: B_REL,
        locus: { heading: HEADING, line: documented.line, excerpt: documented.regex }
      }
    },
    invariant: {
      statement: "ID_PATTERN's regex source in src/lib/agent-manifest.js must equal the single fenced Machine-ID rule in docs/project-icm.md, and normalizeId must reject values containing \"..\" because that same rule rejects them.",
      check: "extracted ID_PATTERN source === fenced Machine-ID regex, and normalizeId contains value.includes(\"..\"), and the authority contains the dot-dot rejection sentence."
    },
    authority: {
      artifactPath: AUTHORITY_REL,
      locus: {
        parserCitationLine: citation.line,
        parserCitation: PARSER_CITATION,
        ruleSentenceLine: authority.line,
        ruleSentence: AUTHORITY_SENTENCE,
        dotDotSentenceLine: dotDoc.line,
        dotDotSentence: DOTDOT_SENTENCE,
        regexLine: documented.line,
        regex: documented.regex
      }
    },
    triggeringChange: {
      on: "A",
      condition: "In ID_PATTERN only, replace the unique interior class [a-z0-9.-] with [a-z0-9._-]. Leave every other byte of A, and all of B, unchanged.",
      discriminatingId: PROBE
    },
    initialSatisfaction: {
      satisfied: true,
      idPatternSource: pattern.regex,
      documentedRegex: documented.regex,
      equal: true,
      normalizeIdRejectsDotDot: true,
      normalizeIdDotDotLine: dotCode.line,
      authorityRejectsDotDot: true
    },
    oneSidedViolation: {
      shown: true,
      aOnly: true,
      bChanged: false,
      idPatternSourceAfter: changed.regex,
      documentedRegexAfter: documentedAfter.regex,
      equalAfter: false,
      probe: PROBE,
      probeMatchesChangedA: true,
      probeMatchesUnchangedDocumentedRule: false,
      probeContainsDotDot: false
    },
    consistencyObligation: {
      at: "B",
      mustChange: "The fenced Machine-ID regex must become ^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$ so it equals the changed ID_PATTERN source. An unchanged fence still rejects a_b while the changed parser accepts it.",
      requiredRegex: delta.after
    },
    binding: {
      projectId: observation.projectId,
      repositoryIdentity: observation.repositoryIdentity,
      repositoryIdentityObservedField: "data.revision.repositoryIdentity",
      packContainedRepositoryIdKey: observation.pack.hasRepositoryIdField,
      ...(observation.pack.hasRepositoryIdField ? { repositoryId: observation.pack.repositoryId, repositoryIdObservedField: "data.revision.repositoryId" } : {}),
      worktreeId: observation.worktreeId,
      worktreeIdObservedField: "data.revision.worktreeId",
      revision: head,
      gitBranch: branch,
      packBranch: observation.pack.branch,
      branchesMatch,
      packDirty: observation.pack.dirty,
      packCommitSha: observation.pack.commitSha,
      packHttpStatus: observation.pack.httpStatus,
      howObserved,
      contentHashes: {
        A: {
          artifactPath: A_REL,
          sha256: aSha,
          hashIsRevisionBytes: true,
          bytesSource: "worktree file bytes, byte-equal to git cat-file -p HEAD:src/lib/agent-manifest.js",
          hashCommand: HASH_COMMAND_FILE,
          gitHashObject: workA,
          headBlob: headA,
          worktreeBytesMatchHeadBlob: aCovers,
          note: aCovers ? "Worktree bytes match the HEAD blob." : "Hashed bytes are not the HEAD blob."
        },
        B: {
          artifactPath: B_REL,
          sha256: bSha,
          hashIsRevisionBytes: true,
          bytesSource: "git cat-file -p HEAD:docs/project-icm.md",
          hashCommand: HASH_COMMAND_BLOB,
          gitHashObject: workB,
          headBlob: headB,
          worktreeBytesMatchHeadBlob: bCovers,
          machineIdLocusMatchesHeadBlob: true,
          note: bNote
        },
        authority: {
          artifactPath: AUTHORITY_REL,
          sha256: bSha,
          hashIsRevisionBytes: true,
          bytesSource: "git cat-file -p HEAD:docs/project-icm.md",
          sameBytesAsB: true,
          hashCommand: HASH_COMMAND_BLOB,
          gitHashObject: workB,
          headBlob: headB,
          worktreeBytesMatchHeadBlob: bCovers,
          authorityLocusMatchesHeadBlob: true,
          note: bNote
        }
      }
    },
    proposedSourceDelta: {
      notACommit: true,
      boundToArtifact: A_REL,
      boundToRevision: head,
      boundToContentSha256: aSha,
      revisionCoversHashedBytes: aCovers,
      from: delta.before,
      to: delta.after,
      occurrencesInsideIdPattern: 1
    },
    coverage: {
      covers: [
        "the single ID_PATTERN literal",
        "the single fenced Machine-ID regex",
        "the '..' rejection in normalizeId and in the authority sentence"
      ],
      assumptions: [
        "The Machine-ID section is normative for the canonical parser it names, so the fenced regex must stay equal to ID_PATTERN.",
        "The fence and ID_PATTERN are each unique and are literal text, not computed or merged.",
        "Compared regex text excludes the JavaScript / delimiters.",
        "Binding ids are copied from the supplied task-context re-observation and checked against git rev-parse. This producer has no built-in project, repository, worktree, revision, or hash constants."
      ],
      unresolvedOrOmitted: {
        requiredPartsUnresolved: [],
        requiredPartsOmitted: [],
        declaredOutOfScope: [
          "src/lib/workspace-scope.js WORKSPACE_ID_PATTERN repeats this regex but is not named by the authority. This witness does not establish or deny coupling for that file.",
          "Other AGENT.md bounds in the same document are outside this pair.",
          "Track A symbol uniqueness is not claimed. No RESERVED item is emitted."
        ]
      }
    }
  };
}
