# Concept D · Slice 1 visual contract bundle

This directory contains the visual contract for the Mac shell scaffold (Slice 1).

## Layout

```
docs/concept-d/
├── README.md                       — you are here
├── slice-1-shell.md                — full Slice 1 spec
├── concept-d-regions.json          — machine-readable region manifest with all Pencil node ids
│
├── oHqAq.png                       — full Concept D frame @1× (1440×1080) — overall reference
├── mmX8j.png                       — Region 1: NSToolbar / title chrome @2×
├── Z5SjX.png                       — Region 2: Sources sidebar @2× (224 w)
├── k4Juf.png                       — Region 3: Today ops column @2× (340 w)
├── DUxR1.png                       — Region 4: Focused room column @2× (fill)
├── xw1XI.png                       — Region 5: Native bridges strip @2× (104 h)
│
└── slice-1-screenshots/            — actual antchat build evidence (see its own SCREENSHOTS.md
                                      for caveats re: state-leak on default-shot)
```

## How to read this bundle

**Top-level PNGs** are the **DESIGN SOURCE** — exported from `antOSux.pen` (Pencil canvas, frame `Concept D — antux · The Workspace`). They show the **intended default state** of every region.

**`slice-1-screenshots/*`** contains the **BUILD EVIDENCE** — actual screenshots of the running `antchat` binary on macOS. These prove the shell scaffold renders + compiles, but the default-state shot has a known state-leak (ops column collapsed, bridges hidden) flagged in `slice-1-screenshots/SCREENSHOTS.md`.

The visual contract is satisfied when, **for each region**, the build evidence matches the design source. Differences are PASS/BLOCKER decisions per @antmacdevcodex's QA gate.

## Per-region quick links

| Region | Pencil node id | Design PNG | Spec section |
|---|---|---|---|
| Toolbar | `mmX8j` | `mmX8j.png` | [Region 1 in spec](./slice-1-shell.md#region-1-top-toolbar--anttoolbarswift) |
| Sidebar | `Z5SjX` | `Z5SjX.png` | [Region 2 in spec](./slice-1-shell.md#region-2-sidebar--sidebarcolumnswift) |
| Ops column | `k4Juf` | `k4Juf.png` | [Region 3 in spec](./slice-1-shell.md#region-3-ops-column--opscolumnswift) |
| Room | `DUxR1` | `DUxR1.png` | [Region 4 in spec](./slice-1-shell.md#region-4-room-column--roomcolumnswift--roomshelfswift) |
| Bridges strip | `xw1XI` | `xw1XI.png` | [Region 5 in spec](./slice-1-shell.md#region-5-native-bridges-strip--bridgesstripswift) |

## Regenerating

```sh
# Full frame (1× only — 2× hits a Pencil rendering limit on the shadow effect)
mcp__pencil__export_nodes filePath=/Users/jamesking/CascadeProjects/antOSux.pen \
  outputDir=docs/concept-d nodeIds=["oHqAq"] format=png scale=1

# Regions (2×)
mcp__pencil__export_nodes filePath=/Users/jamesking/CascadeProjects/antOSux.pen \
  outputDir=docs/concept-d \
  nodeIds=["mmX8j","Z5SjX","k4Juf","DUxR1","xw1XI"] \
  format=png scale=2
```

## QA workflow

1. Pick a region from the table above
2. Open the design PNG side-by-side with the matching `slice-1-screenshots/*` build PNG
3. Cross-reference acceptance criteria in `slice-1-shell.md` (PASS/BLOCKER table at the bottom)
4. For the toolbar specifically, the build PNG should show the **two new persistent toggle buttons** (`sidebar.left` + `sidebar.squares.left`) added per the Slice 1 patch — the design PNG does NOT show these yet because the .pen frame hasn't been updated to match the SwiftUI build (those toggles are a build-side affordance for the collapse/expand invariant, not a Concept D visual change). When the .pen frame is updated, this README gets a follow-up note.
