# Configurable Site Visuals

## Scope

The site exposes visual controls in the editor administration page:

| Setting | Values | Default |
| --- | --- | --- |
| Catalog background | `clean`, `circuit`, `constellation` | `circuit` |
| Reader background | `clean`, `blueprint`, `constellation` | `blueprint` |
| Homepage content mask | enabled or disabled | disabled |
| Pointer effect | enabled or disabled | enabled |
| Homepage entry policy | `off`, `always`, `revisit`, `first` | `revisit` |
| Particle assembly duration | `0.5` to `10` seconds | `1.68` seconds |
| Assembled-image hold duration | `0` to `10` seconds | `0.63` seconds |
| Lock completed entry | enabled or disabled | enabled |
| Contributor display limit | `1` to `10` | `8` |

The values are stored in the existing SQLite `settings` table. Administrators
update them through `PUT /api/admin/visual-settings`. Invalid style names are
rejected before persistence, and every successful update creates a
`visual_settings.updated` audit event.

The public site receives these values through the existing bootstrap response.
No additional request is added for visual settings.

When the homepage content mask is disabled, section, track-card, footer, and
star-label glass backgrounds become transparent while text colors and structural
borders remain. The setting is global and administrator-controlled.

The homepage also exposes a fixed eye button. It hides the header, hero copy,
statistics, catalog, contribution callout, and footer so the active background
scene can be inspected by itself. The eye button remains available to restore
the content. This visibility choice is device-local and does not change the
administrator setting or other visitors' pages.

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
viewport. Assembly and hold durations are configured independently. The scroll
transition keeps its existing duration, so changing either control changes the
effective total without changing the page-transition speed. Defaults are
`1.68` seconds for assembly, `0.63` seconds for hold, and `0.69` seconds for
scroll, for a default total of exactly `3` seconds.

Existing installations migrate from the former total-duration setting by
assigning `56%` to assembly and `21%` to hold; the remaining duration stays
assigned to scrolling. Legacy API clients may still submit a total duration,
which is converted using the same percentages.

When completed-entry locking is enabled, the client removes the entry section
after the scroll and resets the now-shorter document to its top. The normal
homepage remains at the same visual position, but the entry section no longer
exists and cannot be reached by scrolling upward. Disabling the setting keeps
the completed section in document flow for reversible scrolling.

Contributor names are extracted at build time from recent Git author names.
Email addresses are never included. Snapshot-only builds use safe fallback
labels when Git history is unavailable. On each new browser session, the client
randomly selects up to the configured limit. Mobile viewports use at most six
names to preserve legibility.

Names are not part of the fixed logo artwork. Each name receives an orbital
position, direction, and angular velocity around a protected logo rectangle.
Its text pixels are sampled separately. Contributor particles start beyond the
viewport in the direction of that name and continuously chase its moving text
target, so the name assembles while following its trajectory. The final vector
label continues moving around the logo and is constrained never to enter the
protected logo area. The two central square frames rotate independently on
every animation frame.

The entry policy is device-scoped through same-origin browser storage:

- `off`: never play.
- `always`: play for every homepage document load, including reloads.
- `revisit`: play once when the device enters the site after all of its site
  tabs were closed or navigated away.
- `first`: play only once for that browser storage profile.

`revisit` tracks active site tabs in `localStorage` and gives each tab an ID in
`sessionStorage`. Same-site navigation and reloads retain the visit, while
closing the final site tab or leaving the origin ends it. A short heartbeat
expires tabs left behind by a browser crash. Multiple tabs therefore behave as
one device visit instead of replaying independently.

The former `gck_home_intro_session` cookie is expired automatically and no
longer participates in the decision. This avoids browser session-restore
behavior retaining an entrance marker after a tab was closed. Clicking the
entry section or pressing Escape still skips directly to the shorter scroll
transition.

The normal homepage knowledge field waits for the entry promise to resolve.
Only one animated Canvas loop runs during assembly, avoiding contention between
the entry field and the homepage hero.

Assembly starts from cached entry settings, or documented defaults on a first
visit. It does not wait for the editor bootstrap request. The eventual server
settings are cached and applied to an active sequence when they arrive, so
network latency does not create a blank first screen.

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
- particle count, assembly phase, orbital contributor targets, and nonblank
  pixels;
- contributor limits, protected-logo exclusion, and rotating square frames;
- document-flow placement, scroll destination, sticky-header alignment;
- independently configurable assembly and hold phases;
- preserved scroll timing and locked/unlocked completion;
- all four device policies, multi-tab visit tracking, reconnection, and skip;
- disabled entry behavior;
- static reduced-motion rendering;
- search, mobile navigation, Mermaid, source pages, and the code workspace;
- browser console and page errors.

Backend tests cover administrator authorization, valid updates, public config
propagation, and invalid style rejection.

`npm run test:home-content-controls` covers the local show/hide state, button
accessibility labels, refresh persistence, and non-home isolation.
