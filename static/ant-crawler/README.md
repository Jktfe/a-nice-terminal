# ANT Crawler Asset Pack

Fresh animation-ready vector assets inspired by `~/Downloads/ant.svg`.

## Files

- `ant-crawler-rig.svg` - assembled static rig. Add `is-crawling` to the root SVG class to preview the built-in crawl cycle.
- `ant-crawler-elements.svg` - SVG symbol library and contact sheet for reusable parts.
- `preview.html` - browser preview that loads the rig and enables the crawl class.
- `elements/*.svg` - standalone exports for individual body and limb assets.

## Rig IDs

- Body: `head`, `thorax`, `abdomen`
- Antennae: `upper-antenna`, `lower-antenna`
- Near legs: `front-near-leg`, `middle-near-leg`, `rear-near-leg`
- Far legs: `front-far-leg`, `middle-far-leg`, `rear-far-leg`
- Leg segments: `upper`, `lower`, `foot`

Each animated limb segment includes `data-joint` metadata and an inline
`transform-origin` at the intended pivot.
