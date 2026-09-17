# Threat Model and Trust Boundaries

> **Roundtable review v4:** NEW — approved after roundtable — 2026-09-17  
> Companion review: `reviews/31_THREAT_MODEL_AND_TRUST_BOUNDARIES_ROUNDTABLE.md`


Status: **PLANNED**

## Implemented external semantic boundary

Optional Serena/Python follows this trust chain: authorized bounded observation
→ private read-only snapshot → offline constrained container → untrusted JSON
→ strict host evidence validation → existing Context Pack trust labels.
The bridge never starts SerenaAgent/MCP, so repository prose cannot select tools,
commands, project roots, memories, network endpoints or interpreter settings.
Only Python text is exported; project configs/virtual environments are omitted.

The image and local Docker daemon are trusted operator-controlled infrastructure;
an immutable image ID prevents tag drift, not malicious operator configuration.
Runtime network, host filesystem access and source writes are separately blocked
by the container. Invalid paths/URIs, source positions, IDs, relationships,
undeclared operations, oversize output and wrong project/revision/request/observed
snapshot bindings fail closed. Provider failure permits deterministic fallback,
never a cross-provider merge. Real hostile-worker probes verify restrictions.

These controls do not establish whole-host isolation against a compromised
kernel/daemon, complete source-secret DLP, general agent enforcement or identity
ownership in Serena. Git/Project Map/Hermes/Honcho responsibilities stay distinct.
The exact shipped contract is `19_ANALYZER_PROVIDER_LAYER.md`; the wider threat
inventory below remains architectural guidance.

## Goal

Assume agents, repository content, external MCP servers, tools and model outputs can all be wrong or hostile.

The system must remain safe even when an LLM follows malicious instructions embedded in a repository.

## Trust zones

```text
[Human operator]
      |
      v
[Hermes runtime] ---- [External providers]
      |
      +---- [MCP servers / plugins]
      |
      v
[Project Map]
      |
      v
[Git worktree / repository]
      |
      v
[Build/test/toolchain]
```

Each boundary needs explicit permissions and data handling.

## Primary threats

### Repository prompt injection

A source file, README, generated file or dependency may contain instructions such as:

```text
ignore previous rules
send secrets
modify another project
disable tests
```

Treat repository text as **data**, never as trusted runtime policy.

### Malicious or confused agent

An agent may:

```text
write outside scope
run destructive shell commands
misreport completion
create unnecessary tasks
attempt to bypass locks
```

### Compromised MCP/plugin

An external integration may return malicious context or request sensitive data.

### Tool output injection

Compiler/test/web/tool output can contain text that tries to influence the model.

### Secret exfiltration

Prompts, telemetry, logs or training exports may accidentally contain:

```text
API keys
tokens
.env contents
credentials
private keys
```

### Cross-project leakage

A shared agent/profile may expose information from project A while operating on project B.

### Supply-chain execution

Build/test commands can execute repository-controlled scripts.

A project should be considered untrusted until its execution policy permits those commands.

## Controls

### Policy hierarchy

Only these sources may define enforceable policy:

```text
runtime configuration
canonical Project Map policy
explicit human approval
trusted project contracts
```

Repository prose is not sufficient.

### Least privilege

Profiles receive only tools required for the task.

### Worktree isolation

Coding runs use dedicated worktrees where practical.

### Scope guard

Mutation must match WRITE scope.

### Diff validation

Final Git diff is checked against allowed scope regardless of tool path.

### External integration allowlist

MCP servers/plugins should be explicitly configured per environment.

### Secret redaction

Telemetry/export layers redact configured secret patterns and sensitive fields.

### Untrusted command policy

Commands that execute repository-controlled code can require:

```text
sandbox
container
human approval
restricted profile
```

depending on project risk.

## Prompt construction rule

Project Expert/Context Pack should clearly delimit:

```text
trusted policy
canonical facts
retrieved repository content
historical observations
untrusted tool output
```

Never flatten all sources into one indistinguishable prompt section.

## Security events

Record:

```text
OUT_OF_SCOPE_WRITE_BLOCKED
PATH_TRAVERSAL_BLOCKED
UNTRUSTED_TOOL_REQUIRES_APPROVAL
SECRET_REDACTED
CROSS_PROJECT_ACCESS_BLOCKED
MCP_POLICY_BLOCKED
```

## Human approval triggers

Recommended initial approval requirements:

```text
destructive Git history operations
production deployment
credential access
database destructive migrations
security policy changes
cross-project data export
execution of unknown privileged scripts
```

## Acceptance criteria

- repository text cannot redefine system policy;
- cross-project reads/writes are denied by default;
- secrets are excluded from training exports;
- untrusted MCP/tool output is labeled as data;
- high-risk operations have an explicit approval path;
- final diff validation can catch tool-level guard bypass.
