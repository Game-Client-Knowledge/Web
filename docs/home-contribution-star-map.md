# Homepage Contribution Star Map

Engineering changes and debugging procedures are documented in
[Home Star Map Development Guide](./home-star-map-development.md).

## Purpose

The homepage supports two interchangeable background engines:

- `old_star_map`: the original proximity-based moving star field.
- `contribution_star_map`: a content and contributor graph rendered as stars.

The contribution map can occupy only the existing hero height or remain fixed
behind the complete homepage. Full-page mode replaces the former white lower
surface with translucent dark content bands so the graph remains visible.

The optional `contribution_portal` experience keeps that immersive mode
available but starts from a light homepage with a dark `贡献` portal. The graph
is packed into a slowly rotating octahedral volume inside the portal. Dragging
rotates it; clicking expands the black field and the same stars to the full
viewport. The return control reverses the transition and restores the page
scroll position.

In this experience, `home_content_idle_timeout_seconds` auto-opens the portal
instead of hiding homepage content. The first subsequent activity reverses
only an idle-triggered opening; manually entered full-screen space is not
closed by ordinary pointer movement. Page commands are blocked while either
transition is in progress.

## Graph Model

The build creates `catalog.homeStarGraph` from the authoritative content Git
revision. The graph is embedded in the homepage and does not fetch the content
tree at runtime.

### Stars

| Kind | Motion | Source | Default brightness |
| --- | --- | --- | --- |
| Contributor | Static | Contributors across all tracks | `10` |
| Document | Moving | Readable Markdown and source-code routes outside the `code` module | `10` |
| Code system | Moving | One immediate child directory below each `code` module | `10` |

Contributor records expose names and aggregate activity only. Email addresses
are never included in the browser payload.

Code-system stars use the first directory level below `code` as their stable
boundary. For example, every readable member below `program/code/ecs/` belongs
to one `ECS` system star, regardless of deeper project or source directories.
The immediate system `README.md` supplies its title and route. Files directly
under `code/`, such as project conventions, remain independent documents.
Generated `bin` and `obj` paths remain excluded.

### Edges

| Type | Rule | Default style |
| --- | --- | --- |
| Strong | Documents share the same smallest source directory | Solid |
| Reference | One Markdown document links to another readable document | Dashed |
| Contribution | A contributor changed the document at least once | Solid |

The graph keeps source and target semantics for every edge:

- contribution: contributor -> document or code system;
- reference: referring document -> referenced document;
- strong: both directions, represented by one relation record.

The administrator can switch between `directed` and `undirected`. Directed mode
uses the semantics above for traversal. Undirected mode preserves the original
behavior by making every edge traversable both ways. Both modes render the same
plain relation lines without arrowheads; direction is an algorithmic property,
not an extra Canvas marker. Reciprocal references remain separate facts in both
modes, so changing the traversal mode does not rewrite source data.

All member references and contributor links are folded into their code-system
star. Multiple files changed by the same contributor produce one contributor
edge whose commit counts are accumulated and whose activity time is the newest
member contribution. Internal links between members of the same system do not
create self-edges. Versioned server links remain file-granular; the browser
applies the same system-path folding after loading them.

The smallest-directory rule deliberately separates a parent topic from its
child topics. Direct files under a parent are connected to each other; files
inside one child topic are connected to each other; the two groups do not gain
a strong edge merely because they share a larger module. Code-system stars use
the `code` module as their cluster, so sibling systems can be related without
restoring their internal file-level graph.

The browser stores adjacency with `Map<starId, Set<starId>>`. Drawing keeps the
edge type so each relation can use an independent visual style.

## Versioned Contribution Cache

The existing line-attribution service also maintains
`document_contributors`. The deployment updater already calculates changed and
deleted paths between content revisions, so the same pass now:

1. Rebuilds contributor membership only for changed documents.
2. Removes deleted documents through the existing revision cascade.
3. Marks the graph revision as `syncing:<revision>` before the first batch.
4. Publishes the new revision only after the final batch succeeds.

Contribution identities are canonicalized before persistence:

1. A matching website account becomes `user:<database id>` and uses the public
   website username.
2. Otherwise a GitHub noreply address uses its normalized GitHub login.
3. Otherwise a normalized email identity is used.
4. Display names equal to `Unknown` fall back to the GitHub login or email
   local part.

This merges Git aliases such as `sourcecode` and `carbonbromine` when both map
to the same website account. The browser treats the version-matched server
contributor set as authoritative and rebuilds contributor stars from those
canonical IDs, so stale alias stars cannot retain or hide edges.

One contributor ID has exactly one display name across the complete graph.
Website accounts always use their current public username. Unregistered Git
identities use the valid name from their most recent commit in the target
content revision, even for documents that were last changed under an older
name. The service normalizes stored rows again when a sync batch completes and
also normalizes every API response, so incremental updates cannot reintroduce
per-document aliases.

Track landing documents (`program/README.md` and `planning/README.md`) use a
restricted attribution-only validator. They remain outside normal editable
module paths but still receive contributor edges.

Clients accept server contribution links only when their revision matches the
embedded content revision. During synchronization or failure they continue to
use the complete embedded baseline graph.

The existing authenticated `/api/repository/tree` response includes the graph
only when its revision matches the returned tree SHA. Both browser workspaces
cache that payload under its full and seven-character revisions during
**Sync remote**. This adds no graph-specific request. A later homepage load can
reuse it only after the static baseline advances to the same revision.

On the first deployment of this schema, `update-site.sh` detects the missing
graph revision and ignores the old attribution cursor once. This forces a full
backfill. Later deployments resume incremental processing.

The accepted server graph is cached in `localStorage` under the content
revision. No draft or current-tree edit is sent to this cache; unpublished
changes remain client-only under the dual-tree editor model.

## Rendering And Interaction

`src/assets/js/home-star-map.js` owns the Canvas 2D simulation.

- Contributor stars remain stationary.
- Document stars receive deterministic random positions and velocities.
- `always` draws all known edges.
- `near` draws an edge only when its related stars are within the proximity
  threshold.
- `hidden` suppresses normal edges.
- A selected illumination set always draws its internal edges, regardless of
  distance.

Clicking a star shows a moving label. Clicking the same document star or its
label again navigates to the document. Contributor labels show the public
contributor name. Label and relation-highlight durations are configured
independently and default to three seconds.

When edge visibility is not `always`, clicking a star applies the selected
illumination rule. In directed mode, "forward" means outgoing edges and
"reverse" means incoming edges. Strong edges participate in both directions.

| Rule | Behavior |
| --- | --- |
| Full graph | Forward BFS over outgoing edges until no successor remains. |
| N levels | Forward BFS stops after the configured graph depth. |
| Reverse N levels | Traverse incoming edges to find referrers and contributors. |
| Bidirectional N levels | Traverse incoming and outgoing edges for local context. |
| Full graph, contributor terminal | BFS, but a contributor reached from another star is illuminated without propagating further. A directly clicked contributor remains a valid source. |
| N levels, contributor terminal | The same contributor boundary with a configurable depth limit. |
| Direct successors | Illuminate the selected star and its immediate outgoing neighbors only. |
| Smallest module | Traverse only bidirectional strong edges inside the smallest content directory. |
| Reference downstream | Follow outgoing Markdown references up to N levels. |
| Reference upstream | Follow incoming Markdown references up to N levels. |

In undirected mode, outgoing and incoming adjacency are identical. This keeps
all previous illumination rules and contributor-terminal behavior available as
a compatibility option.

The resulting set is highlighted and a fixed coverage panel reports:

- highlighted stars and percentage of all stars;
- highlighted contributor stars and percentage;
- highlighted document stars and percentage.
- covered relations and percentage of the complete relation set.
- the clicked root star's rendered logical brightness at activation, on the
  configured `[0, maximum]` scale.

Relation coverage always counts every real edge whose two endpoint stars are
highlighted. It is independent from rendering. Active highlighting supports:

- `single_path`: build the relation-aware minimal tree, then draw only its
  longest unbranched path. Every selected star remains illuminated, while the
  active visual stays as one chain made only from real relations.
- `full`: draw every covered relation with its configured relation style.
- `minimal_tree`: run a relation-aware Kruskal pass over the covered real
  edges. Strong document links are preferred first, references second, and
  contributor links last; distance breaks ties inside each relation type. This
  prevents one contributor star from becoming a dense radial hub when document
  topology can connect the same stars. A connected set of `N` highlighted stars
  uses exactly `N - 1` active lines. No synthetic edge is created.

The minimal tree affects only active highlight lines. The complete edge set
still drives illumination rules and coverage metrics. `always` and `near`
continue to render their normal edges independently, including covered edges
that were pruned from the active tree.

After the configured relation duration, the set and coverage panel are cleared
while normal star movement continues.

## Brightness Rules

Rules execute in administrator-defined list order. Every rule selects static
contributors or moving documents/code systems and returns the next current
brightness. The result is clamped to the configured minimum and maximum after
each formula.

The expression engine supports `+ - * / % ^`, parentheses, `pi`, `e`, and
common functions including `sin`, `cos`, `exp`, `log`, `sqrt`, `pow`, `min`,
and `max`. Variables expose the current/range values, stable outgoing,
incoming, and strong relation counts, 7/30-day commit and changed-line
activity, lifetime contribution totals, contributors, and commits.

Relation metrics always come from the complete graph. Illumination direction,
depth, and minimal-tree display only change the selected set and highlighted
lines; they do not change computed brightness.

The default curve keeps bright tiers selective. Contributor totals and recent
changes use `0.40` and `0.05` of the configured brightness span, normalized
against the complete graph's `total_relation_count` and `5000` recent lines.
Documents use `0.22` for references, `0.08` for strong relations, `0.06` for
contributor count, and `0.06` for recent changes. Reference degree is normalized
against `24`, strong relations against `12`, and recent changes against `2000`.
Existing databases that still contain an earlier unmodified default rule set
are upgraded to this curve; administrator-customized formulas remain unchanged.

Configurable tier thresholds classify the formula result. Classification uses
base brightness only, so optional random variation cannot move a star between
tiers.

Optional random variation interpolates between bounded offsets. The
administrator controls the offset magnitude, interpolation duration, and
reselection interval. Random colors are disabled by default; disabled stars
render white.

The configured logical range is converted through a perceptual power curve,
`luminous = (brightness / maximum)^1.55`. The result controls core opacity,
core radius, glow blur, and a translucent outer halo. High values are therefore
materially brighter instead of merely a fraction larger. Selection adds a
bounded highlight boost without replacing the underlying brightness. Radius,
core alpha, halo alpha, halo range, and contributor cross-line width are
configured independently. The halo range uses the rendered glow sprite rather
than Canvas `shadowBlur`, so it has a visible effect without adding per-star
shadow work to every animation frame.

## Administration Settings

`PUT /api/admin/visual-settings` persists:

- homepage background engine and hero/full scope;
- immersive background or contribution-space pilot experience;
- contribution-space automatic rotation speed, collapsed scale, and collapsed
  exposure; scale and exposure interpolate back to 100% while expanding;
- homepage idle timeout, which hides immersive content or auto-opens the
  contribution space depending on the selected experience;
- relation visibility;
- directed or undirected graph traversal;
- strong, reference, and contribution styles (`solid`, `dashed`, `glow`);
- illumination rule and N-level depth;
- active relation rendering (`single_path`, `minimal_tree`, or `full`);
- relation-highlight and moving-label durations;
- selected-star radius, alpha, halo, glow-range, and contributor-line boosts;
- minimum, initial, and maximum logical brightness;
- brightness variation enablement, magnitude, transition, and interval;
- random color enablement;
- ordered formula rules with static/moving targets;
- base-brightness tier names and thresholds.

The existing public bootstrap carries these values. The same values are saved
in the homepage visual-settings cache so a reload uses the selected background
from its first rendered frame.

## Verification

- `npm run test:home-star-graph` validates smallest-directory grouping,
  code-system folding, Markdown references, and contributor edges.
- `npm run test:home-star-illumination` validates all propagation boundaries
  and the perceptual brightness mapping.
- `editor/tests` validates formula allowlists, legacy migration, persistence,
  public propagation, contribution links, and administrator validation.
- `scripts/test-home-star-map-visual.js` checks hero/full desktop and full
  mobile rendering, nonblank Canvas pixels, star/edge counts, horizontal
  overflow, rule selection, independent expiration timers, labels, and
  screenshots.
