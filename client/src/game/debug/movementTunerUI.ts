import type { WelcomeMsg } from '@flathockey/shared';
import type { WsClient } from '../net/wsClient';
import {
  LOCAL_KEY,
  DEFAULTS,
  clearStoredTuning,
  exportTuning,
  getTuning,
  replaceTuning,
  resetTuning,
  setTuning,
  type MovementTuning
} from './movementTuning';
import {
  PARAM_REGISTRY,
  type TuningCategory,
  type TuningParamMeta
} from './tuningRegistry';
import {
  applySelection,
  clearPresetAndPinnedStorage,
  findPresetById,
  isPresetDirty,
  listAllPresets,
  loadPinnedKeys,
  loadPresetState,
  saveAsPreset,
  saveCurrentToSelected,
  savePinnedKeys,
  savePresetState,
  type PresetState
} from './presetStore';

let dragLockCount = 0;
let canvasPointerBackup: string | null = null;

export function isDevMenuDragging(): boolean {
  return dragLockCount > 0;
}

function setDragLock(locked: boolean) {
  if (locked) dragLockCount += 1;
  else dragLockCount = Math.max(0, dragLockCount - 1);

  const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
  if (dragLockCount > 0) {
    document.body.dataset.devmenuDragging = '1';
    if (canvas) {
      if (canvasPointerBackup === null) canvasPointerBackup = canvas.style.pointerEvents || '';
      canvas.style.pointerEvents = 'none';
    }
  } else {
    delete document.body.dataset.devmenuDragging;
    if (canvas) canvas.style.pointerEvents = canvasPointerBackup ?? '';
    canvasPointerBackup = null;
  }
}

type MenuTab = 'Home' | 'Movement' | 'NetDebug' | 'Rotation' | 'Puck';

type TunerHandle = {
  root: HTMLDivElement;
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  onWelcome: (msg: WelcomeMsg) => void;
  destroy: () => void;
};

type DevMenuState = {
  activeTab: MenuTab;
  searchQuery: string;
  advancedExpandedByCategory: Record<string, boolean>;
  pinnedKeys: string[];
  dirty: boolean;
};

const TAB_LABELS: Record<MenuTab, string> = {
  Home: 'Home',
  Movement: 'Movement',
  NetDebug: 'Net/Debug',
  Rotation: 'Rotation',
  Puck: 'Puck'
};

const COMING_SOON_TABS = new Set<MenuTab>(['Rotation', 'Puck']);

function createStyles() {
  if (document.getElementById('movement-devmenu-style-v2')) return;
  const style = document.createElement('style');
  style.id = 'movement-devmenu-style-v2';
  style.textContent = `
    #movement-devmenu { --bg:#101317; --panel:#161b20; --line:#2a323b; --text:#d8dde5; --muted:#8f9baa; --accent:#4eb6a1; --warn:#cf9151; position:fixed; top:12px; right:12px; width:372px; max-height:calc(100vh - 24px); border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--text); z-index:12000; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; display:flex; flex-direction:column; pointer-events:auto; overflow:hidden; box-shadow:0 8px 26px rgba(0,0,0,.35);}
    #movement-devmenu *{box-sizing:border-box;}
    #movement-devmenu .head{background:var(--panel); border-bottom:1px solid var(--line); padding:10px 10px 8px; display:grid; gap:8px;}
    #movement-devmenu .title-row{display:flex; justify-content:space-between; align-items:center; gap:8px;}
    #movement-devmenu .title{font-size:12px; letter-spacing:.04em; font-weight:700;}
    #movement-devmenu .subtle{color:var(--muted); font-size:10px;}
    #movement-devmenu .preset-row{display:grid; grid-template-columns:1fr auto; gap:6px; align-items:center;}
    #movement-devmenu select, #movement-devmenu input[type="text"], #movement-devmenu input[type="number"]{height:24px; border:1px solid var(--line); background:#0d1115; color:var(--text); border-radius:4px; padding:0 6px; font-size:11px; min-width:0;}
    #movement-devmenu .tabs{display:grid; grid-template-columns:repeat(5,1fr); gap:4px;}
    #movement-devmenu .tab-btn{height:24px; border:1px solid var(--line); border-radius:4px; background:#11161b; color:var(--text); font-size:10px; cursor:pointer; padding:0;}
    #movement-devmenu .tab-btn.active{background:#1a2624; border-color:#2d5d53; color:#d6efe8;}
    #movement-devmenu .tab-btn:disabled{opacity:.5; cursor:default;}
    #movement-devmenu .search-wrap{display:grid; gap:6px;}
    #movement-devmenu .search-results{display:grid; gap:4px; max-height:130px; overflow-y:auto;}
    #movement-devmenu .search-item{border:1px solid var(--line); background:#11161b; color:var(--text); border-radius:4px; padding:6px; text-align:left; cursor:pointer; font-size:10px;}
    #movement-devmenu .search-item .meta{color:var(--muted); font-size:9px; margin-top:2px;}
    #movement-devmenu .body{padding:8px 10px 10px; overflow-y:auto; display:grid; gap:8px; touch-action:pan-y; overscroll-behavior:contain;}
    #movement-devmenu .group{border:1px solid var(--line); border-radius:6px; background:#12171d; overflow:hidden;}
    #movement-devmenu .group-head{border-bottom:1px solid var(--line); padding:6px 8px; font-size:10px; color:#f0f3f8; background:#171e25;}
    #movement-devmenu .group-body{padding:4px 8px 6px; display:grid; gap:6px;}
    #movement-devmenu .row{border:1px solid var(--line); border-radius:4px; background:#0f1419; padding:6px; display:grid; gap:5px;}
    #movement-devmenu .row.highlight{animation:devmenu-highlight 1.2s ease; border-color:#5abfaa;}
    @keyframes devmenu-highlight{0%{background:#1a2b26;}100%{background:#0f1419;}}
    #movement-devmenu .row-top{display:grid; grid-template-columns:1fr auto auto auto; gap:6px; align-items:center;}
    #movement-devmenu .row-name{font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
    #movement-devmenu .badge{font-size:9px; color:var(--muted); border:1px solid var(--line); border-radius:8px; padding:1px 6px;}
    #movement-devmenu .icon-btn, #movement-devmenu .text-btn{height:20px; border:1px solid var(--line); background:#131a20; color:var(--muted); border-radius:4px; font-size:10px; cursor:pointer; padding:0 6px;}
    #movement-devmenu .icon-btn.pinned{color:#f4d16e;}
    #movement-devmenu .row-val{display:grid; grid-template-columns:1fr auto; gap:6px; align-items:center;}
    #movement-devmenu .bool-wrap{display:flex; align-items:center; justify-content:flex-end; gap:6px;}
    #movement-devmenu .slider{height:16px; display:flex; align-items:center; touch-action:none; user-select:none;}
    #movement-devmenu .track{position:relative; width:100%; height:6px; border-radius:6px; background:#29333d; overflow:hidden;}
    #movement-devmenu .fill{position:absolute; inset:0 auto 0 0; width:0%; background:var(--accent);}
    #movement-devmenu .thumb{position:absolute; top:50%; width:12px; height:12px; border-radius:50%; transform:translate(-50%, -50%); background:#e7ecf3; border:1px solid #6f7f8f; cursor:ew-resize;}
    #movement-devmenu .advanced{border:1px solid var(--line); border-radius:6px; overflow:hidden; background:#11161b;}
    #movement-devmenu .advanced > button{width:100%; text-align:left; background:#171e25; border:0; border-bottom:1px solid var(--line); color:#d3dae2; font-size:10px; padding:6px 8px; cursor:pointer;}
    #movement-devmenu .empty{border:1px dashed var(--line); border-radius:6px; color:var(--muted); padding:10px; font-size:11px; text-align:center;}
    #movement-devmenu .net-actions{display:grid; grid-template-columns:repeat(2,1fr); gap:6px;}
    #movement-devmenu .action-btn{height:26px; border:1px solid var(--line); background:#182028; color:var(--text); border-radius:4px; font-size:11px; cursor:pointer;}
    #movement-devmenu .action-btn.primary{background:#183028; border-color:#2e6556;}
    #movement-devmenu .action-btn.warn{color:#ffbf84;}
    #movement-devmenu .action-btn:disabled{opacity:.45; cursor:default;}
    #movement-devmenu .status{font-size:10px; color:var(--muted); min-height:12px; text-align:right;}
    @media (max-width:720px){#movement-devmenu{right:8px; left:8px; width:auto;}}
  `;
  document.head.appendChild(style);
}

function normalizeCategoryToTab(category: TuningCategory): MenuTab {
  if (category === 'NetDebug') return 'NetDebug';
  if (category === 'Rotation') return 'Rotation';
  if (category === 'Puck') return 'Puck';
  return 'Movement';
}

function getMetaByKey(key: keyof MovementTuning): TuningParamMeta | undefined {
  return PARAM_REGISTRY.find((m) => m.key === key);
}

function isMovementContextualRecommended(meta: TuningParamMeta, tuning: MovementTuning): boolean {
  if (!meta.recommended) return false;
  const regimes = !!tuning.regimesEnabled;
  if (regimes) {
    if (meta.key === 'accel' || meta.key === 'dragMove') return false;
    if (meta.key === 'accel_lo' || meta.key === 'accel_hi') return true;
    if (meta.key === 'dragMove_lo' || meta.key === 'dragMove_hi') return true;
  } else if (
    meta.key === 'accel_lo' || meta.key === 'accel_hi' || meta.key === 'dragMove_lo' || meta.key === 'dragMove_hi'
  ) {
    return false;
  }
  return true;
}

export function createMovementTuner(wsClient?: WsClient): TunerHandle {
  createStyles();
  const root = document.createElement('div');
  root.id = 'movement-devmenu';
  root.addEventListener('pointerdown', (e) => e.stopPropagation());

  const state: DevMenuState = {
    activeTab: 'Movement',
    searchQuery: '',
    advancedExpandedByCategory: { Movement: false },
    pinnedKeys: loadPinnedKeys(PARAM_REGISTRY.map((m) => String(m.key))),
    dirty: false
  };

  let allowTuningSync = false;
  let visible = true;
  let presetState: PresetState = loadPresetState();

  try {
    if (!localStorage.getItem(LOCAL_KEY)) {
      const selected = findPresetById(presetState, presetState.selectedPresetId);
      if (selected) replaceTuning(selected.tuning);
    }
  } catch {}

  const head = document.createElement('div');
  head.className = 'head';
  const titleRow = document.createElement('div');
  titleRow.className = 'title-row';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'MOVEMENT DEV MENU';
  const f3Hint = document.createElement('div');
  f3Hint.className = 'subtle';
  f3Hint.textContent = 'F3 show/hide';
  titleRow.append(title, f3Hint);

  const presetRow = document.createElement('div');
  presetRow.className = 'preset-row';
  const presetSelect = document.createElement('select');
  const saveAsInlineBtn = document.createElement('button');
  saveAsInlineBtn.className = 'text-btn';
  saveAsInlineBtn.textContent = 'Save As';
  presetRow.append(presetSelect, saveAsInlineBtn);

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const tabButtons = new Map<MenuTab, HTMLButtonElement>();
  (Object.keys(TAB_LABELS) as MenuTab[]).forEach((tab) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.textContent = TAB_LABELS[tab];
    btn.disabled = COMING_SOON_TABS.has(tab);
    if (btn.disabled) btn.title = 'Coming soon';
    btn.addEventListener('click', () => {
      state.activeTab = tab;
      renderTab();
    });
    tabButtons.set(tab, btn);
    tabs.appendChild(btn);
  });

  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-wrap';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search param: turn, damp, grip...';
  const searchResults = document.createElement('div');
  searchResults.className = 'search-results';
  searchWrap.append(searchInput, searchResults);

  head.append(titleRow, presetRow, tabs, searchWrap);
  const body = document.createElement('div');
  body.className = 'body';
  root.append(head, body);
  document.body.appendChild(root);

  const rowByKey = new Map<string, HTMLElement[]>();
  const refreshers: Array<() => void> = [];
  let statusLineEl: HTMLElement | null = null;
  let statusFlashTimer: number | null = null;
  let statusFlashText = '';

  function allPresets() { return listAllPresets(presetState); }
  function selectedPreset() { return findPresetById(presetState, presetState.selectedPresetId); }

  function postStatus(text: string) {
    statusFlashText = text;
    if (statusFlashTimer !== null) window.clearTimeout(statusFlashTimer);
    refreshStatusLine();
    statusFlashTimer = window.setTimeout(() => {
      statusFlashText = '';
      refreshStatusLine();
    }, 1800);
  }

  function refreshStatusLine() {
    if (!statusLineEl) return;
    const preset = selectedPreset();
    state.dirty = isPresetDirty(preset);
    const dirtyText = state.dirty ? 'Unsaved changes' : 'Saved';
    const presetName = preset?.name ?? 'n/a';
    const ver = getTuning().__version ?? 0;
    const extra = statusFlashText ? ` | ${statusFlashText}` : '';
    statusLineEl.textContent = `Preset: ${presetName} | ${dirtyText} | v${ver}${extra}`;
  }

  function refreshPresetSelect() {
    presetSelect.innerHTML = '';
    for (const preset of allPresets()) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.source === 'builtin' ? `${preset.name} (built-in)` : preset.name;
      presetSelect.appendChild(opt);
    }
    presetSelect.value = presetState.selectedPresetId;
  }

  function togglePinned(key: keyof MovementTuning) {
    const sKey = String(key);
    if (state.pinnedKeys.includes(sKey)) state.pinnedKeys = state.pinnedKeys.filter((k) => k !== sKey);
    else state.pinnedKeys = [...state.pinnedKeys, sKey];
    savePinnedKeys(state.pinnedKeys);
    renderTab();
  }

  function isPinned(key: keyof MovementTuning) {
    return state.pinnedKeys.includes(String(key));
  }

  function clearBody() {
    body.innerHTML = '';
    rowByKey.clear();
    refreshers.length = 0;
    statusLineEl = null;
  }

  function registerRow(key: keyof MovementTuning, el: HTMLElement) {
    const k = String(key);
    const arr = rowByKey.get(k) ?? [];
    arr.push(el);
    rowByKey.set(k, arr);
  }

  function highlightParam(key: keyof MovementTuning) {
    const rows = rowByKey.get(String(key));
    if (!rows?.length) return;
    const target = rows[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('highlight');
    void target.offsetWidth;
    target.classList.add('highlight');
  }

  function createGroup(titleText: string): { root: HTMLDivElement; body: HTMLDivElement } {
    const group = document.createElement('div');
    group.className = 'group';
    const headEl = document.createElement('div');
    headEl.className = 'group-head';
    headEl.textContent = titleText;
    const bodyEl = document.createElement('div');
    bodyEl.className = 'group-body';
    group.append(headEl, bodyEl);
    return { root: group, body: bodyEl };
  }

  function createParamRow(meta: TuningParamMeta, opts?: { showCategoryBadge?: boolean; allowPin?: boolean; onTogglePin?: () => void }) {
    const row = document.createElement('div');
    row.className = 'row';
    registerRow(meta.key, row);

    const rowTop = document.createElement('div');
    rowTop.className = 'row-top';
    const name = document.createElement('div');
    name.className = 'row-name';
    name.textContent = meta.label;
    if (meta.hint) name.title = meta.hint;
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = meta.group;
    badge.style.display = opts?.showCategoryBadge ? 'inline-block' : 'none';
    const pinBtn = document.createElement('button');
    pinBtn.className = `icon-btn ${isPinned(meta.key) ? 'pinned' : ''}`;
    pinBtn.textContent = isPinned(meta.key) ? 'Unpin' : 'Pin';
    pinBtn.style.display = opts?.allowPin === false ? 'none' : 'inline-block';
    pinBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (opts?.onTogglePin) opts.onTogglePin();
      else togglePinned(meta.key);
    });
    const resetBtn = document.createElement('button');
    resetBtn.className = 'icon-btn';
    resetBtn.textContent = 'Reset';
    rowTop.append(name, badge, pinBtn, resetBtn);
    row.append(rowTop);

    const tuning = getTuning();
    const defaultValue = (DEFAULTS as Record<string, unknown>)[meta.key as string];

    if (meta.kind === 'boolean') {
      const boolWrap = document.createElement('div');
      boolWrap.className = 'bool-wrap';
      const boolLabel = document.createElement('span');
      boolLabel.className = 'subtle';
      boolLabel.textContent = 'Enabled';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean((tuning as Record<string, unknown>)[meta.key as string]);
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        setTuning({ [meta.key]: checkbox.checked } as Partial<MovementTuning>);
        refreshStatusLine();
        if (meta.key === 'regimesEnabled' && state.activeTab === 'Movement') renderTab();
      });
      boolWrap.append(boolLabel, checkbox);
      row.append(boolWrap);
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setTuning({ [meta.key]: Boolean(defaultValue) } as Partial<MovementTuning>);
        checkbox.checked = Boolean(defaultValue);
        refreshStatusLine();
        if (meta.key === 'regimesEnabled' && state.activeTab === 'Movement') renderTab();
      });
      refreshers.push(() => {
        checkbox.checked = Boolean((getTuning() as Record<string, unknown>)[meta.key as string]);
      });
      return row;
    }

    const min = meta.min ?? 0;
    const max = meta.max ?? Math.max(1, Number(defaultValue) * 2 || 1);
    const step = meta.step ?? 0.01;
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;

    const valueWrap = document.createElement('div');
    valueWrap.className = 'row-val';
    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.min = String(min);
    valueInput.max = String(max);
    valueInput.step = String(step);
    valueInput.value = String((tuning as Record<string, unknown>)[meta.key as string] ?? defaultValue ?? 0);
    const valueText = document.createElement('div');
    valueText.className = 'subtle';
    valueText.style.minWidth = '54px';
    valueText.style.textAlign = 'right';
    valueWrap.append(valueInput, valueText);

    const slider = document.createElement('div');
    slider.className = 'slider';
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    track.append(fill, thumb);
    slider.append(track);
    row.append(valueWrap, slider);

    const applyNumber = (raw: number) => {
      const next = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : 0));
      setTuning({ [meta.key]: next } as Partial<MovementTuning>);
      valueInput.value = String(next);
      valueText.textContent = next.toFixed(decimals);
      const pct = max > min ? (next - min) / (max - min) : 0;
      fill.style.width = `${pct * 100}%`;
      thumb.style.left = `${pct * 100}%`;
      refreshStatusLine();
    };

    const updateFromClientX = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      applyNumber(min + (max - min) * t);
    };

    const dragState = { dragging: false, pointerId: -1, captureEl: null as HTMLElement | null };
    const stopDrag = () => {
      if (!dragState.dragging) return;
      if (dragState.captureEl && dragState.captureEl.hasPointerCapture(dragState.pointerId)) {
        dragState.captureEl.releasePointerCapture(dragState.pointerId);
      }
      dragState.dragging = false;
      dragState.pointerId = -1;
      dragState.captureEl = null;
      setDragLock(false);
      window.removeEventListener('pointerup', stopDrag);
    };
    const startDrag = (e: PointerEvent, captureEl: HTMLElement) => {
      e.preventDefault();
      e.stopPropagation();
      dragState.dragging = true;
      dragState.pointerId = e.pointerId;
      dragState.captureEl = captureEl;
      captureEl.setPointerCapture(e.pointerId);
      setDragLock(true);
      window.addEventListener('pointerup', stopDrag);
      updateFromClientX(e.clientX);
    };
    const moveDrag = (e: PointerEvent) => {
      if (!dragState.dragging || e.pointerId !== dragState.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      updateFromClientX(e.clientX);
    };
    track.addEventListener('pointerdown', (e) => startDrag(e, track));
    thumb.addEventListener('pointerdown', (e) => startDrag(e, thumb));
    track.addEventListener('pointermove', moveDrag);
    thumb.addEventListener('pointermove', moveDrag);
    track.addEventListener('pointerup', stopDrag);
    thumb.addEventListener('pointerup', stopDrag);
    track.addEventListener('pointercancel', stopDrag);
    thumb.addEventListener('pointercancel', stopDrag);

    valueInput.addEventListener('change', () => applyNumber(Number(valueInput.value)));
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyNumber(Number(defaultValue ?? 0));
    });

    refreshers.push(() => {
      const v = Number((getTuning() as Record<string, unknown>)[meta.key as string] ?? defaultValue ?? 0);
      valueInput.value = String(v);
      valueText.textContent = v.toFixed(decimals);
      const pct = max > min ? (v - min) / (max - min) : 0;
      fill.style.width = `${pct * 100}%`;
      thumb.style.left = `${pct * 100}%`;
    });
    refreshers[refreshers.length - 1]();
    return row;
  }

  function renderSearchResults() {
    searchResults.innerHTML = '';
    const q = state.searchQuery.trim().toLowerCase();
    if (!q) return;
    const matches = PARAM_REGISTRY.filter((meta) => {
      const haystack = [String(meta.key), meta.label, meta.group, meta.category, ...(meta.keywords ?? [])].join(' ').toLowerCase();
      return haystack.includes(q);
    }).slice(0, 20);
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No matching parameters';
      searchResults.appendChild(empty);
      return;
    }
    for (const meta of matches) {
      const btn = document.createElement('button');
      btn.className = 'search-item';
      btn.innerHTML = `<div>${meta.label}</div><div class="meta">${meta.category} / ${meta.group} / ${String(meta.key)}</div>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.activeTab = normalizeCategoryToTab(meta.category);
        if (state.activeTab === 'Movement') state.advancedExpandedByCategory.Movement = true;
        renderTab();
        window.setTimeout(() => highlightParam(meta.key), 50);
      });
      searchResults.appendChild(btn);
    }
  }

  function renderHomeTab() {
    const pinnedMetas = state.pinnedKeys
      .map((k) => getMetaByKey(k as keyof MovementTuning))
      .filter((m): m is TuningParamMeta => !!m);
    if (pinnedMetas.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No favourites pinned yet. Pin parameters in Movement to see them here.';
      body.appendChild(empty);
      return;
    }
    const group = createGroup('Pinned Favourites');
    for (const meta of pinnedMetas) {
      const row = createParamRow(meta, {
        showCategoryBadge: true,
        onTogglePin: () => togglePinned(meta.key)
      });
      const badge = row.querySelector('.badge') as HTMLElement | null;
      if (badge) badge.textContent = TAB_LABELS[normalizeCategoryToTab(meta.category)];
      group.body.appendChild(row);
    }
    body.appendChild(group.root);
  }

  function renderMovementTab() {
    const tuning = getTuning();
    const movementMetas = PARAM_REGISTRY.filter((m) => m.category === 'Movement');
    const reduced = movementMetas
      .filter((m) => isMovementContextualRecommended(m, tuning))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    const reducedGroups = new Map<string, TuningParamMeta[]>();
    for (const meta of reduced) {
      const arr = reducedGroups.get(meta.group) ?? [];
      arr.push(meta);
      reducedGroups.set(meta.group, arr);
    }
    for (const [groupName, metas] of reducedGroups) {
      const group = createGroup(groupName);
      for (const meta of metas) group.body.appendChild(createParamRow(meta));
      body.appendChild(group.root);
    }

    const reducedKeys = new Set(reduced.map((m) => String(m.key)));
    const advancedMetas = movementMetas.filter((m) => !reducedKeys.has(String(m.key)));
    const advWrap = document.createElement('div');
    advWrap.className = 'advanced';
    const advToggle = document.createElement('button');
    const advOpen = !!state.advancedExpandedByCategory.Movement;
    advToggle.textContent = advOpen ? 'Advanced [-]' : 'Advanced [+]';
    advToggle.addEventListener('click', () => {
      state.advancedExpandedByCategory.Movement = !state.advancedExpandedByCategory.Movement;
      renderTab();
    });
    advWrap.appendChild(advToggle);
    if (advOpen) {
      const advBody = document.createElement('div');
      advBody.style.display = 'grid';
      advBody.style.gap = '8px';
      advBody.style.padding = '8px';
      const byGroup = new Map<string, TuningParamMeta[]>();
      for (const meta of advancedMetas) {
        const arr = byGroup.get(meta.group) ?? [];
        arr.push(meta);
        byGroup.set(meta.group, arr);
      }
      for (const [groupName, metas] of byGroup) {
        const group = createGroup(groupName);
        for (const meta of metas.sort((a, b) => a.label.localeCompare(b.label))) {
          group.body.appendChild(createParamRow(meta));
        }
        advBody.appendChild(group.root);
      }
      advWrap.appendChild(advBody);
    }
    body.appendChild(advWrap);
  }

  function renderNetDebugTab() {
    const group = createGroup('Actions');
    const actions = document.createElement('div');
    actions.className = 'net-actions';

    const applyLocalBtn = document.createElement('button');
    applyLocalBtn.className = 'action-btn primary';
    applyLocalBtn.textContent = 'Apply (local)';
    const applyServerBtn = document.createElement('button');
    applyServerBtn.className = 'action-btn';
    applyServerBtn.textContent = 'Apply to Server';
    const serverEnabled = allowTuningSync && !!wsClient && wsClient.isConnected();
    applyServerBtn.disabled = !serverEnabled;
    applyServerBtn.title = serverEnabled ? 'Send active tuning to server' : 'Server tuning sync disabled';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'action-btn';
    saveBtn.textContent = 'Save';
    const saveAsBtn = document.createElement('button');
    saveAsBtn.className = 'action-btn';
    saveAsBtn.textContent = 'Save As';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'action-btn';
    resetBtn.textContent = 'Reset';
    const logBtn = document.createElement('button');
    logBtn.className = 'action-btn';
    logBtn.textContent = 'Log JSON';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'action-btn warn';
    clearBtn.textContent = 'Clear Storage';
    const hideBtn = document.createElement('button');
    hideBtn.className = 'action-btn';
    hideBtn.textContent = 'Hide';
    actions.append(applyLocalBtn, applyServerBtn, saveBtn, saveAsBtn, resetBtn, logBtn, clearBtn, hideBtn);
    group.body.appendChild(actions);

    const status = document.createElement('div');
    status.className = 'status';
    group.body.appendChild(status);
    statusLineEl = status;

    applyLocalBtn.addEventListener('click', () => postStatus('Applied locally'));
    applyServerBtn.addEventListener('click', () => {
      if (!wsClient || !allowTuningSync || !wsClient.isConnected()) return postStatus('Server sync unavailable');
      wsClient.send({ type: 'debug:setMovementTuning', config: JSON.parse(exportTuning()) });
      postStatus('Sent to server');
    });
    saveBtn.addEventListener('click', () => {
      const result = saveCurrentToSelected(presetState);
      if (result.requiresSaveAs) {
        const name = window.prompt('Built-in presets are read-only. Save As name:', 'MyPreset');
        if (!name) return;
        presetState = saveAsPreset(presetState, name);
        savePresetState(presetState);
        refreshPresetSelect();
        renderTab();
        return postStatus(`Saved as ${name.trim()}`);
      }
      presetState = result.state;
      refreshPresetSelect();
      refreshStatusLine();
      postStatus('Preset saved');
    });
    saveAsBtn.addEventListener('click', () => {
      const name = window.prompt('Save As preset name:', selectedPreset()?.name ?? 'MyPreset');
      if (!name) return;
      presetState = saveAsPreset(presetState, name);
      refreshPresetSelect();
      renderTab();
      postStatus(`Saved as ${name.trim()}`);
    });
    resetBtn.addEventListener('click', () => {
      resetTuning();
      for (const refresh of refreshers) refresh();
      refreshStatusLine();
      postStatus('Reset runtime tuning');
    });
    logBtn.addEventListener('click', () => {
      console.log(exportTuning());
      postStatus('JSON logged');
    });
    clearBtn.addEventListener('click', () => {
      clearStoredTuning();
      clearPresetAndPinnedStorage();
      presetState = loadPresetState();
      state.pinnedKeys = [];
      refreshPresetSelect();
      renderTab();
      postStatus('Storage cleared');
    });
    hideBtn.addEventListener('click', () => {
      visible = false;
      root.style.display = 'none';
    });

    body.appendChild(group.root);
    refreshStatusLine();
  }

  function renderPlaceholder(tab: MenuTab) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `${TAB_LABELS[tab]} controls are coming soon.`;
    body.appendChild(empty);
  }

  function renderTab() {
    clearBody();
    for (const [tab, btn] of tabButtons) btn.classList.toggle('active', tab === state.activeTab);
    if (state.activeTab === 'Home') renderHomeTab();
    else if (state.activeTab === 'Movement') renderMovementTab();
    else if (state.activeTab === 'NetDebug') renderNetDebugTab();
    else renderPlaceholder(state.activeTab);
    for (const refresh of refreshers) refresh();
    refreshStatusLine();
    renderSearchResults();
  }

  searchInput.addEventListener('input', () => {
    state.searchQuery = searchInput.value;
    renderSearchResults();
  });

  presetSelect.addEventListener('change', () => {
    presetState = applySelection(presetState, presetSelect.value);
    savePresetState(presetState);
    const selected = selectedPreset();
    if (selected) replaceTuning(selected.tuning);
    refreshPresetSelect();
    renderTab();
    postStatus(`Preset applied: ${selected?.name ?? 'n/a'}`);
  });

  saveAsInlineBtn.addEventListener('click', () => {
    const name = window.prompt('Save As preset name:', selectedPreset()?.name ?? 'MyPreset');
    if (!name) return;
    presetState = saveAsPreset(presetState, name);
    refreshPresetSelect();
    renderTab();
    postStatus(`Saved as ${name.trim()}`);
  });

  refreshPresetSelect();
  renderTab();

  return {
    root,
    setVisible(next: boolean) {
      visible = next;
      root.style.display = next ? 'flex' : 'none';
      if (!next) setDragLock(false);
    },
    isVisible() {
      return visible;
    },
    onWelcome(msg: WelcomeMsg) {
      allowTuningSync = !!msg.allowTuningSync;
      if (state.activeTab === 'NetDebug') renderTab();
    },
    destroy() {
      setDragLock(false);
      root.remove();
    }
  };
}
