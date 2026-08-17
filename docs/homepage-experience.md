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
technical curves, description, rotating frames, and moving contributor names.
The logo uses an offscreen pixel target. Contributor text uses independent
moving targets that orbit outside a protected logo rectangle. After a short
hold, the document scrolls to the normal homepage instead of fading or
replacing an overlay.

The section is server-rendered to reserve its height in the first layout. The
normal homepage particle field starts only after the scroll transition
finishes, so two animation loops never compete during entry.

The sequence supports four device-level policies: disabled, every homepage
load, re-entry after the device leaves the site, and first visit only. Re-entry
mode tracks all active same-origin tabs together. Reloading or navigating
inside the site does not replay; closing the final site tab or leaving the
origin allows the next homepage entry to play. First-visit mode persists its
completed marker in browser storage.

Reduced-motion and policy-skipped states remove the section before starting the
homepage field. Assembly uses the cached policy, or re-entry mode on a first
visit, and never waits for the editor bootstrap network request.

The default total duration is three seconds and can be changed in
administration. When completion locking is enabled, the finished entry section
is removed after the homepage reaches the viewport, preventing upward scrolling
back into the entry artwork. Administrators can keep it in document flow when
reversible scrolling is preferred.

## Verification

The visual check covers desktop and mobile homepage widths, horizontal overflow,
search interaction, and browser runtime errors. Homepage-specific checks should
also verify particle assembly pixels, the final document scroll offset, sticky
header alignment, and delayed homepage-field startup.
