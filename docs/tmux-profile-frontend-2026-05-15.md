# Phase 2 SLICE β frontend — tmuxProfile UI — 2026-05-15

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Driver: coordinator overnight brief — ANT-managed tmux profile

## Scope (frontend pieces only)

1. **Settings UI panel** — 2-way `tmuxProfile` toggle: `ant-managed`
   (default) / `user-existing`. PLUS a separate **"Install preferred
   config" ACTION button** (not a radio option) — it's a one-shot
   installer, not a persistent profile state. After it succeeds the
   profile flips to `ant-managed`.
2. **First-run wizard hook** for Option A — surfaces the installer
   action with backup-and-confirm flow

## Locked assumptions

| # | Assumption | Why |
|---|---|---|
| A1 | tmuxProfile lives in localStorage (per-client preference) mirroring `agentKinds`/`terminalBookmarks`/`theme`. **The create-terminal POST body gains a `tmuxProfile` field** — frontend reads its localStorage value and includes it in `POST /api/terminals`. Backend uses that field to decide the `-f` spawn flag. NO server-side persistence of the setting itself. | localStorage is client-only; backend can't read it — must be passed explicitly on the create call |
| A2 | Settings panel landing under existing /settings#preferences | Aligns with theme + agent-kinds tabs |
| A3 | First-run wizard triggers ONLY when `tmuxProfile === undefined` AND user navigates to /terminals for the first time | Don't nag returning users |
| A4 | Option A installer is destructive — backs up `~/.tmux.conf` → `~/.tmux.conf.ant-backup-{ts}` then writes our config | Coordinator wizard does the same |
| A5 | Backend exposes `POST /api/tmux/install-profile` for Option A | Backend lane; frontend POSTs on confirm |
| A6 | Status feedback: success → toast + auto-set tmuxProfile=ant-managed; failure → inline error + leave setting unchanged | Clear cause-effect |

## New components / stores

### `src/lib/stores/tmuxProfile.svelte.ts` (~45L)
- State class: `profile: 'ant-managed' | 'user-existing' | null`
  (install-preferred is NOT a profile value — it's an action)
- `init()` reads `localStorage['ant-tmux-profile']`
- `setProfile(next)` writes + persists
- `hasChosen` $derived (profile !== null)

### `src/lib/components/TmuxProfileSetting.svelte` (~60L)
- 2-radio-button group (ant-managed / user-existing) + descriptions
- Separate "Install preferred config…" button below the radios
- Button click → confirm modal → POST `/api/tmux/install-profile` →
  on 200 auto-set profile=`ant-managed` + success toast w/ backupPath

### `src/lib/components/TmuxProfileWizard.svelte` (~80L)
- Modal-style first-run prompt
- 2 profile cards: "Use ANT's bundled config (recommended)" → sets
  `ant-managed` / "Keep my existing ~/.tmux.conf" → sets `user-existing`
- PLUS a tertiary "Install my preferred config now" action link → same
  installer POST flow as Settings panel (sets `ant-managed` on success)
- Cancel = pick default ant-managed; Skip = same

### /terminals page +5L
- onMount checks `tmuxProfile.hasChosen`; if false, mount wizard

### /settings page +5L
- Render `<TmuxProfileSetting />` in #preferences section

## Backend contract requested from researchant

0. **POST /api/terminals body extension**: accept optional
   `tmuxProfile?: 'ant-managed' | 'user-existing'`. When `ant-managed`,
   spawn path adds `tmux -f <vendored ant.conf> -L ant`. When
   `user-existing` or absent, spawn unchanged (current behaviour).
   `install-preferred` is NOT sent on create — it's a one-shot installer
   action that flips the client to `ant-managed` afterward.
   `/terminals` page + claim modal include the localStorage value in the
   create POST.
1. **POST /api/tmux/install-profile**
   - Auth: caller==operator-handle (destructive disk write)
   - Effect:
     - Read existing `~/.tmux.conf` → write to
       `~/.tmux.conf.ant-backup-{ts}`
     - Write vendored config to `~/.tmux.conf`
     - Optionally clone plugin snapshots if not present
   - Returns: `{ ok: true, backupPath: string }` on success;
     `{ ok: false, error: string }` on failure
2. (Optional) GET `/api/tmux/profile-status` returning current backup
   timestamp + which plugins detected — for Settings panel display

## Trust + safety

- Option A is destructive; modal MUST require explicit click on
  "Install" button (not auto-execute on radio select)
- Backup path always shown in success toast so user can revert
- Server-side guard: refuse to overwrite if `~/.tmux.conf` is already a
  symlink to ANT's vendored config (idempotent)

## Out of scope

- Plugin manager UI (install/uninstall individual plugins) — defer
- Diff view comparing current `~/.tmux.conf` vs ANT bundled — nice-to-
  have, defer
- Auto-detect existing TPM and merge — complex; defer

## Acceptance

- Doc ≤180L
- 1 store + 2 components + 2 page mount hooks
- Browser-runtime verify:
  - Fresh localStorage → /terminals shows wizard → pick ant-managed →
    wizard closes + setting persists
  - Settings panel shows current selection, can switch
  - install-preferred → POST fires (mock or real backend) → on 200 →
    setting flips to ant-managed
- bun run check 0/0/0 + build PASS

## Ship order (post backend)

1. SLICE-β-1: `tmuxProfile` store (~15min)
2. SLICE-β-2: `TmuxProfileSetting` + Settings page mount (~30min)
3. SLICE-β-3: `TmuxProfileWizard` + /terminals first-run hook (~45min)
4. SLICE-β-4: browser-runtime acceptance + JWPK retest (~30min)
