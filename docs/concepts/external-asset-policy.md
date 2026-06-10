# External Asset Policy

Generated screenshots and large local images are served by ANT, but they are not source code. They must live outside the git repository so private captures and generated media cannot be pushed to the OSS remote by accident.

## Storage Contract

- Configure roots in `~/.ant/asset-folders.json` or `ANT_ASSET_ROOTS`.
- The default local root for this checkout is `~/ant-assets/a-nice-terminal`.
- Files under that root are served through `GET /api/assets/<path>`.
- The repo `static/` folder remains the final fallback for checked-in source assets such as logos, icons, and spritesheets.

## Current Externalised Paths

The generated/manual assets moved out of git on 2026-06-10:

- `manual/*.png` and `manual/manifest.json`
- `decks/state-of-play-2026-05-26/*.png`
- `codex-about-assets/codex-agent-cockpit.png`
- `output/ant-crawler-demo.png`

The UI references these through `/api/assets/...`, for example `/api/assets/manual/rooms-index.png`.

## Harvester Contract

`scripts/manual-harvest.mjs` writes to `ANT_MANUAL_ASSETS_DIR` when set, otherwise to `~/ant-assets/a-nice-terminal/manual`. The served URL is still `/api/assets/manual/<slug>.png` as long as `~/ant-assets/a-nice-terminal` is in the asset roots list.

## Git Guard

`.gitignore` blocks the generated image directories so a future harvest or deck export does not reintroduce binary captures into the repository. Brand assets that are treated as source may remain in `static/`.
