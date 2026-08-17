# Homepage Experience

## Layout

The homepage keeps the knowledge repository as the primary object:

- The first viewport presents the product name, global search, catalog entry,
  content counts, and current content commit.
- The next section remains visible below the hero on normal desktop and mobile
  viewports.
- Each module uses an unframed two-column band: module identity on the left and
  its generated topic links on the right.
- Mobile layouts return to a single-column reading order without changing the
  content hierarchy.

All module and topic data still comes from the content repository scanner. The
homepage does not introduce a second navigation configuration.

## Client-rendered field

`src/assets/js/site.js` renders the hero's knowledge field on a full-bleed
Canvas. Nodes use a restrained teal, orange, gold, and white palette and connect
only within a short distance. Pointer movement adds a small depth offset.

The implementation has no network or third-party runtime dependency. It limits
device pixel ratio to `2`, caps the node count on desktop and mobile, and stops
animation while the hero or browser tab is not visible.

When `prefers-reduced-motion: reduce` is active, the Canvas renders one static
frame and does not schedule an animation loop.

## Document-flow entry sequence

When enabled, the homepage begins with a full-viewport Canvas section before
the sticky site header. Scattered particles reconstruct the product title,
technical curves, rotated frames, description, and contributor names from an
offscreen pixel target. After a short hold, the document scrolls to the normal
homepage instead of fading or replacing an overlay.

The section is server-rendered to reserve its height in the first layout. The
normal homepage particle field starts only after the scroll transition
finishes, so two animation loops never compete during entry.

The sequence is scoped to one tab session and asset version. Reduced-motion,
disabled, and already-seen states remove the section before starting the
homepage field. Assembly uses the cached enable flag, or the enabled default on
a first visit, and never waits for the editor bootstrap network request.

## Verification

The visual check covers desktop and mobile homepage widths, horizontal overflow,
search interaction, and browser runtime errors. Homepage-specific checks should
also verify particle assembly pixels, the final document scroll offset, sticky
header alignment, and delayed homepage-field startup.
