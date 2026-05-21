# Brand Assets Audit

Date: 2026-05-12

These files are copied from current ANT because they are the actual ANT brand
assets, not implementation shortcuts.

| vNext asset | Source | Verdict | Simplification |
|---|---|---|---|
| `static/ant-logo.svg` | `../a-nice-terminal/static/favicon.svg` | KEEP | Canonical ant mark used by `AntLogo.svelte`. |
| `static/favicon.svg` | `../a-nice-terminal/static/favicon.svg` | KEEP | Browser favicon uses the same canonical mark. |
| `static/ant-mark.svg` | `../a-nice-terminal/static/a2.svg` | KEEP | Alternate mark retained for later review. |
| `static/ant-logo-wordmark.png` | `../a-nice-terminal/static/ANTlogo.png` | KEEP | Full wordmark retained for larger brand surfaces. |
| `static/ant-logo-wordmark-black.png` | `../a-nice-terminal/static/ANTlogo-black-text.png` | KEEP | Light-mode wordmark retained for larger brand surfaces. |
| `static/icons/ant-icon-192.png` | `../a-nice-terminal/static/icons/ant-icon-192.png` | KEEP | PWA icon. |
| `static/icons/ant-icon-512.png` | `../a-nice-terminal/static/icons/ant-icon-512.png` | KEEP | PWA icon. |
| `static/favicon.ico` | `../a-nice-terminal/static/favicon.ico` | KEEP | Browser fallback for `/favicon.ico`. |
| `static/apple-touch-icon.png` | `../a-nice-terminal/static/apple-touch-icon.png` | KEEP | iOS home-screen icon. |

The Svelte component using these assets is fresh vNext code:
`src/lib/components/AntLogo.svelte`.

