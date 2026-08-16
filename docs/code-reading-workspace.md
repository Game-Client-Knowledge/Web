# Code Reading Workspace

## Responsibility boundary

The code workspace is independent from the long-form content scanner:

```text
Content repository
  code/<domain>/<project>/code-project.json
        |
        v
Build-time code project processor
  project and file metadata only
        |
        v
Static JSON + declared raw text files
        |
        v
Browser workspace + Web Worker + Tree-sitter WASM
```

FastAPI is not part of source loading, search, syntax parsing, symbol lookup, or
navigation. Nginx serves immutable static files from the selected content
commit.

## Build-time processor

`lib/code-project-loader.js` discovers `code-project.json` files below `code/`.
It validates:

- Schema version and globally unique project ID.
- Safe project-relative paths.
- Existing entry and README files.
- Explicit text extensions.
- Default and project-specific excluded directories.

The processor emits file path, language, parser, byte size, line count, and
recommended-reading metadata. It never embeds source contents in the generated
project index.

`code-projects/index.json` contains the project manifests consumed by the
workspace. Only files listed by the processor are copied to `_site/raw/code`;
ignored local build output cannot leak through Eleventy passthrough copying.

## Client runtime

The browser initially fetches:

1. The project index.
2. The requested entry file.

After the main UI is ready, an idle task fetches remaining declared text files
with bounded concurrency. Those contents stay in the page memory cache and
provide full-project substring search without API requests.

Parser-capable files are sent to `code-worker.js`. The worker loads the
compatible Tree-sitter runtime and only the grammar required by the project.
The current release ships C# and C++ grammars. Syntax parsing produces:

- Namespace, class, struct, interface, record, and enum definitions.
- Methods, constructors, properties, fields, and enum members.
- Identifier references with file, line, and column locations.

The main thread renders syntax highlighting, file tabs, outline entries, search
results, definition choices, and references.

## Navigation

The URL is a durable code location:

```text
/code/workspace/?project=<id>&file=<path>&line=<line>
```

Opening a file or line updates browser history. Links can therefore be shared,
reloaded, and navigated with browser Back/Forward.

Keyboard commands:

| Command | Action |
| --- | --- |
| `Cmd/Ctrl + P` | Focus project file filtering |
| `Cmd/Ctrl + Shift + F` | Focus full-project keyword search |

Clicking an indexed identifier opens its sole definition or a definition picker
when multiple definitions exist. The inspector simultaneously shows all parsed
references.

## Performance limits

- Source contents are lazy and never included in the initial HTML.
- Search and parsing execute in the browser.
- Tree-sitter runs in a Web Worker.
- Only required language WASM is downloaded.
- Generated directories and dependencies are excluded before publication.
- The current ECS project contains 23 files, approximately 78 KB and 2,743
  lines, which is small enough to index after the first render.

Large future projects should be split when their browser index cost becomes
measurable. The project convention intentionally keeps dependency trees and
generated assets outside the reader.

## Content convention

The contributor-facing source of truth is
`code/project-convention.md` in the content repository. It defines manifest
fields, directory rules, mandatory exclusions, README sections, and
pre-submission checks.
