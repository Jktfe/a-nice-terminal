<!--
  /manual/v2 — interactive screens canvas (JWPK msg_i538jl6ztt 2026-05-23).

  Slice 1: data model + first annotated state, read-only.
    - Loads /api/manual/states and /api/manual/states/:screenId/:stateSlug
    - Renders the screenshot with absolutely-positioned overlay regions
      for every annotation
    - Each overlay is clickable AND tab-focusable; selection drives the
      right-side inspector panel
    - Three sub-purposes flagged by the inspector layout: Learning
      (Item/CLI/Data sources/Logic/Intended Actions read-side), Audit
      (slice 6 will populate), Question captures (slice 3 will populate
      the Notes field)

  Future slices:
    - Slice 2: state-switcher (tabs above the canvas)
    - Slice 3: Notes capture writes to /api/manual/suggestions
    - Slice 4: tab-order + a11y polish (Enter/Esc/arrow keys)
    - Slice 5: Playwright auto-extract pipeline
    - Slice 6: audit log table + tab
    - Slice 7: multi-screen rollout
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { onMount } from 'svelte';

  type Bbox = { x: number; y: number; w: number; h: number };
  type Annotation = {
    screen_id: string;
    state_slug: string;
    element_slug: string;
    item_name: string;
    bbox: Bbox;
    cli_verbs: string[];
    data_sources: string[];
    logic_text: string | null;
    intended_actions: string[];
    tab_order: number;
  };
  type ScreenState = {
    screen_id: string;
    state_slug: string;
    state_label: string;
    description: string | null;
    screenshot_path: string;
    viewport_w: number;
    viewport_h: number;
  };

  type Suggestion = {
    id: string;
    screen_id: string | null;
    state_slug: string | null;
    element_slug: string | null;
    body: string;
    captured_by_handle: string;
    captured_at_ms: number;
    status: 'open' | 'addressed' | 'dismissed';
  };

  let states = $state<ScreenState[]>([]);
  let selectedState = $state<ScreenState | null>(null);
  let annotations = $state<Annotation[]>([]);
  let selectedAnnotation = $state<Annotation | null>(null);

  // Slice 4 (a11y polish, JWPK strategic-task resume 2026-05-24):
  // aria-live announcement string — updated when the selected
  // annotation changes so screen readers narrate the inspector swap.
  // Arrow-key nav focuses the next/prev overlay by querySelector against
  // the stage's data-element-slug attribute (cleaner than maintaining a
  // ref map across reactive updates).
  let liveAnnouncement = $state('');
  let suggestions = $state<Suggestion[]>([]);
  let suggestionDraft = $state<string>('');
  let suggestionSaving = $state(false);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  // Slice 2 (JWPK msg_kjc604olp8 2026-05-23): state-switcher chrome.
  // newStateForm.open toggles the inline create-form; the rest are the
  // form fields. File upload happens inline (multipart POST) and the
  // returned screenshotPath gets stamped onto the create-state body.
  let newStateForm = $state<{ open: boolean; label: string; uploading: boolean; uploadError: string | null }>({
    open: false, label: '', uploading: false, uploadError: null
  });
  let fileInputEl = $state<HTMLInputElement | null>(null);

  // Slice 1.5 (JWPK msg_iu0yjpat78 2026-05-23): author-mode toggle.
  // View mode = click overlays to inspect. Author mode = drag to move,
  // drag corners to resize, drag empty area to create, edit inspector
  // form, delete per region. Auto-save on each interaction (no
  // explicit save button — pointer-up commits to server).
  let mode = $state<'view' | 'author'>('view');
  let stageEl = $state<HTMLElement | null>(null);
  type DragKind = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'create';
  type DragState = {
    kind: DragKind;
    annotation: Annotation | null;     // existing element being mutated (null when creating)
    startImgX: number;                  // pointer-down position in image-pixel coordinates
    startImgY: number;
    startBbox: Bbox;                    // bbox at pointer-down time
    moved: boolean;                     // did the user actually drag? (suppresses save on no-op clicks)
  };
  let drag = $state<DragState | null>(null);
  let saveError = $state<string | null>(null);

  async function loadStates() {
    try {
      const response = await fetch('/api/manual/states');
      if (!response.ok) throw new Error(`states fetch ${response.status}`);
      const data = await response.json();
      states = data.states ?? [];
      if (states.length === 0) return;
      // Slice 2.5 (manual-canvas-deep-link-contract-2026-05-23): parse
      // `location.hash` and try to land on the addressed state/element
      // before falling back to states[0]. Hash format:
      //   #<screen-id>/<state-slug>/<element-slug>
      // All three segments optional from the end; missing pieces fall
      // back to the default selection at that scope.
      const hashTarget = parseHashTarget();
      const matchedState = hashTarget
        ? states.find((s) => s.screen_id === hashTarget.screenId
            && (hashTarget.stateSlug === null || s.state_slug === hashTarget.stateSlug))
        : null;
      const initialState = matchedState ?? states[0];
      await selectState(initialState);
      if (hashTarget?.elementSlug) {
        const target = annotations.find((a) => a.element_slug === hashTarget.elementSlug);
        if (target) pickAnnotation(target);
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function parseHashTarget(): { screenId: string; stateSlug: string | null; elementSlug: string | null } | null {
    if (typeof window === 'undefined') return null;
    const raw = window.location.hash.replace(/^#/, '');
    if (raw.length === 0) return null;
    const parts = raw.split('/').map((p) => {
      try { return decodeURIComponent(p); } catch { return p; }
    }).filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    return {
      screenId: parts[0],
      stateSlug: parts[1] ?? null,
      elementSlug: parts[2] ?? null
    };
  }

  function updateHashForCurrent(): void {
    if (typeof window === 'undefined' || !selectedState) return;
    const segments = [selectedState.screen_id, selectedState.state_slug];
    if (selectedAnnotation) segments.push(selectedAnnotation.element_slug);
    const next = '#' + segments.map(encodeURIComponent).join('/');
    if (window.location.hash !== next) {
      // history.replaceState instead of pushing — selection clicks
      // shouldn't bloat history (Back would walk through every overlay
      // pick). The URL stays current + shareable.
      window.history.replaceState(null, '', next);
    }
  }

  async function selectState(state: ScreenState) {
    selectedState = state;
    selectedAnnotation = null;
    try {
      const response = await fetch(
        `/api/manual/states/${encodeURIComponent(state.screen_id)}/${encodeURIComponent(state.state_slug)}`
      );
      if (!response.ok) throw new Error(`state fetch ${response.status}`);
      const data = await response.json();
      annotations = data.annotations ?? [];
      suggestions = data.suggestions ?? [];
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
    // Slice 2.5: keep location.hash in sync with the visible selection
    // so any URL copy-paste reproduces the same view.
    updateHashForCurrent();
  }

  function pickAnnotation(annotation: Annotation) {
    selectedAnnotation = annotation;
    // a11y: announce the new selection to assistive tech (slice 4).
    const cli = annotation.cli_verbs.length > 0 ? `, ${annotation.cli_verbs.length} CLI verb${annotation.cli_verbs.length === 1 ? '' : 's'}` : '';
    liveAnnouncement = `Selected: ${annotation.item_name}${cli}`;
    // Slice 2.5: include element in the hash so the deep-link points at
    // the exact element the user is inspecting.
    updateHashForCurrent();
  }

  function clearSelection() {
    selectedAnnotation = null;
    liveAnnouncement = 'Selection cleared';
    updateHashForCurrent();
  }

  // ─── slice 4: keyboard navigation across overlays ───────────────────

  // Reading-order sort: rows top-to-bottom (y-centre comparison with a
  // tolerance equal to half the larger overlay's height — overlays whose
  // centres are within that band are treated as the same row), then
  // left-to-right within a row. Derived at render time rather than
  // baked into tab_order in the DB so user drags don't have to re-stamp
  // every neighbour's stored tab_order.
  function readingOrderCompare(a: Annotation, b: Annotation): number {
    const aCy = a.bbox.y + a.bbox.h / 2;
    const bCy = b.bbox.y + b.bbox.h / 2;
    const tolerance = Math.max(a.bbox.h, b.bbox.h) / 2;
    if (Math.abs(aCy - bCy) > tolerance) return aCy - bCy;
    return a.bbox.x - b.bbox.x;
  }

  const annotationsInReadingOrder = $derived(
    [...annotations].sort(readingOrderCompare)
  );

  function focusOverlay(slug: string) {
    if (!stageEl) return;
    const el = stageEl.querySelector<HTMLButtonElement>(`button.canvas-region[data-element-slug="${CSS.escape(slug)}"]`);
    el?.focus();
  }

  function moveSelectionInReadingOrder(direction: 1 | -1) {
    const ordered = annotationsInReadingOrder;
    if (ordered.length === 0) return;
    const currentSlug = selectedAnnotation?.element_slug ?? null;
    const currentIdx = currentSlug
      ? ordered.findIndex((a) => a.element_slug === currentSlug)
      : -1;
    let nextIdx: number;
    if (currentIdx === -1) {
      // No selection yet — Arrow{Right,Down} starts at first, Arrow{Left,Up} starts at last.
      nextIdx = direction === 1 ? 0 : ordered.length - 1;
    } else {
      nextIdx = (currentIdx + direction + ordered.length) % ordered.length;
    }
    const next = ordered[nextIdx];
    pickAnnotation(next);
    focusOverlay(next.element_slug);
  }

  function onOverlayKeydown(event: KeyboardEvent, annotation: Annotation) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickAnnotation(annotation);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSelection();
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelectionInReadingOrder(1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelectionInReadingOrder(-1);
      return;
    }
  }

  // ─── author-mode drag math ─────────────────────────────────────────

  function clientToImagePx(clientX: number, clientY: number): { x: number; y: number } {
    if (!stageEl || !selectedState) return { x: 0, y: 0 };
    const rect = stageEl.getBoundingClientRect();
    const relX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const relY = Math.max(0, Math.min(clientY - rect.top, rect.height));
    return {
      x: (relX / rect.width) * selectedState.viewport_w,
      y: (relY / rect.height) * selectedState.viewport_h
    };
  }

  function beginRegionDrag(event: PointerEvent, annotation: Annotation) {
    if (mode !== 'author') return;
    event.stopPropagation();
    event.preventDefault();
    selectedAnnotation = annotation;
    const pt = clientToImagePx(event.clientX, event.clientY);
    drag = {
      kind: 'move',
      annotation,
      startImgX: pt.x,
      startImgY: pt.y,
      startBbox: { ...annotation.bbox },
      moved: false
    };
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  function beginResizeDrag(event: PointerEvent, annotation: Annotation, corner: 'nw' | 'ne' | 'sw' | 'se') {
    if (mode !== 'author') return;
    event.stopPropagation();
    event.preventDefault();
    selectedAnnotation = annotation;
    const pt = clientToImagePx(event.clientX, event.clientY);
    drag = {
      kind: `resize-${corner}`,
      annotation,
      startImgX: pt.x,
      startImgY: pt.y,
      startBbox: { ...annotation.bbox },
      moved: false
    };
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  function beginCreateDrag(event: PointerEvent) {
    if (mode !== 'author') return;
    // Only respond to direct hits on the stage / image — clicks on
    // overlays bubble here too but are stopped at beginRegionDrag.
    const target = event.target as HTMLElement;
    if (!target.classList.contains('canvas-image-stage') &&
        !target.classList.contains('canvas-image')) return;
    event.preventDefault();
    const pt = clientToImagePx(event.clientX, event.clientY);
    drag = {
      kind: 'create',
      annotation: null,
      startImgX: pt.x,
      startImgY: pt.y,
      startBbox: { x: pt.x, y: pt.y, w: 0, h: 0 },
      moved: false
    };
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  function applyDrag(event: PointerEvent) {
    if (!drag || !selectedState) return;
    event.preventDefault();
    const pt = clientToImagePx(event.clientX, event.clientY);
    const dx = pt.x - drag.startImgX;
    const dy = pt.y - drag.startImgY;
    if (!drag.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) drag.moved = true;

    let next: Bbox;
    const sb = drag.startBbox;
    if (drag.kind === 'move' && drag.annotation) {
      next = { x: sb.x + dx, y: sb.y + dy, w: sb.w, h: sb.h };
    } else if (drag.kind === 'create') {
      const x = Math.min(drag.startImgX, pt.x);
      const y = Math.min(drag.startImgY, pt.y);
      next = { x, y, w: Math.abs(pt.x - drag.startImgX), h: Math.abs(pt.y - drag.startImgY) };
    } else if (drag.kind === 'resize-nw') {
      next = { x: sb.x + dx, y: sb.y + dy, w: sb.w - dx, h: sb.h - dy };
    } else if (drag.kind === 'resize-ne') {
      next = { x: sb.x, y: sb.y + dy, w: sb.w + dx, h: sb.h - dy };
    } else if (drag.kind === 'resize-sw') {
      next = { x: sb.x + dx, y: sb.y, w: sb.w - dx, h: sb.h + dy };
    } else {
      next = { x: sb.x, y: sb.y, w: sb.w + dx, h: sb.h + dy };
    }
    // Clamp to image bounds + minimum size
    const vw = selectedState.viewport_w, vh = selectedState.viewport_h;
    const min = 16;
    next.x = Math.max(0, Math.min(next.x, vw - min));
    next.y = Math.max(0, Math.min(next.y, vh - min));
    next.w = Math.max(min, Math.min(next.w, vw - next.x));
    next.h = Math.max(min, Math.min(next.h, vh - next.y));

    if (drag.kind === 'create') {
      drag.startBbox = next; // reuse startBbox as live preview for the rubber-band
    } else if (drag.annotation) {
      drag.annotation.bbox = next;
      annotations = [...annotations]; // trigger reactivity
    }
  }

  async function endDrag(event: PointerEvent) {
    if (!drag) return;
    event.preventDefault();
    const finished = drag;
    drag = null;
    if (!selectedState) return;

    if (finished.kind === 'create') {
      // Only create if the rubber-band actually moved (a click without
      // drag would create a min-sized box at the click point, which we
      // suppress to avoid stray clicks → spurious elements).
      if (!finished.moved) return;
      try {
        const url = `/api/manual/states/${encodeURIComponent(selectedState.screen_id)}/${encodeURIComponent(selectedState.state_slug)}/annotations`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            itemName: 'Untitled element',
            bbox: finished.startBbox,
            cliVerbs: [], dataSources: [], intendedActions: [],
            tabOrder: Math.max(...annotations.map((a) => a.tab_order), -1) + 1
          })
        });
        if (!response.ok) throw new Error(`create ${response.status}`);
        const data = await response.json();
        annotations = [...annotations, data.annotation];
        selectedAnnotation = data.annotation;
      } catch (err) {
        saveError = err instanceof Error ? err.message : String(err);
      }
      return;
    }

    // Move / resize: PATCH the existing annotation
    if (!finished.annotation || !finished.moved) return;
    await persistAnnotation(finished.annotation);
  }

  async function persistAnnotation(a: Annotation) {
    if (!selectedState) return;
    saveError = null;
    try {
      const url = `/api/manual/states/${encodeURIComponent(a.screen_id)}/${encodeURIComponent(a.state_slug)}/annotations/${encodeURIComponent(a.element_slug)}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemName: a.item_name,
          bbox: a.bbox,
          cliVerbs: a.cli_verbs,
          dataSources: a.data_sources,
          logicText: a.logic_text,
          intendedActions: a.intended_actions,
          tabOrder: a.tab_order
        })
      });
      if (!response.ok) throw new Error(`patch ${response.status}`);
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    }
  }

  async function deleteAnnotation(a: Annotation) {
    if (!selectedState) return;
    if (!confirm(`Delete element "${a.item_name}"? This cannot be undone.`)) return;
    saveError = null;
    try {
      const url = `/api/manual/states/${encodeURIComponent(a.screen_id)}/${encodeURIComponent(a.state_slug)}/annotations/${encodeURIComponent(a.element_slug)}`;
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) throw new Error(`delete ${response.status}`);
      annotations = annotations.filter((x) => x.element_slug !== a.element_slug);
      if (selectedAnnotation?.element_slug === a.element_slug) selectedAnnotation = null;
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    }
  }

  function parseCommaList(raw: string): string[] {
    return raw.split(/\s*,\s*/).map((s) => s.trim()).filter((s) => s.length > 0);
  }

  async function updateFieldAndPersist(field: keyof Annotation, value: unknown) {
    if (!selectedAnnotation) return;
    (selectedAnnotation as Record<string, unknown>)[field] = value;
    annotations = annotations.map((a) =>
      a.element_slug === selectedAnnotation!.element_slug ? selectedAnnotation! : a
    );
    await persistAnnotation(selectedAnnotation);
  }

  // ─── slice 2: state-switcher + screenshot upload ──────────────────

  function openNewStateForm() {
    newStateForm = { open: true, label: '', uploading: false, uploadError: null };
    // Focus the label input on next tick so keyboard users land there.
    queueMicrotask(() => {
      document.getElementById('new-state-label')?.focus();
    });
  }

  function cancelNewState() {
    newStateForm = { open: false, label: '', uploading: false, uploadError: null };
    if (fileInputEl) fileInputEl.value = '';
  }

  async function saveNewState() {
    if (!selectedState) return;
    const label = newStateForm.label.trim();
    if (label.length === 0) {
      newStateForm = { ...newStateForm, uploadError: 'State label required' };
      return;
    }
    const file = fileInputEl?.files?.[0];
    if (!file) {
      newStateForm = { ...newStateForm, uploadError: 'Pick a screenshot file' };
      return;
    }

    newStateForm = { ...newStateForm, uploading: true, uploadError: null };
    try {
      // Derive a slug from the label up-front so the upload filename + state row align.
      const stateSlug = label.toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || `state-${Date.now().toString(36)}`;

      // 1. Upload the screenshot.
      const fd = new FormData();
      fd.append('screenId', selectedState.screen_id);
      fd.append('stateSlug', stateSlug);
      fd.append('file', file);
      const uploadResponse = await fetch('/api/manual/screenshots', { method: 'POST', body: fd });
      if (!uploadResponse.ok) throw new Error(`upload ${uploadResponse.status}`);
      const uploadData = await uploadResponse.json();

      // 2. Create the state row pointing at the uploaded screenshot.
      const stateResponse = await fetch(
        `/api/manual/states/${encodeURIComponent(selectedState.screen_id)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            stateLabel: label,
            stateSlug,
            screenshotPath: uploadData.path,
            viewportW: uploadData.width,
            viewportH: uploadData.height
          })
        }
      );
      if (!stateResponse.ok) throw new Error(`create state ${stateResponse.status}`);
      const stateData = await stateResponse.json();

      // 3. Refresh state catalogue + switch to the new state.
      const catalogue = await fetch('/api/manual/states').then((r) => r.json());
      states = catalogue.states ?? [];
      cancelNewState();
      await selectState(stateData.state);
    } catch (err) {
      newStateForm = {
        ...newStateForm,
        uploading: false,
        uploadError: err instanceof Error ? err.message : String(err)
      };
    }
  }

  async function deleteSelectedState() {
    if (!selectedState) return;
    if (statesForCurrentScreen().length <= 1) {
      alert('Cannot delete the last state of a screen. Add another first or delete via the API.');
      return;
    }
    if (!confirm(`Delete state "${selectedState.state_label}"? This removes ${annotations.length} annotation${annotations.length === 1 ? '' : 's'} and cannot be undone.`)) return;

    try {
      const response = await fetch(
        `/api/manual/states/${encodeURIComponent(selectedState.screen_id)}/${encodeURIComponent(selectedState.state_slug)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error(`delete state ${response.status}`);
      const catalogue = await fetch('/api/manual/states').then((r) => r.json());
      states = catalogue.states ?? [];
      const fallback = states.find((s) => s.screen_id === selectedState!.screen_id) ?? states[0];
      if (fallback) await selectState(fallback);
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    }
  }

  function statesForCurrentScreen(): ScreenState[] {
    if (!selectedState) return [];
    return states.filter((s) => s.screen_id === selectedState!.screen_id);
  }

  // ─── slice 6: audit log per selected element ──────────────────────

  type AuditEntry = {
    id: string;
    edited_by_handle: string;
    edited_at_ms: number;
    action: 'create' | 'update' | 'delete';
    before: Annotation | null;
    after: Annotation | null;
  };
  let auditEntries = $state<AuditEntry[]>([]);
  let auditExpanded = $state(false);
  let auditLoadingFor = $state<string | null>(null);

  async function loadAuditForSelected() {
    if (!selectedState || !selectedAnnotation) {
      auditEntries = [];
      return;
    }
    const key = `${selectedState.screen_id}/${selectedState.state_slug}/${selectedAnnotation.element_slug}`;
    auditLoadingFor = key;
    try {
      const url = `/api/manual/states/${encodeURIComponent(selectedState.screen_id)}/${encodeURIComponent(selectedState.state_slug)}/annotations/${encodeURIComponent(selectedAnnotation.element_slug)}/audit`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`audit fetch ${response.status}`);
      const data = await response.json();
      // Guard against the selection moving while the request was in flight.
      if (auditLoadingFor === key) {
        auditEntries = data.audit ?? [];
      }
    } catch {
      // Silent — audit is a polish surface; a 404 on a brand-new element
      // with no history is not worth a user-facing error.
      if (auditLoadingFor === key) auditEntries = [];
    } finally {
      if (auditLoadingFor === key) auditLoadingFor = null;
    }
  }

  // Reload audit history each time the selected element changes; collapse
  // the section so the user sees the count first + opts in to the detail.
  $effect(() => {
    const _selectionKey = selectedAnnotation?.element_slug; // reactive dep
    void _selectionKey;
    auditExpanded = false;
    void loadAuditForSelected();
  });

  function summariseAuditEntry(entry: AuditEntry): string {
    if (entry.action === 'create') return 'created';
    if (entry.action === 'delete') return 'deleted';
    if (!entry.before || !entry.after) return 'updated';
    const changed: string[] = [];
    if (entry.before.item_name !== entry.after.item_name) changed.push('name');
    if (JSON.stringify(entry.before.bbox) !== JSON.stringify(entry.after.bbox)) changed.push('position');
    if (JSON.stringify(entry.before.cli_verbs) !== JSON.stringify(entry.after.cli_verbs)) changed.push('CLI');
    if (JSON.stringify(entry.before.data_sources) !== JSON.stringify(entry.after.data_sources)) changed.push('data');
    if (entry.before.logic_text !== entry.after.logic_text) changed.push('logic');
    if (JSON.stringify(entry.before.intended_actions) !== JSON.stringify(entry.after.intended_actions)) changed.push('actions');
    if (changed.length === 0) return 'touched';
    return `changed ${changed.join(', ')}`;
  }

  // ─── slice 3: Notes capture + suggestions feed ────────────────────

  function suggestionsForSelectedElement(): Suggestion[] {
    if (!selectedAnnotation) return [];
    return suggestions
      .filter((s) => s.element_slug === selectedAnnotation!.element_slug && s.status === 'open')
      .sort((a, b) => b.captured_at_ms - a.captured_at_ms);
  }

  async function captureSuggestion() {
    if (!selectedState || !selectedAnnotation) return;
    const text = suggestionDraft.trim();
    if (text.length === 0) return;
    suggestionSaving = true;
    try {
      const response = await fetch('/api/manual/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          screenId: selectedState.screen_id,
          stateSlug: selectedState.state_slug,
          elementSlug: selectedAnnotation.element_slug,
          body: text
        })
      });
      if (!response.ok) throw new Error(`capture ${response.status}`);
      const data = await response.json();
      suggestions = [data.suggestion, ...suggestions];
      suggestionDraft = '';
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      suggestionSaving = false;
    }
  }

  function formatTimestamp(ms: number): string {
    const date = new Date(ms);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  onMount(loadStates);
</script>

<svelte:head><title>Screens canvas | ANT vNext</title></svelte:head>

<SimplePageShell showIntro={false}>
  <div class="canvas-page">
    <header class="canvas-header">
      <div class="canvas-eyebrow">SCREENS · v2 (in build)</div>
      <h1>Interactive screens canvas</h1>
      <p class="canvas-summary">
        Every UI element on every screen is selectable. Pick one to see what it is, what
        powers it, and what you can do with it. Capture questions inline — they fan out
        to a central suggestions feed.
      </p>
    </header>

    {#if loading}
      <p class="canvas-status">Loading canvas …</p>
    {:else if loadError}
      <p class="canvas-error">Couldn't load canvas: {loadError}</p>
    {:else if !selectedState}
      <p class="canvas-status">No screens annotated yet.</p>
    {:else}
      <div class="canvas-layout">
        <!-- Left: screen tile with overlay boxes -->
        <section class="canvas-tile">
          <!-- Slice 2 state-switcher tabs: every state of the current
               screen as a tab row above the canvas. "+ Add" in author
               mode opens the inline create-state form. -->
          <div class="state-tabs" role="tablist" aria-label="Screen states">
            {#each statesForCurrentScreen() as state (state.state_slug)}
              <button
                type="button"
                role="tab"
                class="state-tab"
                class:active={selectedState?.state_slug === state.state_slug}
                aria-selected={selectedState?.state_slug === state.state_slug}
                onclick={() => selectState(state)}
              >{state.state_label}</button>
            {/each}
            {#if mode === 'author'}
              <button type="button" class="state-tab state-tab-add" onclick={openNewStateForm}>+ Add state</button>
            {/if}
          </div>

          {#if newStateForm.open}
            <div class="new-state-form">
              <div class="new-state-row">
                <label for="new-state-label">State label</label>
                <input
                  id="new-state-label"
                  type="text"
                  class="inspector-input"
                  bind:value={newStateForm.label}
                  placeholder="e.g. Filter dropdown open"
                  onkeydown={(e) => { if (e.key === 'Enter') saveNewState(); if (e.key === 'Escape') cancelNewState(); }}
                />
              </div>
              <div class="new-state-row">
                <label for="new-state-file">Screenshot</label>
                <input
                  id="new-state-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  bind:this={fileInputEl}
                />
              </div>
              {#if newStateForm.uploadError}
                <div class="new-state-error">{newStateForm.uploadError}</div>
              {/if}
              <div class="new-state-actions">
                <button type="button" class="new-state-cancel" onclick={cancelNewState} disabled={newStateForm.uploading}>Cancel</button>
                <button type="button" class="new-state-save" onclick={saveNewState} disabled={newStateForm.uploading}>
                  {newStateForm.uploading ? 'Uploading…' : 'Add state'}
                </button>
              </div>
            </div>
          {/if}

          <div class="canvas-meta">
            <div class="screen-meta-row">
              <div>
                <div class="screen-title">{selectedState.screen_id} · {selectedState.state_label}</div>
                {#if selectedState.description}
                  <div class="screen-description">{selectedState.description}</div>
                {/if}
              </div>
              <div class="meta-actions">
                <div class="mode-toggle" role="radiogroup" aria-label="Mode">
                  <button
                    type="button"
                    class:active={mode === 'view'}
                    onclick={() => { mode = 'view'; }}
                    aria-pressed={mode === 'view'}
                  >View</button>
                  <button
                    type="button"
                    class:active={mode === 'author'}
                    onclick={() => { mode = 'author'; }}
                    aria-pressed={mode === 'author'}
                  >Author</button>
                </div>
                {#if mode === 'author' && statesForCurrentScreen().length > 1}
                  <button type="button" class="state-delete-btn" onclick={deleteSelectedState} title="Delete this state (and its annotations)">
                    Delete state
                  </button>
                {/if}
              </div>
            </div>
            {#if mode === 'author'}
              <div class="author-hint">
                Drag overlays to move · drag corner handles to resize · drag empty area to create a new region · saves automatically.
                {#if saveError}<span class="author-error"> · last save failed: {saveError}</span>{/if}
              </div>
            {/if}
          </div>
          <div class="canvas-image-frame">
            <!-- Visually-hidden live region (slice 4 a11y). Screen readers
                 narrate `liveAnnouncement` when selection changes. -->
            <div class="sr-only" aria-live="polite" aria-atomic="true">
              {liveAnnouncement}
            </div>
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <!-- role="application" is correct per WAI-ARIA for a
                 canvas-shape interactive surface (focus is managed
                 internally by arrow keys + overlay tab-order); svelte-
                 check's lint rule is conservative and doesn't have a
                 way to express "role=application means I own focus
                 management". Suppression scoped to this single element
                 only. -->
            <div
              class="canvas-image-stage"
              class:author-cursor={mode === 'author'}
              role="application"
              aria-label="Interactive screen overlay canvas. Tab to walk through elements; arrow keys to move between adjacent overlays."
              tabindex="-1"
              bind:this={stageEl}
              onpointerdown={beginCreateDrag}
              onpointermove={applyDrag}
              onpointerup={endDrag}
              onpointercancel={endDrag}
              onkeydown={(e) => {
                // Esc on the stage (when not focused on an overlay) clears
                // the selection — gives keyboard users a way to "back out"
                // without tabbing through every overlay.
                if (e.key === 'Escape' && selectedAnnotation) {
                  e.preventDefault();
                  clearSelection();
                }
              }}
            >
              <img
                class="canvas-image"
                src={selectedState.screenshot_path}
                alt="Screen: {selectedState.screen_id} ({selectedState.state_label})"
                draggable="false"
              />
              <!-- Overlay regions in DOM-order (creation order). Tab order
                   is overridden by the explicit `tabindex` per-button reading
                   sequence derived in `annotationsInReadingOrder`; keyboard
                   nav is handled by `onOverlayKeydown` (slice 4 a11y).
                   We keep DOM order = creation order so the keyed {#each}
                   doesn't churn on annotation updates. -->
              {#each annotations as annotation (annotation.element_slug)}
                {@const xPct = (annotation.bbox.x / selectedState.viewport_w) * 100}
                {@const yPct = (annotation.bbox.y / selectedState.viewport_h) * 100}
                {@const wPct = (annotation.bbox.w / selectedState.viewport_w) * 100}
                {@const hPct = (annotation.bbox.h / selectedState.viewport_h) * 100}
                {@const readingIdx = annotationsInReadingOrder.findIndex((a) => a.element_slug === annotation.element_slug)}
                <button
                  type="button"
                  class="canvas-region"
                  class:selected={selectedAnnotation?.element_slug === annotation.element_slug}
                  class:author-mode={mode === 'author'}
                  style="left: {xPct}%; top: {yPct}%; width: {wPct}%; height: {hPct}%;"
                  tabindex={readingIdx + 1}
                  aria-label="Select element: {annotation.item_name}"
                  data-element-slug={annotation.element_slug}
                  onclick={(e) => { if (mode === 'view') pickAnnotation(annotation); else e.preventDefault(); }}
                  onkeydown={(e) => onOverlayKeydown(e, annotation)}
                  onpointerdown={(e) => beginRegionDrag(e, annotation)}
                >
                  <span class="region-slug">{annotation.item_name}</span>
                  {#if mode === 'author' && selectedAnnotation?.element_slug === annotation.element_slug}
                    <span class="resize-handle nw" onpointerdown={(e) => beginResizeDrag(e, annotation, 'nw')} aria-hidden="true"></span>
                    <span class="resize-handle ne" onpointerdown={(e) => beginResizeDrag(e, annotation, 'ne')} aria-hidden="true"></span>
                    <span class="resize-handle sw" onpointerdown={(e) => beginResizeDrag(e, annotation, 'sw')} aria-hidden="true"></span>
                    <span class="resize-handle se" onpointerdown={(e) => beginResizeDrag(e, annotation, 'se')} aria-hidden="true"></span>
                  {/if}
                </button>
              {/each}
              <!-- Live rubber-band preview when creating a new region -->
              {#if drag?.kind === 'create' && drag.moved}
                {@const xPct = (drag.startBbox.x / selectedState.viewport_w) * 100}
                {@const yPct = (drag.startBbox.y / selectedState.viewport_h) * 100}
                {@const wPct = (drag.startBbox.w / selectedState.viewport_w) * 100}
                {@const hPct = (drag.startBbox.h / selectedState.viewport_h) * 100}
                <div
                  class="canvas-rubber-band"
                  style="left: {xPct}%; top: {yPct}%; width: {wPct}%; height: {hPct}%;"
                ></div>
              {/if}
            </div>
          </div>
        </section>

        <!-- Right: inspector panel (read in view mode, edit in author mode) -->
        <aside class="canvas-inspector">
          {#if selectedAnnotation}
            {#if mode === 'view'}
              <h2>{selectedAnnotation.item_name}</h2>

              <section class="inspector-section">
                <h3>CLI</h3>
                {#if selectedAnnotation.cli_verbs.length === 0}
                  <p class="inspector-empty">No CLI verb wired to this element yet.</p>
                {:else}
                  <ul class="inspector-list">
                    {#each selectedAnnotation.cli_verbs as verb}
                      <li><code>{verb}</code></li>
                    {/each}
                  </ul>
                {/if}
              </section>

              <section class="inspector-section">
                <h3>Data sources</h3>
                {#if selectedAnnotation.data_sources.length === 0}
                  <p class="inspector-empty">No data sources logged.</p>
                {:else}
                  <ul class="inspector-list">
                    {#each selectedAnnotation.data_sources as src}
                      <li><code>{src}</code></li>
                    {/each}
                  </ul>
                {/if}
              </section>

              <section class="inspector-section">
                <h3>Logic</h3>
                <p>{selectedAnnotation.logic_text ?? '—'}</p>
              </section>

              <section class="inspector-section">
                <h3>Intended actions</h3>
                {#if selectedAnnotation.intended_actions.length === 0}
                  <p class="inspector-empty">—</p>
                {:else}
                  <ul class="inspector-list">
                    {#each selectedAnnotation.intended_actions as action}
                      <li>{action}</li>
                    {/each}
                  </ul>
                {/if}
              </section>

              <section class="inspector-section">
                <h3>Notes <span class="hint">(captured into the suggestions feed)</span></h3>
                {#if suggestionsForSelectedElement().length === 0}
                  <p class="inspector-empty">No notes yet — be the first.</p>
                {:else}
                  <ul class="suggestions-list">
                    {#each suggestionsForSelectedElement() as s (s.id)}
                      <li>
                        <div class="suggestion-body">{s.body}</div>
                        <div class="suggestion-meta">
                          {s.captured_by_handle} · {formatTimestamp(s.captured_at_ms)}
                        </div>
                      </li>
                    {/each}
                  </ul>
                {/if}
                <div class="suggestion-form">
                  <textarea
                    class="inspector-textarea"
                    rows="2"
                    placeholder="Add a note or question about this element…"
                    bind:value={suggestionDraft}
                    onkeydown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        captureSuggestion();
                      }
                    }}
                  ></textarea>
                  <div class="suggestion-form-row">
                    <span class="suggestion-form-hint">⌘↵ to send · feeds into <a href="/manual/suggestions">/manual/suggestions</a></span>
                    <button
                      type="button"
                      class="suggestion-add-btn"
                      onclick={captureSuggestion}
                      disabled={suggestionSaving || suggestionDraft.trim().length === 0}
                    >
                      {suggestionSaving ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </div>
              </section>

              <!-- Slice 6: audit log. Collapsed by default; expand to see
                   the recent edit history for this element. Closes the
                   third of JWPK's three original purposes (audit). -->
              <section class="inspector-section">
                <button
                  type="button"
                  class="audit-toggle"
                  aria-expanded={auditExpanded}
                  onclick={() => { auditExpanded = !auditExpanded; }}
                >
                  <span>Audit</span>
                  <span class="hint">
                    {auditEntries.length === 0
                      ? 'no edits yet'
                      : `${auditEntries.length} edit${auditEntries.length === 1 ? '' : 's'}`}
                  </span>
                  <span class="audit-chevron" aria-hidden="true">{auditExpanded ? '▾' : '▸'}</span>
                </button>
                {#if auditExpanded}
                  {#if auditEntries.length === 0}
                    <p class="inspector-empty">No edits recorded yet for this element.</p>
                  {:else}
                    <ul class="audit-list">
                      {#each auditEntries as entry (entry.id)}
                        <li>
                          <div class="audit-action audit-action-{entry.action}">{summariseAuditEntry(entry)}</div>
                          <div class="audit-meta">
                            {entry.edited_by_handle} · {formatTimestamp(entry.edited_at_ms)}
                          </div>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                {/if}
              </section>
            {:else}
              <!-- Author mode: editable form. Each input persists on
                   blur (no explicit save — keeps the surface honest). -->
              <h2 class="inspector-edit-title">Editing element</h2>

              <section class="inspector-section">
                <h3>Item name</h3>
                <input
                  type="text"
                  class="inspector-input"
                  value={selectedAnnotation.item_name}
                  onblur={(e) => updateFieldAndPersist('item_name', (e.currentTarget as HTMLInputElement).value)}
                />
              </section>

              <section class="inspector-section">
                <h3>CLI <span class="hint">(comma-separated)</span></h3>
                <input
                  type="text"
                  class="inspector-input"
                  value={selectedAnnotation.cli_verbs.join(', ')}
                  onblur={(e) => updateFieldAndPersist('cli_verbs', parseCommaList((e.currentTarget as HTMLInputElement).value))}
                />
              </section>

              <section class="inspector-section">
                <h3>Data sources <span class="hint">(comma-separated)</span></h3>
                <input
                  type="text"
                  class="inspector-input"
                  value={selectedAnnotation.data_sources.join(', ')}
                  onblur={(e) => updateFieldAndPersist('data_sources', parseCommaList((e.currentTarget as HTMLInputElement).value))}
                />
              </section>

              <section class="inspector-section">
                <h3>Logic</h3>
                <textarea
                  class="inspector-textarea"
                  rows="3"
                  value={selectedAnnotation.logic_text ?? ''}
                  onblur={(e) => updateFieldAndPersist('logic_text', (e.currentTarget as HTMLTextAreaElement).value || null)}
                ></textarea>
              </section>

              <section class="inspector-section">
                <h3>Intended actions <span class="hint">(comma-separated)</span></h3>
                <input
                  type="text"
                  class="inspector-input"
                  value={selectedAnnotation.intended_actions.join(', ')}
                  onblur={(e) => updateFieldAndPersist('intended_actions', parseCommaList((e.currentTarget as HTMLInputElement).value))}
                />
              </section>

              <section class="inspector-section">
                <h3>Bounding box <span class="hint">(image pixels)</span></h3>
                <div class="inspector-bbox">
                  x: {Math.round(selectedAnnotation.bbox.x)} ·
                  y: {Math.round(selectedAnnotation.bbox.y)} ·
                  w: {Math.round(selectedAnnotation.bbox.w)} ·
                  h: {Math.round(selectedAnnotation.bbox.h)}
                </div>
              </section>

              <section class="inspector-section">
                <button type="button" class="inspector-danger" onclick={() => deleteAnnotation(selectedAnnotation!)}>Delete element</button>
              </section>
            {/if}
          {:else}
            <div class="inspector-empty-state">
              {#if mode === 'view'}
                <p>Click any element on the screen to inspect it.</p>
                <p class="inspector-hint">
                  Keyboard: <kbd>Tab</kbd> through them in reading order ·
                  <kbd>Enter</kbd>/<kbd>Space</kbd> to select ·
                  <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> to walk between adjacent overlays ·
                  <kbd>Esc</kbd> to clear selection.
                </p>
              {:else}
                <p>Pick an element to edit, or drag-create a new one on an empty area.</p>
              {/if}
            </div>
          {/if}
        </aside>
      </div>
    {/if}
  </div>
</SimplePageShell>

<style>
  .canvas-page {
    padding: 1.25rem 1.5rem 2.5rem;
    color: var(--ink-strong, #0f172a);
  }
  .canvas-header { margin-bottom: 1rem; }
  .canvas-eyebrow {
    font: 600 0.7rem/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.08em;
    color: var(--accent, #6b21a8);
    margin-bottom: 0.5rem;
  }
  h1 { font: 800 1.85rem/1.1 ui-sans-serif, system-ui, sans-serif; margin: 0 0 0.25rem; }
  .canvas-summary {
    font: 500 0.95rem/1.5 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
    margin: 0;
    max-width: 60ch;
  }
  .canvas-status { color: var(--ink-muted, #475569); font-style: italic; }
  .canvas-error { color: #b91c1c; }

  .canvas-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 1.5rem;
    margin-top: 1.25rem;
  }
  @media (max-width: 960px) {
    .canvas-layout { grid-template-columns: 1fr; }
  }

  .canvas-tile { display: flex; flex-direction: column; gap: 0.75rem; }
  .canvas-meta {
    background: var(--surface-2, #f8fafc);
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 12px;
    padding: 0.6rem 0.85rem;
  }
  .screen-title {
    font: 700 0.95rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-strong, #0f172a);
  }
  .screen-description {
    margin-top: 0.25rem;
    font: 500 0.85rem/1.35 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
  }
  /* The frame lets the image dictate height (width: 100%, height: auto)
     so the overlay-coordinate space matches the rendered image exactly.
     Earlier shape used aspect-ratio + object-fit: contain which gave
     subpixel letterboxing → overlays drifted vertically vs the image
     (JWPK msg_eefo9z7141). The wrapper-around-image-with-natural-height
     pattern is the robust positioning-context approach.

     Border lives on an OUTER decorative wrapper so the inner
     positioning-context isn't affected by border-box vs content-box. */
  .canvas-image-frame {
    background: #fff;
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
  }
  .canvas-image-stage {
    position: relative;
    display: block;
    line-height: 0;
  }
  .canvas-image {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
  }
  .canvas-region {
    position: absolute;
    background: rgba(168, 85, 247, 0.08);
    border: 1.5px solid rgba(168, 85, 247, 0.55);
    border-radius: 4px;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  .canvas-region:hover,
  .canvas-region:focus-visible {
    background: rgba(168, 85, 247, 0.18);
    border-color: rgba(107, 33, 168, 0.95);
    outline: 2px solid rgba(107, 33, 168, 0.85);
    outline-offset: 2px;
  }
  .canvas-region.selected {
    background: rgba(168, 85, 247, 0.28);
    border-color: rgba(107, 33, 168, 1);
    border-width: 2px;
  }
  .region-slug {
    position: absolute;
    top: 4px;
    left: 6px;
    font: 600 0.7rem/1.1 ui-sans-serif, system-ui, sans-serif;
    background: rgba(107, 33, 168, 0.92);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    pointer-events: none;
    max-width: calc(100% - 12px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .canvas-region:hover .region-slug,
  .canvas-region:focus-visible .region-slug,
  .canvas-region.selected .region-slug {
    opacity: 1;
  }

  .canvas-inspector {
    background: var(--surface, #fff);
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 12px;
    padding: 1rem 1.1rem;
    min-height: 320px;
    align-self: start;
    position: sticky;
    top: 1rem;
  }
  .canvas-inspector h2 {
    font: 800 1.05rem/1.2 ui-sans-serif, system-ui, sans-serif;
    margin: 0 0 0.75rem;
  }
  .inspector-section {
    border-top: 1px solid var(--line-soft, #e2e8f0);
    padding: 0.65rem 0;
  }
  .inspector-section:first-of-type { border-top: none; padding-top: 0; }
  .inspector-section h3 {
    font: 700 0.72rem/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted, #475569);
    margin: 0 0 0.4rem;
  }
  .inspector-section p {
    margin: 0;
    font: 500 0.86rem/1.45 ui-sans-serif, system-ui, sans-serif;
  }
  .inspector-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .inspector-list li {
    font: 500 0.85rem/1.4 ui-sans-serif, system-ui, sans-serif;
  }
  .inspector-list code {
    background: var(--surface-2, #f1f5f9);
    padding: 1px 6px;
    border-radius: 4px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.8rem;
  }
  .inspector-empty {
    font-style: italic;
    color: var(--ink-muted, #94a3b8);
  }
  .inspector-empty-state {
    color: var(--ink-muted, #475569);
    font: 500 0.9rem/1.5 ui-sans-serif, system-ui, sans-serif;
  }
  .inspector-empty-state p { margin: 0 0 0.4rem; }
  .inspector-hint { font-size: 0.8rem; color: var(--ink-muted, #94a3b8); line-height: 1.5; }
  .inspector-hint kbd {
    display: inline-block;
    padding: 1px 5px;
    margin: 0 1px;
    border: 1px solid var(--line-soft, #d6d6d6);
    border-radius: 3px;
    background: var(--surface-2, #f1f5f9);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.7rem;
    color: var(--ink-strong, #0f172a);
  }

  /* Slice 4 a11y — visually hidden live region for screen reader narration. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ─── author-mode chrome (slice 1.5) ──────────────────────────── */
  .screen-meta-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--line-soft, #d6d6d6);
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface, #fff);
  }
  .mode-toggle button {
    background: transparent;
    border: none;
    padding: 4px 12px;
    font: 600 0.78rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
    cursor: pointer;
  }
  .mode-toggle button.active {
    background: var(--accent, #6b21a8);
    color: white;
  }
  .author-hint {
    margin-top: 0.5rem;
    font: 500 0.78rem/1.4 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
    padding: 0.4rem 0.6rem;
    background: rgba(168, 85, 247, 0.06);
    border-left: 3px solid var(--accent, #6b21a8);
    border-radius: 0 4px 4px 0;
  }
  .author-error { color: #b91c1c; }

  .canvas-image-stage.author-cursor { cursor: crosshair; }
  .canvas-region.author-mode { cursor: move; }
  .canvas-region.author-mode.selected { z-index: 2; }

  .resize-handle {
    position: absolute;
    width: 14px;
    height: 14px;
    background: white;
    border: 2px solid var(--accent, #6b21a8);
    border-radius: 3px;
    cursor: nwse-resize;
    z-index: 3;
  }
  .resize-handle.nw { top: -8px; left: -8px; cursor: nwse-resize; }
  .resize-handle.ne { top: -8px; right: -8px; cursor: nesw-resize; }
  .resize-handle.sw { bottom: -8px; left: -8px; cursor: nesw-resize; }
  .resize-handle.se { bottom: -8px; right: -8px; cursor: nwse-resize; }

  .canvas-rubber-band {
    position: absolute;
    background: rgba(34, 197, 94, 0.18);
    border: 2px dashed rgba(21, 128, 61, 0.9);
    border-radius: 4px;
    pointer-events: none;
    z-index: 4;
  }

  /* ─── editable inspector ─────────────────────────────────────── */
  .inspector-edit-title {
    font: 800 0.92rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--accent, #6b21a8);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 0.6rem;
  }
  .inspector-section h3 .hint {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--ink-muted, #94a3b8);
    margin-left: 0.4rem;
  }
  .inspector-input,
  .inspector-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--line-soft, #d6d6d6);
    border-radius: 6px;
    font: 500 0.85rem/1.4 ui-sans-serif, system-ui, sans-serif;
    background: var(--surface, #fff);
    color: var(--ink-strong, #0f172a);
  }
  .inspector-input:focus,
  .inspector-textarea:focus {
    outline: 2px solid var(--accent, #6b21a8);
    outline-offset: 1px;
    border-color: transparent;
  }
  .inspector-textarea { font-family: inherit; resize: vertical; }
  .inspector-bbox {
    font: 500 0.78rem/1.3 ui-monospace, "SF Mono", Menlo, monospace;
    color: var(--ink-muted, #475569);
    padding: 0.35rem 0.5rem;
    background: var(--surface-2, #f1f5f9);
    border-radius: 4px;
  }
  .inspector-danger {
    width: 100%;
    padding: 0.5rem 0.8rem;
    font: 600 0.82rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: #b91c1c;
    background: transparent;
    border: 1px solid #fca5a5;
    border-radius: 6px;
    cursor: pointer;
  }
  .inspector-danger:hover {
    background: rgba(220, 38, 38, 0.08);
    border-color: #b91c1c;
  }

  /* ─── slice 2: state-switcher tabs + create-state form ────────── */
  .state-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
    border-bottom: 1px solid var(--line-soft, #e2e8f0);
    padding-bottom: 0.5rem;
  }
  .state-tab {
    background: var(--surface, #fff);
    border: 1px solid var(--line-soft, #d6d6d6);
    border-radius: 999px;
    padding: 5px 14px;
    font: 600 0.82rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
    cursor: pointer;
  }
  .state-tab:hover { border-color: var(--accent, #6b21a8); color: var(--ink-strong, #0f172a); }
  .state-tab.active {
    background: var(--accent, #6b21a8);
    color: white;
    border-color: var(--accent, #6b21a8);
  }
  .state-tab-add {
    border-style: dashed;
    color: var(--accent, #6b21a8);
  }

  .new-state-form {
    background: var(--surface-2, #f8fafc);
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 8px;
    padding: 0.7rem 0.85rem;
    margin-bottom: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .new-state-row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .new-state-row label {
    flex: 0 0 7rem;
    font: 600 0.8rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
  }
  .new-state-row .inspector-input { flex: 1; }
  .new-state-row input[type="file"] {
    flex: 1;
    font: 500 0.82rem/1.2 ui-sans-serif, system-ui, sans-serif;
  }
  .new-state-error {
    font: 500 0.8rem/1.3 ui-sans-serif, system-ui, sans-serif;
    color: #b91c1c;
    background: rgba(220, 38, 38, 0.06);
    border-radius: 4px;
    padding: 0.3rem 0.5rem;
  }
  .new-state-actions {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
  }
  .new-state-cancel,
  .new-state-save {
    padding: 0.4rem 0.9rem;
    font: 600 0.82rem/1.2 ui-sans-serif, system-ui, sans-serif;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid var(--line-soft, #d6d6d6);
  }
  .new-state-cancel { background: transparent; color: var(--ink-muted, #475569); }
  .new-state-save {
    background: var(--accent, #6b21a8);
    color: white;
    border-color: var(--accent, #6b21a8);
  }
  .new-state-save:disabled,
  .new-state-cancel:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .meta-actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .state-delete-btn {
    background: transparent;
    border: 1px solid #fca5a5;
    color: #b91c1c;
    padding: 4px 12px;
    border-radius: 999px;
    font: 600 0.78rem/1.2 ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  .state-delete-btn:hover {
    background: rgba(220, 38, 38, 0.08);
    border-color: #b91c1c;
  }

  /* ─── slice 3: Notes capture inside inspector ──────────────────── */
  .suggestions-list {
    list-style: none;
    padding: 0;
    margin: 0 0 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .suggestions-list li {
    background: var(--surface-2, #f1f5f9);
    border-left: 3px solid var(--accent, #6b21a8);
    padding: 0.45rem 0.6rem;
    border-radius: 0 6px 6px 0;
  }
  .suggestion-body {
    font: 500 0.85rem/1.45 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-strong, #0f172a);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .suggestion-meta {
    margin-top: 0.2rem;
    font: 500 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #94a3b8);
  }
  .suggestion-form { display: flex; flex-direction: column; gap: 0.4rem; }
  .suggestion-form-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .suggestion-form-hint {
    font: 500 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #94a3b8);
  }
  .suggestion-form-hint a { color: var(--accent, #6b21a8); }
  .suggestion-add-btn {
    background: var(--accent, #6b21a8);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.35rem 0.9rem;
    font: 600 0.8rem/1.2 ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  .suggestion-add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ─── slice 6: audit log section ─────────────────────────────────── */
  .audit-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0;
    background: transparent;
    border: none;
    font: 700 0.72rem/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted, #475569);
    cursor: pointer;
    margin: 0 0 0.4rem;
  }
  .audit-toggle .hint {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--ink-muted, #94a3b8);
    margin-left: auto;
    margin-right: 0.4rem;
  }
  .audit-chevron {
    color: var(--ink-muted, #94a3b8);
    font-size: 0.85rem;
  }
  .audit-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .audit-list li {
    background: var(--surface-2, #f8fafc);
    border-left: 3px solid var(--line-soft, #d6d6d6);
    padding: 0.35rem 0.55rem;
    border-radius: 0 6px 6px 0;
  }
  .audit-action {
    font: 600 0.82rem/1.3 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-strong, #0f172a);
  }
  .audit-action-create { color: rgb(21, 128, 61); }
  .audit-action-delete { color: rgb(185, 28, 28); }
  .audit-meta {
    margin-top: 0.15rem;
    font: 500 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #94a3b8);
  }
</style>
