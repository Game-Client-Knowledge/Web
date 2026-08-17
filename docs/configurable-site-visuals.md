# Configurable Site Visuals

## Scope

The site exposes four visual controls in the editor administration page:

| Setting | Values | Default |
| --- | --- | --- |
| Catalog background | `clean`, `circuit`, `constellation` | `circuit` |
| Reader background | `clean`, `blueprint`, `constellation` | `blueprint` |
| Pointer effect | enabled or disabled | enabled |
| Homepage entry sequence | enabled or disabled | enabled |

The values are stored in the existing SQLite `settings` table. Administrators
update them through `PUT /api/admin/visual-settings`. Invalid style names are
rejected before persistence, and every successful update creates a
`visual_settings.updated` audit event.

The public site receives these values through the existing bootstrap response.
No additional request is added for visual settings.

## Client visual engine

`src/assets/js/site-visuals.js` owns the ambient backgrounds, pointer reticle,
and homepage entry sequence. All rendering uses Canvas 2D and
`requestAnimationFrame`; the server only returns configuration and static
assets.

Catalog pages support:

- `circuit`: a moving grid with orthogonal traces and pulse nodes.
- `constellation`: a sparse particle field with local connections.
- `clean`: no ambient background.

Reader pages support:

- `blueprint`: a technical grid with sinusoidal and Bezier curves.
- `constellation`: the same sparse connected field used by catalogs.
- `clean`: no ambient background.

Canvas device pixel ratio is capped at `2`. Geometry is rebuilt on viewport
resize, animation pauses while the document is hidden, and the visual layer is
non-interactive so it cannot block navigation, selection, editing, comments, or
the code workspace.

## Pointer effect

Fine-pointer devices receive a small reticle that follows the pointer with
interpolation. Catalog and reader canvases also render a restrained local focus
marker, and constellation particles receive a bounded attraction force.

The effect is omitted on coarse-pointer devices, in the code workspace, and
when the administrator disables it.

## Homepage entry sequence

The entry sequence is the first full-height section in the homepage document.
It is not a fixed overlay. The normal site header and homepage follow it in the
same scroll flow.

An offscreen Canvas first renders the complete target artwork:

- two rotated frames;
- two Bezier paths;
- the product name and description;
- up to eight contributor names;
- technical markers.

The client samples the target pixels into approximately 1,200–2,000 particles,
depending on viewport size. Particles begin outside all four viewport edges,
follow decaying curved offsets, and converge on their sampled target pixels.
The vector target fades in only during the final assembly interval so the
finished image remains sharp.

The assembled image holds briefly. The client then animates the real document
scroll position until the following sticky site header reaches the top of the
viewport. Total duration is approximately `2.1` seconds. The entry section
remains above the homepage, so the transition never swaps pages or removes an
overlay.

Contributor names are extracted at build time from recent Git author names.
Email addresses are never included. Snapshot-only builds use safe fallback
labels when Git history is unavailable.

The sequence plays once per browser session. When the homepage first connects
without the `gck_home_intro_session` cookie, the client starts the sequence and
writes that marker as a session cookie with no `Max-Age` or `Expires`
attribute. Reloading, opening another tab, or navigating back to the homepage
in the same browser session removes the entry section before it can paint.
Closing the browser ends the cookie session, so the sequence runs again when a
new browser session connects to the site. Clicking the entry section or
pressing Escape skips directly to the shorter scroll transition.

The normal homepage knowledge field waits for the entry promise to resolve.
Only one animated Canvas loop runs during assembly, avoiding contention between
the entry field and the homepage hero.

Assembly starts from the cached enable flag, or the enabled default on a first
visit. It does not wait for the editor bootstrap request. The eventual server
setting is cached and can cancel the optimistic sequence, so network latency
does not create a blank first screen.

## Accessibility and fallback

When `prefers-reduced-motion: reduce` is active:

- the homepage entry sequence is skipped;
- the pointer reticle is not created;
- ambient backgrounds render one static frame;
- button movement transitions are disabled.

All visual layers use `aria-hidden="true"`. Content remains readable above
semi-transparent surfaces, and print styles remove every ambient or entry
layer.

If the bootstrap request fails, the client uses the documented defaults. If
visual initialization itself fails, the page remains usable and records
`data-visual-type="fallback"` on the body.

## Verification

`npm run test:visual` intercepts the bootstrap response to exercise each visual
configuration deterministically. The suite covers:

- all catalog and reader background styles;
- desktop and mobile horizontal overflow;
- nonblank Canvas pixel output;
- pointer creation, disabling, and movement;
- particle count, assembly phase, contributor labels, and nonblank pixels;
- document-flow placement, scroll destination, sticky-header alignment;
- entry duration, session-cookie replay prevention, reconnection, and skip;
- disabled entry behavior;
- static reduced-motion rendering;
- search, mobile navigation, Mermaid, source pages, and the code workspace;
- browser console and page errors.

Backend tests cover administrator authorization, valid updates, public config
propagation, and invalid style rejection.
