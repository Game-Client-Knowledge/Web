# Build and Deployment Operations

## Local workflow

The default workspace layout requires no environment variables:

```text
parent/
├── Game-Client-Knowledge/
└── Web/
```

```bash
nvm use
npm install
npm run check
npm run dev
```

For a different location:

```bash
CONTENT_REPO_PATH=/absolute/path/to/Game-Client-Knowledge npm run dev
```

## Repository creation

The website repository is `Game-Client-Knowledge/Web`. Connect a local clone with:

```bash
git remote add origin \
  https://github.com/Game-Client-Knowledge/Web.git
git push -u origin main
```

The local repository is already initialized independently from the content
repository.

## Production server

The self-hosted production endpoint is:

```text
https://knowledge.chenyurui.top
```

The server uses the following path:

```text
Cloudflare Tunnel
-> 127.0.0.1:8788
-> Nginx
-> /var/www/game-client-knowledge/current
```

Releases are stored under `/var/www/game-client-knowledge/releases/`. Deployment
switches the `current` symlink atomically and retains the five newest releases.
Nginx and Tunnel templates are stored in [`deploy/server/`](../deploy/server/).

After the one-time server bootstrap, deploy from this repository with:

```bash
nvm use
npm run deploy:server
```

The command deploys only pushed commits. Before building, it:

1. Rejects uncommitted or untracked files in both repositories.
2. Fetches `origin/main` for the Web and content repositories.
3. Requires each local `HEAD` to equal its pushed `origin/main`.
4. Builds with the verified content commit metadata.
5. Writes both full SHAs to `.release-source` in the release directory.

The deploy fails before uploading when either repository is dirty, ahead of, or
behind `origin/main`. Override the defaults with `CONTENT_REPO_PATH`, `DEPLOY_HOST`,
`DEPLOY_KEY`, or `RELEASE_ROOT` when required.

The server also runs `game-client-knowledge-update.timer` every 10 minutes. It
checks both repositories through the GitHub API, with a `git ls-remote` and
shallow-fetch fallback when the REST API is rate-limited:

```text
Game-Client-Knowledge/Web:main
Game-Client-Knowledge/Game-Client-Knowledge:main
```

It downloads both immutable commit snapshots from Codeload into a temporary
workspace, installs dependencies, runs the complete audit and build pipeline, and
publishes a release only when both succeed. It never builds from
`/home/sourcecode/gck-builder/content` or another persistent content checkout.

The updater compares the two remote SHAs with the deployed `.release-source`.
Therefore, a legacy or manually copied release without matching provenance is
automatically replaced with a remote-snapshot build. Failed builds do not change
the `current` symlink, so the last valid site remains online.

Inspect the updater with:

```bash
systemctl status game-client-knowledge-update.timer
journalctl -u game-client-knowledge-update.service
```

Inspect the exact production inputs:

```bash
cat /var/www/game-client-knowledge/current/.release-source
```

Expected format:

```text
web=<full Web commit SHA>
content=<full content commit SHA>
```

## Update behavior

GitHub Actions and GitHub Pages are not used for production deployment. The Web
repository intentionally contains no automatic Actions build workflow.

Production updates are handled by `game-client-knowledge-update.timer` on the
self-hosted server. It checks the pushed `main` commits of both repositories every
10 minutes and publishes only when their recorded SHAs change. Use
`npm run deploy:server` for an immediate release after both commits are pushed.

## Quality gates

`npm run audit` fails on:

- Missing `knowledge/`, `interviews/`, or `examples/` roots.
- Missing content-type `README.md` files.
- Missing or duplicate H1 headings.
- Skipped Markdown heading levels.
- Unclosed fenced code blocks.
- Broken relative links.
- Generated route collisions.
- Content files not included by the scanner.

`npm run build` then verifies that every inferred route and template renders.
`npm run audit:site` checks every generated local `href` and `src`.

For browser-level verification while the development server is running:

```bash
npm run test:visual
```

The visual check uses Playwright Core with the locally installed Chrome. It covers
1440 px desktop, 1024 px tablet, and 390 px mobile viewports; search, mobile
navigation, Mermaid rendering, source viewing, browser errors, and horizontal
overflow are asserted.

## Recommended repository policy

- Require the audit and build workflow for website pull requests.
- Require Markdown review for content pull requests.
- Protect both `main` branches from force pushes.
- Do not commit `_site/`, `_content/`, or `node_modules/`.
- Keep website-specific metadata out of the content repository unless it is an
  optional Markdown frontmatter override.

## Scaling thresholds

Review the current implementation when either condition is measured:

- `search-index.json` exceeds 1 MB compressed.
- A full production build exceeds two minutes on the update server.

At that point, split search by module and cache parsed document metadata by content
commit. The content directory contract does not need to change.
