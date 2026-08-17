# Dynamic Top-Level Content Modules

## Discovery Rule

Every non-hidden top-level directory with a `README.md` is a website module.
Adding a module does not require changing the Web repository.

The three built-in modules retain their defaults:

```text
knowledge/
interviews/
examples/
```

Additional modules are discovered from the content repository at build time.

## Module README

Module presentation metadata lives in the module's own `README.md` frontmatter:

```markdown
---
shortTitle: 图形
icon: shapes
accent: gold
allowCode: true
order: 40
---
# 图形与渲染

实时渲染知识、图形 API 与配套源码。
```

Supported values:

| Field | Purpose |
| --- | --- |
| `shortTitle` | Compact primary-navigation label |
| `icon` | Lucide icon name selected by the editor |
| `accent` | `teal`, `orange`, or `gold` |
| `allowCode` | Include source files as readable website documents |
| `order` | Optional module navigation order |

The H1 is the module title. The first prose paragraph is the fallback
description.

## Topic Hierarchy

Every directory below a top-level module that contains a `README.md` defines a
topic. Topic depth follows directory depth instead of being flattened:

```text
knowledge/                         website module
└── cpp/                           topic: C++ basics
    ├── README.md
    └── polymorphism/              child topic: polymorphism
        └── README.md
```

The catalog records each topic's parent, ancestors, children, and depth. The
homepage lists only root topics. Module directories and reader navigation
render child topics beneath their parent, and reader breadcrumbs include the
full ancestor chain.

Markdown files belong to the deepest ancestor directory that contains a
`README.md`. A nested topic therefore stays under its owning topic without any
additional website configuration.

Within each topic, the module directory orders content by type:

1. Child topics, recursively.
2. Files owned directly by the current topic.

Numeric file prefixes still determine ordering inside the file group.

## Online Creation

The full editor exposes **Add top-level module** in the repository sidebar.
Module pages also link to the same entry.

Creating a module produces one private draft:

```text
<module-slug>/README.md
```

The operation rejects a directory that already exists in GitHub or in any user's
draft workspace. The module becomes part of public navigation after its Draft PR
is merged and the content release is rebuilt.

## Nested Creation Context

Reader creation controls resolve their destination from the currently displayed
source path, not only from the statically generated page.

For example, while previewing this draft:

```text
knowledge/ecs/runtime/README.md
```

**New file** resolves to:

```text
knowledge/ecs/runtime/<filename>
```

This also applies before the draft has been merged or received its own static
route. Unit-list controls that explicitly target another directory continue to
use that explicit directory.

## Validation

Top-level keys must be lowercase path slugs and cannot use reserved application
directory names. `knowledge` and `interviews` remain Markdown-only. `examples`
and dynamic modules may store supported source extensions; dynamic source files
are indexed only when the module README sets `allowCode: true`.

Submission validates that every dynamic root includes its top-level
`README.md`, either in the current `main` tree or in the same draft set. A
submission cannot delete that README because doing so would make the remaining
module content undiscoverable.
