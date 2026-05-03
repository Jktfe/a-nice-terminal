# M2 WebGL Acceptance Evidence

Generated: 2026-05-03T09:42:12.670Z
Branch: delivery/m2-webgl-renderer
Commit: 3f21aa3
Command: `node tests/m2-acceptance-harness.mjs --line-count=100000 --refresh-rounds=16 --activation-order=current`

Overall result: **FAIL**

Scope: this harness isolates renderer-relevant browser work. It writes the same 100,000-line xterm buffer into DOM and WebGL terminals inside the browser, then measures viewport refresh after identical buffer content. It does not include CLI, WebSocket, PTY, tmux, or server replay time.

Acceptance rules checked: WebGL remained active with no context loss, no refresh long tasks, renderer refresh was at least 5x faster than DOM, first-paint and final terminal-surface pixel diff stayed under 0.5%, and visible terminal rows were semantically identical.

| Target | Browser | WebGL stable | Refresh DOM ms | Refresh WebGL ms | Speedup | Refresh stalls | First-paint diff | Final diff | Semantic rows | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| desktop-chromium | 134.0.6998.35 | yes | 123.20 | 104.50 | 1.18x | 0 | 0.84% | 20.66% | yes | FAIL |
| desktop-webkit | 18.4 | yes | 17.00 | 17.00 | 1.00x | 0 | 0.87% | 21.21% | yes | FAIL |
| mobile-chromium | 134.0.6998.35 | yes | 91.50 | 101.10 | 0.91x | 0 | 1.11% | 31.99% | yes | FAIL |
| mobile-webkit | 18.4 | yes | 17.00 | 17.00 | 1.00x | 0 | 1.28% | 18.83% | yes | FAIL |

## Detailed Results

### desktop-chromium

Engine: chromium
Browser version: 134.0.6998.35
Viewport: 1280x720 @1x
Terminal crop: 1040x560

Result: **FAIL**
DOM write: 499.70 ms
WebGL write: 418.40 ms
DOM CDP ScriptDuration: 335.21 ms
WebGL CDP ScriptDuration: 372.24 ms
DOM refresh median/max: 123.20 / 135.70 ms
WebGL refresh median/max: 104.50 / 134.30 ms
DOM scroll median/max: 133.30 / 135.90 ms
WebGL scroll median/max: 94.30 / 137.00 ms
WebGL context losses: setup=0, burst=0
WebGL fallback reason: none
First-paint diff: 0.84% (4875/582400, threshold 24)
Final diff: 20.66% (120310/582400, threshold 24)
Visible rows hash DOM: 7954bd339f7f31d4ef38afc106da831a77151c8d56110dd6f6d5c21711937a8b
Visible rows hash WebGL: 7954bd339f7f31d4ef38afc106da831a77151c8d56110dd6f6d5c21711937a8b
Console messages: 0

### desktop-webkit

Engine: webkit
Browser version: 18.4
Viewport: 1280x720 @1x
Terminal crop: 1040x560

Result: **FAIL**
DOM write: 303.00 ms
WebGL write: 314.00 ms
DOM refresh median/max: 17.00 / 18.00 ms
WebGL refresh median/max: 17.00 / 19.00 ms
DOM scroll median/max: 17.00 / 17.00 ms
WebGL scroll median/max: 16.00 / 31.00 ms
WebGL context losses: setup=0, burst=0
WebGL fallback reason: none
First-paint diff: 0.87% (5087/582400, threshold 24)
Final diff: 21.21% (123527/582400, threshold 24)
Visible rows hash DOM: 7954bd339f7f31d4ef38afc106da831a77151c8d56110dd6f6d5c21711937a8b
Visible rows hash WebGL: 7954bd339f7f31d4ef38afc106da831a77151c8d56110dd6f6d5c21711937a8b
Console messages: 0

### mobile-chromium

Engine: chromium
Browser version: 134.0.6998.35
Viewport: 390x844 @3x
Terminal crop: 362x620

Result: **FAIL**
DOM write: 409.00 ms
WebGL write: 317.50 ms
DOM CDP ScriptDuration: 315.67 ms
WebGL CDP ScriptDuration: 437.65 ms
DOM refresh median/max: 91.50 / 138.60 ms
WebGL refresh median/max: 101.10 / 140.00 ms
DOM scroll median/max: 109.70 / 148.60 ms
WebGL scroll median/max: 101.30 / 155.10 ms
WebGL context losses: setup=0, burst=0
WebGL fallback reason: none
First-paint diff: 1.11% (22428/2019960, threshold 24)
Final diff: 31.99% (646250/2019960, threshold 24)
Visible rows hash DOM: 763a8098fa59fe343f028c9f7916585980565992497d30efe26e309f3b934dd9
Visible rows hash WebGL: 763a8098fa59fe343f028c9f7916585980565992497d30efe26e309f3b934dd9
Console messages: 0

### mobile-webkit

Engine: webkit
Browser version: 18.4
Viewport: 390x844 @3x
Terminal crop: 362x620

Result: **FAIL**
DOM write: 306.00 ms
WebGL write: 299.00 ms
DOM refresh median/max: 17.00 / 20.00 ms
WebGL refresh median/max: 17.00 / 19.00 ms
DOM scroll median/max: 17.00 / 18.00 ms
WebGL scroll median/max: 16.00 / 24.00 ms
WebGL context losses: setup=0, burst=0
WebGL fallback reason: none
First-paint diff: 1.28% (25862/2019960, threshold 24)
Final diff: 18.83% (380447/2019960, threshold 24)
Visible rows hash DOM: 763a8098fa59fe343f028c9f7916585980565992497d30efe26e309f3b934dd9
Visible rows hash WebGL: 763a8098fa59fe343f028c9f7916585980565992497d30efe26e309f3b934dd9
Console messages: 0

## Notes

- Desktop Safari and mobile Safari are represented by Playwright WebKit in this local harness.
- Pixel comparison uses a terminal-only crop with cursor hidden. A pixel is counted as different when any RGBA channel delta exceeds 24.
- The full 100k-line `term.write` timing is recorded for diagnosis, but the 5x acceptance metric uses refresh timing after both renderers already contain identical buffer input.
