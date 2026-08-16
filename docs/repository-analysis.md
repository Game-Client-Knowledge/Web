# Repository Analysis

## Initial state

The original content repository contained 28 tracked files:

- Three technical areas at the repository root: C++, ECS, and interview fundamentals.
- One `experience/` tree containing a single MiHoYo interview series.
- One runnable C++ example nested inside that interview series.
- One maintainer-tool design document mixed with reader-facing content.
- Hand-maintained root and topic indexes.

The Markdown quality was already suitable for a documentation site: documents had
clear H1 titles, ordered chapter names, relative links, fenced code blocks, tables,
and Mermaid diagrams.

## Structural problems

### Content type and topic were mixed

Root folders represented different concepts. `ecs-system/` was a topic,
`experience/` was a content type, and `knowledge-architect-skill/` was an internal
tool description. A website scanner could not infer a consistent first-level
navigation model.

### Navigation required duplicate maintenance

Adding a chapter required updating both the Markdown index and, in a conventional
documentation framework, a website sidebar configuration. This creates merge
conflicts in a multi-contributor repository and allows indexes to become stale.

### Examples had no global discovery path

The runnable C++ example was owned by an interview directory. Readers looking for
code could only find it after opening the matching interview answer.

### Website and content had no release boundary

Keeping a generator in the content repository would make content pull requests
touch dependency metadata, templates, or generated artifacts. It would also give
all content contributors an unnecessarily large build surface.

## Migration

| Original path | New path |
|---|---|
| `cpp-fundamentals/` | `knowledge/cpp/` |
| `ecs-system/` | `knowledge/ecs/` |
| `game-client-interview/` | `knowledge/interview-roadmap/` |
| `experience/MiHoYo/.../` | `interviews/mihoyo/2026-autumn-early-game-client-source-code/` |
| Interview-local `example/third-round-algorithms/` | `examples/algorithms/mihoyo-third-round/` |

Chinese document filenames in the interview series were changed to stable ASCII
routes while their Chinese H1 titles were preserved. Cross-topic links were updated
to the new locations.

The maintainer-tool design document was removed from the content repository because
it was neither game-client knowledge, an interview record, nor a runnable example.
Its useful information-architecture constraints are represented by the scanner,
audit script, and architecture documentation in this repository.

## Result

The content repository now has one responsibility: store readable source material.
The website repository owns parsing, presentation, search, validation, and
deployment. Contributors can add a knowledge system with a directory and Markdown
files only.
