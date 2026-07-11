# EMAP Project — Agent Rules

## Knowledge Format

This repository follows the **[Google Open Knowledge Format (OKF) v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)** specification. All agents interacting with this codebase **must** adhere to the conventions below.

### OKF Core Principles

1. **Every document is a Concept** — Each `.md` file (except `index.md` and `log.md`) represents a single unit of knowledge (a "Concept" in OKF terms).
2. **YAML frontmatter is required** — Every concept document must begin with a `---` delimited YAML frontmatter block containing at minimum the `type` field.
3. **Directory hierarchy is meaningful** — Subdirectories represent logical groupings (e.g., `hardware/`, `objectives/`, `software/`). Each directory should have an `index.md` listing its children.
4. **`log.md` tracks history** — The root `log.md` is the chronological changelog of the knowledge bundle. Append entries when significant structural or content changes are made.
5. **Links express relationships** — Use standard markdown links to reference other concepts within the bundle, creating a navigable knowledge graph.

### Frontmatter Schema

When creating or modifying concept documents, use this frontmatter template:

```yaml
---
type: <concept type>           # REQUIRED — e.g., objective, hardware, experiment, software, schedule, team, reference, research
title: "<Display Title>"       # Recommended — human-readable title
description: "<One-line summary>"  # Recommended — used in index listings
timestamp: <ISO 8601 datetime>    # Recommended — last modified time
tags: [tag1, tag2, ...]         # Optional — for filtering and categorization
---
```

### Reserved Filenames

| Filename | Purpose |
|----------|---------|
| `index.md` | Directory listing for progressive disclosure — NOT a concept document |
| `log.md` | Chronological update history — NOT a concept document |

### Concept Types in Use

The following `type` values are currently used in this bundle:

| Type | Description | Example Location |
|------|-------------|-----------------|
| `objective` | Project goals, scope, and justification | `objectives/scope.md` |
| `hardware` | Dev board specs, pinout diagrams, power management | `hardware/lilygo_lora32.md` |
| `software` | System architecture, data flow, database schemas | `software/system_architecture.md` |
| `experiment` | Test protocols, lab reports, validation results | `experiments/indoor_positioning.md` |
| `schedule` | Timeline, task tracking, operational schedules | `organization/timeline.md` |
| `team` | Team members, roles, and credentials | `organization/team.md` |
| `reference` | Academic citations and bibliography | `research/references.md` |
| `research` | Development links, SDKs, and API documentation | `research/links.md` |

### Agent Guidelines

- **When creating new documents**: Always include the full frontmatter block with `type`, `title`, `description`, and `timestamp`. Update the parent directory's `index.md` to include a link to the new document.
- **When modifying documents**: Update the `timestamp` in the frontmatter. If the change is significant, add an entry to `log.md`.
- **When adding directories**: Create an `index.md` inside the new directory with a listing of its contents, and add a reference in the parent `index.md`.
- **Language**: This project's documentation is written in **Brazilian Portuguese (pt-BR)**. All new content should follow this convention unless explicitly stated otherwise.
- **Linking conventions**: Use relative markdown links between documents within the bundle (e.g., `[Scope](objectives/scope.md)`). Use absolute `file://` links only in agent-generated metadata where required by tooling.

## Code Style

- Commit messages follow the **Conventional Commits** pattern: `type(scope): description`
  - Types: `docs`, `feat`, `fix`, `refactor`, `test`, `chore`
  - Scopes: `hardware`, `software`, `objectives`, `organization`, `research`, `experiments`
