# Game Client Knowledge Web

Static reading website for
[Game Client Knowledge](https://github.com/Game-Client-Knowledge/Game-Client-Knowledge).
The website and knowledge content live in separate repositories.

## Local development

Place both repositories in the same parent directory:

```text
ECS/
├── Game-Client-Knowledge/
└── Web/
```

Then run:

```bash
nvm use
npm install
npm run dev
```

The site reads `../Game-Client-Knowledge` automatically. Use
`CONTENT_REPO_PATH=/absolute/path/to/content` to override the source.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local Eleventy development server |
| `npm run build` | Generate the static site in `_site/` |
| `npm run audit` | Validate Markdown, links, routes, and scanner coverage |
| `npm run check` | Run the audit and production build |
| `npm run test:visual` | Check desktop, tablet, and mobile layouts with local Chrome |
| `npm run deploy:join` | Deploy the pushed Web commit's Join page |
| `npm run deploy:server` | Deploy pushed Web and content commits to production |

## Content contract

The generator recognizes three content roots:

```text
knowledge/     # interview fundamentals and technical topics
interviews/    # company, season, and position interview records
examples/      # runnable examples and source files
```

Navigation is inferred from folders and Markdown headings. Adding a topic requires
no website code or manifest change.

## Documentation

- [Repository analysis](./docs/repository-analysis.md)
- [System architecture](./docs/architecture.md)
- [Build and deployment operations](./docs/operations.md)
- [Join page](./docs/join-page.md)
- [Web editing and GitHub contribution design](./docs/web-editing-and-contribution.md)
