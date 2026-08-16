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

## Verification

The visual check covers desktop and mobile homepage widths, horizontal overflow,
search interaction, and browser runtime errors. Homepage-specific checks should
also verify that the Canvas contains non-transparent pixels after rendering.
