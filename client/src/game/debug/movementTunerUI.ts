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
  setTuningKey,
  subscribeTuning,
  type MovementTuning
} from './movementTuning';
import { puckStickTuningStore, PUCK_STICK_DEFAULTS_LOCAL, type PuckStickTuning } from '../tuning/puckStickTuningStore';
import {
  PARAM_REGISTRY,
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
import { lastTelemetry, lastAimInputRateLimited } from '../net/prediction';

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
  advancedExpandedByCategory: Record<string, boolean>;
  pinnedKeys: string[];
  dirty: boolean;
  panelLocked: boolean;
  autoLayoutEnabled: boolean;
  fixedColumns: 1 | 2 | 3;
  sectionCollapseOverrides: Partial<Record<MenuTab, Record<string, boolean>>>;
};

type DevPanelLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  activeTab: MenuTab;
  panelLocked: boolean;
  autoLayoutEnabled?: boolean;
  fixedColumns?: 1 | 2 | 3;
  sectionCollapseOverrides?: Partial<Record<MenuTab, Record<string, boolean>>>;
};

type LayoutMode = 'NARROW' | 'MEDIUM' | 'WIDE';
type HeightMode = 'SHORT' | 'TALL';

type SectionModeRule = {
  order: number;
  columnSpan?: 1 | 2 | 3;
  collapsed?: boolean;
};

type SectionMeta = {
  id: string;
  title: string;
  priority: number;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  tone?: 'core' | 'control' | 'aim' | 'shot' | 'debug' | 'advanced';
  modeRules?: Partial<Record<LayoutMode, SectionModeRule>>;
};

const TAB_LABELS: Record<MenuTab, string> = {
  Home: 'Home',
  Movement: 'Movement',
  Rotation: 'Rotation',
  Puck: 'Puck',
  NetDebug: 'Net/Debug'
};
const TAB_ORDER: MenuTab[] = ['Home', 'Movement', 'Rotation', 'Puck', 'NetDebug'];

const COMING_SOON_TABS = new Set<MenuTab>();
const DEVMENU_LAYOUT_KEY = 'fh_devmenu_layout_v1';
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 280;
const PANEL_MARGIN = 8;

const PUCK_UI_KEY_MAP: Partial<Record<keyof MovementTuning, keyof PuckStickTuning>> = {
  stickOffsetX: 'stickOffsetX',
  stickOffsetY: 'stickOffsetY',
  stickLength: 'stickLength',
  stickTipRadius: 'stickTipRadius',
  stickVisualLag: 'stickVisualLag',
  stickVisualLagMaxDeg: 'stickVisualLagMaxDeg',
  drawStickTarget: 'drawStickTarget',
  drawStickHitbox: 'drawStickHitbox',
  puckRadius: 'puckRadius',
  puckMaxSpeed: 'maxSpeed',
  puckLinearDamping: 'linearDamping',
  puckRestitution: 'restitution',
  puckSurfaceDrag: 'surfaceDrag',
  puckPickupRadius: 'pickupRadius',
  puckPickupMaxSpeed: 'pickupMaxPuckSpeed',
  puckPickupMaxRelativeSpeed: 'pickupMaxRelativeSpeed',
  puckMagnetRadius: 'magnetRadius',
  puckMagnetStrength: 'magnetStrength',
  puckMagnetMaxForce: 'magnetMaxForce',
  puckHoldSpringK: 'holdSpringK',
  puckHoldDampingC: 'holdDampingC',
  puckHoldMaxError: 'holdMaxError',
  puckPickupCooldownMs: 'pickupCooldownMs',
  puckShotBaseImpulse: 'shotBaseImpulse',
  puckShotChargeRate: 'shotChargeRate',
  puckShotChargeMult: 'shotChargeMult',
  puckShotMaxImpulse: 'shotMaxImpulse',
  puckShotMinHoldMs: 'shotMinHoldMs',
  puckDrawPickupRadius: 'drawPickupRadius',
  puckDrawMagnetRadius: 'drawMagnetRadius',
  puckDrawState: 'drawPuckState',
  puckDrawVelocity: 'drawPuckVelocity'
};

function createStyles() {
  if (document.getElementById('movement-devmenu-style-v2')) return;
  const style = document.createElement('style');
  style.id = 'movement-devmenu-style-v2';
  style.textContent = `
    #movement-devmenu { --bg:#101317; --panel:#161b20; --line:#2a323b; --text:#d8dde5; --muted:#8f9baa; --accent:#4eb6a1; --warn:#cf9151; --panel-accent-core: 150,160,172; --panel-accent-control: 78,182,161; --panel-accent-aim: 94,146,221; --panel-accent-shot: 207,145,81; --panel-accent-debug: 130,136,149; --panel-accent-advanced: 122,113,158; position:fixed; top:12px; right:12px; width:372px; height:min(720px,calc(90vh)); border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--text); z-index:12000; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; display:flex; flex-direction:column; pointer-events:auto; overflow:hidden; box-shadow:0 8px 26px rgba(0,0,0,.35); min-height:0;}
    #movement-devmenu.locked .head{cursor:default;}
    #movement-devmenu *{box-sizing:border-box;}
    #movement-devmenu .head{background:var(--panel); border-bottom:1px solid var(--line); padding:10px 10px 8px; display:grid; gap:8px; cursor:grab; user-select:none; touch-action:none; flex:0 0 auto; position:sticky; top:0; z-index:5;}
    #movement-devmenu .title-row{display:flex; justify-content:space-between; align-items:center; gap:8px;}
    #movement-devmenu .title{font-size:12px; letter-spacing:.04em; font-weight:700;}
    #movement-devmenu .subtle{color:var(--muted); font-size:10px;}
    #movement-devmenu .preset-row{display:grid; grid-template-columns:1fr auto; gap:6px; align-items:center;}
    #movement-devmenu .header-actions{display:grid; grid-template-columns:repeat(4,1fr); gap:6px;}
    #movement-devmenu select, #movement-devmenu input[type="text"], #movement-devmenu input[type="number"]{height:24px; border:1px solid var(--line); background:#0d1115; color:var(--text); border-radius:4px; padding:0 6px; font-size:11px; min-width:0;}
    #movement-devmenu .tabs{display:grid; grid-template-columns:repeat(5,1fr); gap:4px;}
    #movement-devmenu .tab-btn{height:24px; border:1px solid var(--line); border-radius:4px; background:#11161b; color:var(--text); font-size:10px; cursor:pointer; padding:0;}
    #movement-devmenu .tab-btn.active{background:#1a2624; border-color:#2d5d53; color:#d6efe8;}
    #movement-devmenu .tab-btn:disabled{opacity:.5; cursor:default;}
    #movement-devmenu .body{padding:8px 10px 10px; overflow:auto; display:grid; gap:12px; touch-action:pan-y; overscroll-behavior:contain; flex:1 1 auto; min-height:0; align-content:start;}
    #movement-devmenu .section-grid{display:grid; gap:12px; grid-template-columns:repeat(var(--section-cols,1), minmax(0,1fr)); align-items:start; align-content:start; grid-auto-flow:row dense;}
    #movement-devmenu .group{border:1px solid var(--line); border-radius:6px; background:#12171d; overflow:hidden;}
    #movement-devmenu .group.card{min-width:0; border-left:3px solid rgba(var(--panel-accent-core), .5);}
    #movement-devmenu .group.card[data-tone="control"]{border-left-color:rgba(var(--panel-accent-control), .6);}
    #movement-devmenu .group.card[data-tone="aim"]{border-left-color:rgba(var(--panel-accent-aim), .6);}
    #movement-devmenu .group.card[data-tone="shot"]{border-left-color:rgba(var(--panel-accent-shot), .6);}
    #movement-devmenu .group.card[data-tone="debug"]{border-left-color:rgba(var(--panel-accent-debug), .55);}
    #movement-devmenu .group.card[data-tone="advanced"]{border-left-color:rgba(var(--panel-accent-advanced), .55);}
    #movement-devmenu .group-head{border-bottom:1px solid var(--line); padding:6px 8px; font-size:10px; color:#f0f3f8; background:rgba(var(--panel-accent-core), .06); position:sticky; top:0; z-index:2;}
    #movement-devmenu .group.card[data-tone="control"] .group-head{background:rgba(var(--panel-accent-control), .07);}
    #movement-devmenu .group.card[data-tone="aim"] .group-head{background:rgba(var(--panel-accent-aim), .07);}
    #movement-devmenu .group.card[data-tone="shot"] .group-head{background:rgba(var(--panel-accent-shot), .08);}
    #movement-devmenu .group.card[data-tone="debug"] .group-head{background:rgba(var(--panel-accent-debug), .07);}
    #movement-devmenu .group.card[data-tone="advanced"] .group-head{background:rgba(var(--panel-accent-advanced), .08);}
    #movement-devmenu .group-head.group-toggle{display:flex; justify-content:space-between; align-items:center; cursor:pointer; user-select:none;}
    #movement-devmenu .group-head .head-actions{display:flex; align-items:center; gap:6px;}
    #movement-devmenu .group-head .section-reset{height:18px; border:1px solid var(--line); background:#141a20; color:var(--muted); border-radius:4px; font-size:9px; padding:0 5px; cursor:pointer;}
    #movement-devmenu .group-head .chev{color:var(--muted);}
    #movement-devmenu .group-body{padding:6px 8px 8px; display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); align-items:start;}
    #movement-devmenu .group-body.compact{grid-template-columns:1fr;}
    #movement-devmenu .group.span-2{grid-column:span 2;}
    #movement-devmenu .group.span-3{grid-column:span 3;}
    #movement-devmenu .full-span{grid-column:1 / -1;}
    #movement-devmenu .row{border:1px solid var(--line); border-radius:4px; background:#0f1419; padding:8px; display:grid; gap:7px; min-height:88px; align-content:start; min-width:0;}
    #movement-devmenu .row.dirty{border-color:#5da08f; box-shadow:inset 0 0 0 1px rgba(78,182,161,.22);}
    #movement-devmenu .row.row-bool{min-height:72px;}
    #movement-devmenu .row.row-full{grid-column:1 / -1;}
    #movement-devmenu .row.highlight{animation:devmenu-highlight 1.2s ease; border-color:#5abfaa;}
    @keyframes devmenu-highlight{0%{background:#1a2b26;}100%{background:#0f1419;}}
    #movement-devmenu .row-top{display:grid; grid-template-columns:minmax(0,1fr) auto auto auto; gap:6px; align-items:start; min-width:0;}
    #movement-devmenu .row-label{display:grid; gap:2px; min-width:0;}
    #movement-devmenu .row-name{font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
    #movement-devmenu .row-dot{display:none; color:#6dd4bc; font-size:11px; line-height:1;}
    #movement-devmenu .row.dirty .row-dot{display:inline;}
    #movement-devmenu .row-key{font-size:9px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
    #movement-devmenu .badge{font-size:9px; color:var(--muted); border:1px solid var(--line); border-radius:8px; padding:1px 6px;}
    #movement-devmenu .icon-btn, #movement-devmenu .text-btn{height:20px; border:1px solid var(--line); background:#131a20; color:var(--muted); border-radius:4px; font-size:10px; cursor:pointer; padding:0 6px;}
    #movement-devmenu .icon-btn.pinned{color:#f4d16e;}
    #movement-devmenu .row-val{display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; align-items:center; min-width:0;}
    #movement-devmenu .bool-wrap{display:flex; align-items:center; justify-content:flex-end; gap:6px;}
    #movement-devmenu .slider{height:18px; display:flex; align-items:center; touch-action:none; user-select:none;}
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
    #movement-devmenu .resize-grip{position:absolute; right:0; bottom:0; width:14px; height:14px; cursor:nwse-resize; background:linear-gradient(135deg, transparent 50%, #3a4552 50%);}
    #movement-devmenu.locked .resize-grip{display:none;}
    @media (max-width:720px){#movement-devmenu{right:8px; width:min(calc(100vw - 16px),480px);}}
  `;
  document.head.appendChild(style);
}

function normalizeCategoryToTab(category: TuningParamMeta['category']): MenuTab {
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeParseLayout(raw: string | null): Partial<DevPanelLayout> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DevPanelLayout>;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function getViewportBounds() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(PANEL_MIN_WIDTH, Math.floor(viewportWidth * 0.9));
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, Math.floor(viewportHeight * 0.9));
  return { viewportWidth, viewportHeight, maxWidth, maxHeight };
}

function buildDefaultLayout(): DevPanelLayout {
  const { viewportWidth, maxWidth, maxHeight } = getViewportBounds();
  const width = clamp(372, PANEL_MIN_WIDTH, maxWidth);
  const height = clamp(640, PANEL_MIN_HEIGHT, maxHeight);
  const x = clamp(viewportWidth - width - 12, PANEL_MARGIN, Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN));
  return { x, y: 12, width, height, activeTab: 'Home', panelLocked: false, autoLayoutEnabled: true, fixedColumns: 2, sectionCollapseOverrides: {} };
}

function normalizeLayout(input: Partial<DevPanelLayout> | null): DevPanelLayout {
  const base = buildDefaultLayout();
  const { viewportWidth, viewportHeight, maxWidth, maxHeight } = getViewportBounds();
  const width = clamp(Number(input?.width ?? base.width), PANEL_MIN_WIDTH, maxWidth);
  const height = clamp(Number(input?.height ?? base.height), PANEL_MIN_HEIGHT, maxHeight);
  const maxX = Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN);
  const maxY = Math.max(PANEL_MARGIN, viewportHeight - height - PANEL_MARGIN);
  const x = clamp(Number(input?.x ?? base.x), PANEL_MARGIN, maxX);
  const y = clamp(Number(input?.y ?? base.y), PANEL_MARGIN, maxY);
  const activeTab = (Object.keys(TAB_LABELS) as MenuTab[]).includes(input?.activeTab as MenuTab)
    ? (input?.activeTab as MenuTab)
    : base.activeTab;
  const panelLocked = Boolean(input?.panelLocked ?? base.panelLocked);
  const autoLayoutEnabled = Boolean(input?.autoLayoutEnabled ?? base.autoLayoutEnabled);
  const fixedColumnsRaw = Number(input?.fixedColumns ?? base.fixedColumns);
  const fixedColumns: 1 | 2 | 3 = fixedColumnsRaw === 3 ? 3 : fixedColumnsRaw === 1 ? 1 : 2;
  const sectionCollapseOverrides = (input?.sectionCollapseOverrides && typeof input.sectionCollapseOverrides === 'object')
    ? input.sectionCollapseOverrides
    : {};
  return { x, y, width, height, activeTab, panelLocked, autoLayoutEnabled, fixedColumns, sectionCollapseOverrides };
}

function getLayoutMode(width: number): LayoutMode {
  if (width < 520) return 'NARROW';
  if (width <= 860) return 'MEDIUM';
  return 'WIDE';
}

function getHeightMode(height: number): HeightMode {
  return height < 650 ? 'SHORT' : 'TALL';
}

export function createMovementTuner(wsClient?: WsClient): TunerHandle {
  createStyles();
  const root = document.createElement('div');
  root.id = 'movement-devmenu';
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  let storedLayoutRaw: string | null = null;
  try {
    storedLayoutRaw = localStorage.getItem(DEVMENU_LAYOUT_KEY);
  } catch {}
  const savedLayout = normalizeLayout(safeParseLayout(storedLayoutRaw));
  let layout = { ...savedLayout };

  const state: DevMenuState = {
    activeTab: layout.activeTab,
    advancedExpandedByCategory: { Movement: false },
    pinnedKeys: loadPinnedKeys(PARAM_REGISTRY.map((m) => String(m.key))),
    dirty: false,
    panelLocked: layout.panelLocked,
    autoLayoutEnabled: layout.autoLayoutEnabled ?? true,
    fixedColumns: layout.fixedColumns ?? 2,
    sectionCollapseOverrides: layout.sectionCollapseOverrides ?? {}
  };
  root.classList.toggle('locked', state.panelLocked);

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
  const headerMeta = document.createElement('div');
  headerMeta.className = 'subtle';
  headerMeta.textContent = 'F3 show/hide';
  titleRow.append(title, headerMeta);

  const presetRow = document.createElement('div');
  presetRow.className = 'preset-row';
  const presetSelect = document.createElement('select');
  const f3Hint = document.createElement('div');
  f3Hint.className = 'subtle';
  f3Hint.style.textAlign = 'right';
  f3Hint.textContent = 'F3';
  presetRow.append(presetSelect, f3Hint);

  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';
  const headerSaveBtn = document.createElement('button');
  headerSaveBtn.className = 'text-btn';
  headerSaveBtn.textContent = 'Save';
  const headerSaveAsBtn = document.createElement('button');
  headerSaveAsBtn.className = 'text-btn';
  headerSaveAsBtn.textContent = 'Save As';
  const headerResetBtn = document.createElement('button');
  headerResetBtn.className = 'text-btn';
  headerResetBtn.textContent = 'Reset';
  const headerCloseBtn = document.createElement('button');
  headerCloseBtn.className = 'text-btn';
  headerCloseBtn.textContent = 'Close';
  headerActions.append(headerSaveBtn, headerSaveAsBtn, headerResetBtn, headerCloseBtn);

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const tabButtons = new Map<MenuTab, HTMLButtonElement>();
  TAB_ORDER.forEach((tab) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.textContent = TAB_LABELS[tab];
    btn.disabled = COMING_SOON_TABS.has(tab);
    if (btn.disabled) btn.title = 'Coming soon';
    btn.addEventListener('click', () => {
      state.activeTab = tab;
      persistLayout();
      renderTab();
    });
    tabButtons.set(tab, btn);
    tabs.appendChild(btn);
  });

  head.append(titleRow, presetRow, headerActions, tabs);
  const body = document.createElement('div');
  body.className = 'body';
  const resizeGrip = document.createElement('div');
  resizeGrip.className = 'resize-grip';
  resizeGrip.title = 'Resize panel';
  root.append(head, body);
  root.appendChild(resizeGrip);
  document.body.appendChild(root);

  const rowByKey = new Map<string, HTMLElement[]>();
  const refreshers: Array<() => void> = [];
  let statusLineEl: HTMLElement | null = null;
  let movementSummaryEl: HTMLElement | null = null;
  let statusFlashTimer: number | null = null;
  let statusFlashText = '';
  const unsubscribeTuning = subscribeTuning(() => {
    for (const refresh of refreshers) refresh();
    refreshStatusLine();
  });
  const liveRefreshTimer = window.setInterval(() => {
    if (!visible) return;
    for (const refresh of refreshers) refresh();
  }, 100);

  const dragState = { active: false, pointerId: -1, startX: 0, startY: 0, startLeft: 0, startTop: 0 };
  const resizeState = { active: false, pointerId: -1, startX: 0, startY: 0, startWidth: 0, startHeight: 0 };
  let activeSliderDragCount = 0;
  let layoutMode: LayoutMode = getLayoutMode(layout.width);
  let heightMode: HeightMode = getHeightMode(layout.height);

  function getColumnsForMode(mode: LayoutMode): 1 | 2 | 3 {
    if (mode === 'WIDE') return 3;
    if (mode === 'MEDIUM') return 2;
    return 1;
  }

  function getActiveColumns(): 1 | 2 | 3 {
    return state.autoLayoutEnabled ? getColumnsForMode(layoutMode) : state.fixedColumns;
  }

  function getSectionOverride(tab: MenuTab, id: string): boolean | null {
    const tabMap = state.sectionCollapseOverrides[tab];
    if (!tabMap) return null;
    if (!(id in tabMap)) return null;
    return !!tabMap[id];
  }

  function setSectionOverride(tab: MenuTab, id: string, collapsed: boolean) {
    const existing = state.sectionCollapseOverrides[tab] ?? {};
    state.sectionCollapseOverrides = {
      ...state.sectionCollapseOverrides,
      [tab]: { ...existing, [id]: collapsed }
    };
    persistLayout();
  }

  function resolveSectionCollapsed(tab: MenuTab, meta: SectionMeta): boolean {
    const manual = getSectionOverride(tab, meta.id);
    if (manual !== null) return manual;
    const modeRule = meta.modeRules?.[layoutMode];
    if (typeof modeRule?.collapsed === 'boolean') return modeRule.collapsed;
    if (heightMode === 'SHORT' && meta.id.toLowerCase().includes('debug')) return true;
    return !!meta.defaultCollapsed;
  }

  function persistLayout() {
    layout = normalizeLayout({
      ...layout,
      activeTab: state.activeTab,
      panelLocked: state.panelLocked,
      autoLayoutEnabled: state.autoLayoutEnabled,
      fixedColumns: state.fixedColumns,
      sectionCollapseOverrides: state.sectionCollapseOverrides
    });
    try {
      localStorage.setItem(DEVMENU_LAYOUT_KEY, JSON.stringify(layout));
    } catch {}
  }

  function applyLayout(next: Partial<DevPanelLayout>, persist = true) {
    layout = normalizeLayout({ ...layout, ...next, activeTab: state.activeTab, panelLocked: state.panelLocked });
    root.style.left = `${layout.x}px`;
    root.style.top = `${layout.y}px`;
    root.style.right = 'auto';
    root.style.width = `${layout.width}px`;
    root.style.height = `${layout.height}px`;
    const prevLayoutMode = layoutMode;
    const prevHeightMode = heightMode;
    layoutMode = getLayoutMode(layout.width);
    heightMode = getHeightMode(layout.height);
    root.style.setProperty('--section-cols', String(getActiveColumns()));
    if ((prevLayoutMode !== layoutMode || prevHeightMode !== heightMode) && body.childElementCount > 0) {
      const prevScrollTop = body.scrollTop;
      renderTab();
      body.scrollTop = Math.min(prevScrollTop, Math.max(0, body.scrollHeight - body.clientHeight));
      return;
    }
    if (persist) persistLayout();
  }

  function applyLockUi() {
    root.classList.toggle('locked', state.panelLocked);
    head.style.cursor = state.panelLocked ? 'default' : 'grab';
  }

  const onDragMove = (e: PointerEvent) => {
    if (!dragState.active || e.pointerId !== dragState.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    applyLayout({ x: dragState.startLeft + dx, y: dragState.startTop + dy });
  };

  const stopDrag = (e?: PointerEvent) => {
    if (!dragState.active) return;
    if (e && e.pointerId !== dragState.pointerId) return;
    dragState.active = false;
    if (head.hasPointerCapture(dragState.pointerId)) head.releasePointerCapture(dragState.pointerId);
    dragState.pointerId = -1;
    setDragLock(false);
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
  };

  head.addEventListener('pointerdown', (e) => {
    if (state.panelLocked) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, select, label')) return;
    e.preventDefault();
    dragState.active = true;
    dragState.pointerId = e.pointerId;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.startLeft = layout.x;
    dragState.startTop = layout.y;
    head.setPointerCapture(e.pointerId);
    setDragLock(true);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  });

  const onResizeMove = (e: PointerEvent) => {
    if (!resizeState.active || e.pointerId !== resizeState.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - resizeState.startX;
    const dy = e.clientY - resizeState.startY;
    applyLayout({ width: resizeState.startWidth + dx, height: resizeState.startHeight + dy });
  };

  const stopResize = (e?: PointerEvent) => {
    if (!resizeState.active) return;
    if (e && e.pointerId !== resizeState.pointerId) return;
    resizeState.active = false;
    if (resizeGrip.hasPointerCapture(resizeState.pointerId)) resizeGrip.releasePointerCapture(resizeState.pointerId);
    resizeState.pointerId = -1;
    setDragLock(false);
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
  };

  resizeGrip.addEventListener('pointerdown', (e) => {
    if (state.panelLocked) return;
    e.preventDefault();
    e.stopPropagation();
    resizeState.active = true;
    resizeState.pointerId = e.pointerId;
    resizeState.startX = e.clientX;
    resizeState.startY = e.clientY;
    resizeState.startWidth = layout.width;
    resizeState.startHeight = layout.height;
    resizeGrip.setPointerCapture(e.pointerId);
    setDragLock(true);
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  });

  const onWindowResize = () => applyLayout({}, true);
  window.addEventListener('resize', onWindowResize);
  applyLayout(layout, false);
  applyLockUi();

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
    const preset = selectedPreset();
    state.dirty = isPresetDirty(preset);
    const dirtyText = state.dirty ? 'Unsaved changes' : 'Saved';
    const presetName = preset?.name ?? 'n/a';
    const ver = getTuning().__version ?? 0;
    const extra = statusFlashText ? ` | ${statusFlashText}` : '';
    if (statusLineEl) {
      statusLineEl.textContent = `Preset: ${presetName} | ${dirtyText} | v${ver}${extra}`;
    }
    headerMeta.textContent = `Preset: ${presetName} | Dirty: ${state.dirty ? 'yes' : 'no'} | v${ver}`;
    if (movementSummaryEl) {
      movementSummaryEl.textContent = `Active preset: ${presetName} | Dirty: ${state.dirty ? 'yes' : 'no'} | v${ver}`;
    }
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

  function handleSavePreset() {
    const result = saveCurrentToSelected(presetState);
    if (result.requiresSaveAs) {
      const name = window.prompt('Built-in presets are read-only. Save As name:', 'MyPreset');
      if (!name) return;
      presetState = saveAsPreset(presetState, name);
      savePresetState(presetState);
      refreshPresetSelect();
      renderTab();
      postStatus(`Saved as ${name.trim()}`);
      return;
    }
    presetState = result.state;
    refreshPresetSelect();
    renderTab();
    refreshStatusLine();
    postStatus('Preset saved');
  }

  function handleSaveAsPreset() {
    const name = window.prompt('Save As preset name:', selectedPreset()?.name ?? 'MyPreset');
    if (!name) return;
    presetState = saveAsPreset(presetState, name);
    refreshPresetSelect();
    renderTab();
    postStatus(`Saved as ${name.trim()}`);
  }

  function handleResetRuntime() {
    resetTuning();
    for (const refresh of refreshers) refresh();
    refreshStatusLine();
    postStatus('Reset runtime tuning');
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

  function getCurrentValueForMeta(meta: TuningParamMeta): unknown {
    const puckKey = PUCK_UI_KEY_MAP[meta.key];
    if (meta.category === 'Puck' && puckKey) {
      return (puckStickTuningStore.get() as Record<string, unknown>)[puckKey as string];
    }
    return (getTuning() as Record<string, unknown>)[meta.key as string];
  }

  function getBaselineValueForMeta(meta: TuningParamMeta): { value: unknown; source: 'preset' | 'default' } {
    const preset = selectedPreset();
    const presetVal = preset ? (preset.tuning as Record<string, unknown>)[meta.key as string] : undefined;
    if (presetVal !== undefined) return { value: presetVal, source: 'preset' };
    const puckKey = PUCK_UI_KEY_MAP[meta.key];
    if (meta.category === 'Puck' && puckKey) {
      return {
        value: (PUCK_STICK_DEFAULTS_LOCAL as Record<string, unknown>)[puckKey as string],
        source: 'default'
      };
    }
    return { value: (DEFAULTS as Record<string, unknown>)[meta.key as string], source: 'default' };
  }

  function setMetaToValue(meta: TuningParamMeta, value: unknown) {
    const puckKey = PUCK_UI_KEY_MAP[meta.key];
    if (meta.category === 'Puck' && puckKey) {
      puckStickTuningStore.set(puckKey, value as PuckStickTuning[typeof puckKey]);
    } else {
      setTuningKey(meta.key, value as MovementTuning[typeof meta.key]);
    }
  }

  function clearBody() {
    body.innerHTML = '';
    rowByKey.clear();
    refreshers.length = 0;
    statusLineEl = null;
    movementSummaryEl = null;
  }

  function registerRow(key: keyof MovementTuning, el: HTMLElement) {
    const k = String(key);
    const arr = rowByKey.get(k) ?? [];
    arr.push(el);
    rowByKey.set(k, arr);
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

  function createSectionGrid() {
    const wrap = document.createElement('div');
    wrap.className = 'section-grid';
    wrap.style.setProperty('--section-cols', String(getActiveColumns()));
    return wrap;
  }

  function createSectionCard(
    tab: MenuTab,
    meta: SectionMeta,
    options?: { resetMetas?: TuningParamMeta[] }
  ): { root: HTMLDivElement; body: HTMLDivElement; head: HTMLDivElement; collapsed: boolean } {
    const group = document.createElement('div');
    group.className = 'group card';
    group.dataset.sectionId = meta.id;
    group.dataset.tone = meta.tone ?? 'core';
    const cols = getActiveColumns();
    const modeRule = meta.modeRules?.[layoutMode];
    const span = Math.max(1, Math.min(cols, Number(modeRule?.columnSpan ?? 1)));
    if (span > 1) group.classList.add(`span-${span}`);
    const order = Number(modeRule?.order ?? meta.priority ?? 0);
    group.style.order = String(order);

    const headEl = document.createElement('div');
    const collapsed = resolveSectionCollapsed(tab, meta);
    headEl.className = `group-head ${meta.collapsible ? 'group-toggle' : ''}`;
    const titleEl = document.createElement('span');
    titleEl.textContent = meta.title;
    const actionsEl = document.createElement('span');
    actionsEl.className = 'head-actions';
    headEl.append(titleEl, actionsEl);
    if (options?.resetMetas?.length) {
      const sectionResetBtn = document.createElement('button');
      sectionResetBtn.className = 'section-reset';
      sectionResetBtn.textContent = 'Reset sekci';
      sectionResetBtn.title = 'Reset this section to preset/default values';
      sectionResetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        for (const metaItem of options.resetMetas ?? []) {
          const baseline = getBaselineValueForMeta(metaItem);
          setMetaToValue(metaItem, baseline.value);
        }
        for (const refresh of refreshers) refresh();
        refreshStatusLine();
      });
      actionsEl.appendChild(sectionResetBtn);
    }
    if (meta.collapsible) {
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = collapsed ? '[+]' : '[-]';
      actionsEl.appendChild(chev);
      headEl.addEventListener('click', () => {
        const next = !resolveSectionCollapsed(tab, meta);
        setSectionOverride(tab, meta.id, next);
        renderTab();
      });
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'group-body';
    if (heightMode === 'SHORT' && layoutMode === 'NARROW') bodyEl.classList.add('compact');
    bodyEl.style.display = collapsed ? 'none' : 'grid';
    group.append(headEl, bodyEl);
    return { root: group, body: bodyEl, head: headEl, collapsed };
  }

  function createParamRow(
    meta: TuningParamMeta,
    opts?: { showCategoryBadge?: boolean; allowPin?: boolean; onTogglePin?: () => void; fullWidth?: boolean }
  ) {
    const row = document.createElement('div');
    row.className = 'row';
    if (opts?.fullWidth) row.classList.add('row-full');
    registerRow(meta.key, row);

    const rowTop = document.createElement('div');
    rowTop.className = 'row-top';
    const rowLabel = document.createElement('div');
    rowLabel.className = 'row-label';
    const name = document.createElement('div');
    name.className = 'row-name';
    name.textContent = meta.label;
    if (meta.hint) name.title = meta.hint;
    const rowDot = document.createElement('span');
    rowDot.className = 'row-dot';
    rowDot.textContent = '●';
    const keyText = document.createElement('div');
    keyText.className = 'row-key';
    keyText.textContent = `key: ${String(meta.key)}`;
    rowLabel.append(name, rowDot, keyText);
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
    rowTop.append(rowLabel, badge, pinBtn, resetBtn);
    row.append(rowTop);

    const baseline = getBaselineValueForMeta(meta);
    const currentValue = getCurrentValueForMeta(meta);
    const defaultValue = baseline.value;
    const isNumeric = meta.kind === 'number';
    const updateDirtyState = () => {
      const baselineNext = getBaselineValueForMeta(meta);
      const live = getCurrentValueForMeta(meta);
      const dirty = isNumeric
        ? Math.abs(Number(live ?? 0) - Number(baselineNext.value ?? 0)) > 1e-6
        : (meta.kind === 'boolean'
            ? Boolean(live) !== Boolean(baselineNext.value)
            : String(live ?? '') !== String(baselineNext.value ?? ''));
      row.classList.toggle('dirty', dirty);
      rowDot.style.display = dirty ? 'inline' : 'none';
      resetBtn.title = `Reset to ${baselineNext.source} value`;
    };
    updateDirtyState();

    if (meta.kind === 'boolean') {
      row.classList.add('row-bool');
      const boolWrap = document.createElement('div');
      boolWrap.className = 'bool-wrap';
      const boolLabel = document.createElement('span');
      boolLabel.className = 'subtle';
      boolLabel.textContent = 'Enabled';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(currentValue);
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        setMetaToValue(meta, checkbox.checked);
        refreshStatusLine();
        if (meta.key === 'regimesEnabled' && state.activeTab === 'Movement') renderTab();
      });
      boolWrap.append(boolLabel, checkbox);
      row.append(boolWrap);
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextBaseline = getBaselineValueForMeta(meta);
        setMetaToValue(meta, Boolean(nextBaseline.value));
        checkbox.checked = Boolean(nextBaseline.value);
        refreshStatusLine();
        if (meta.key === 'regimesEnabled' && state.activeTab === 'Movement') renderTab();
      });
      refreshers.push(() => {
        checkbox.checked = Boolean(getCurrentValueForMeta(meta));
        updateDirtyState();
      });
      return row;
    }

    if (meta.kind === 'enum') {
      const enumWrap = document.createElement('div');
      enumWrap.className = 'row-val';
      const select = document.createElement('select');
      const options = meta.enumOptions ?? [];
      for (const opt of options) {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        select.appendChild(el);
      }
      const fallback = String(currentValue ?? defaultValue ?? '');
      if (![...select.options].some((o) => o.value === fallback)) {
        const el = document.createElement('option');
        el.value = fallback;
        el.textContent = fallback;
        select.appendChild(el);
      }
      select.value = fallback;
      const valueText = document.createElement('div');
      valueText.className = 'subtle';
      valueText.style.minWidth = '54px';
      valueText.style.textAlign = 'right';
      valueText.textContent = select.value;
      enumWrap.append(select, valueText);
      row.append(enumWrap);
      select.addEventListener('change', () => {
        setMetaToValue(meta, select.value);
        valueText.textContent = select.value;
        refreshStatusLine();
        updateDirtyState();
      });
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextBaseline = String(getBaselineValueForMeta(meta).value ?? '');
        if (![...select.options].some((o) => o.value === nextBaseline)) {
          const el = document.createElement('option');
          el.value = nextBaseline;
          el.textContent = nextBaseline;
          select.appendChild(el);
        }
        setMetaToValue(meta, nextBaseline);
        select.value = nextBaseline;
        valueText.textContent = nextBaseline;
        refreshStatusLine();
        updateDirtyState();
      });
      refreshers.push(() => {
        const next = String(getCurrentValueForMeta(meta) ?? '');
        if (![...select.options].some((o) => o.value === next)) {
          const el = document.createElement('option');
          el.value = next;
          el.textContent = next;
          select.appendChild(el);
        }
        select.value = next;
        valueText.textContent = next;
        updateDirtyState();
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
    valueInput.value = String(currentValue ?? defaultValue ?? 0);
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

    const APPLY_THROTTLE_MS = 75;
    let throttledTimer: number | null = null;
    let throttledPending: number | null = null;
    let throttledLastAt = 0;

    const applyNumberImmediate = (raw: number) => {
      const next = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : 0));
      setMetaToValue(meta, next);
      valueInput.value = String(next);
      valueText.textContent = next.toFixed(decimals);
      const pct = max > min ? (next - min) / (max - min) : 0;
      fill.style.width = `${pct * 100}%`;
      thumb.style.left = `${pct * 100}%`;
      refreshStatusLine();
      updateDirtyState();
    };

    const flushThrottledApply = () => {
      if (throttledPending === null) return;
      const v = throttledPending;
      throttledPending = null;
      throttledLastAt = performance.now();
      applyNumberImmediate(v);
    };

    const applyNumberThrottled = (raw: number) => {
      throttledPending = raw;
      const now = performance.now();
      const elapsed = now - throttledLastAt;
      if (elapsed >= APPLY_THROTTLE_MS) {
        if (throttledTimer !== null) {
          window.clearTimeout(throttledTimer);
          throttledTimer = null;
        }
        flushThrottledApply();
        return;
      }
      if (throttledTimer === null) {
        throttledTimer = window.setTimeout(() => {
          throttledTimer = null;
          flushThrottledApply();
        }, APPLY_THROTTLE_MS - elapsed);
      }
    };

    const updateFromClientX = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      applyNumberThrottled(min + (max - min) * t);
    };

    const dragState = { dragging: false, pointerId: -1, captureEl: null as HTMLElement | null, rafId: 0, pendingX: 0 };
    const flushDrag = () => {
      dragState.rafId = 0;
      updateFromClientX(dragState.pendingX);
    };
    const stopDrag = () => {
      if (!dragState.dragging) return;
      if (dragState.captureEl && dragState.captureEl.hasPointerCapture(dragState.pointerId)) {
        dragState.captureEl.releasePointerCapture(dragState.pointerId);
      }
      dragState.dragging = false;
      dragState.pointerId = -1;
      dragState.captureEl = null;
      if (dragState.rafId) window.cancelAnimationFrame(dragState.rafId);
      dragState.rafId = 0;
      if (throttledTimer !== null) {
        window.clearTimeout(throttledTimer);
        throttledTimer = null;
      }
      flushThrottledApply();
      activeSliderDragCount = Math.max(0, activeSliderDragCount - 1);
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
      activeSliderDragCount += 1;
      setDragLock(true);
      window.addEventListener('pointerup', stopDrag);
      dragState.pendingX = e.clientX;
      if (!dragState.rafId) dragState.rafId = window.requestAnimationFrame(flushDrag);
    };
    const moveDrag = (e: PointerEvent) => {
      if (!dragState.dragging || e.pointerId !== dragState.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      dragState.pendingX = e.clientX;
      if (!dragState.rafId) dragState.rafId = window.requestAnimationFrame(flushDrag);
    };
    track.addEventListener('pointerdown', (e) => startDrag(e, track));
    thumb.addEventListener('pointerdown', (e) => startDrag(e, thumb));
    track.addEventListener('pointermove', moveDrag);
    thumb.addEventListener('pointermove', moveDrag);
    track.addEventListener('pointerup', stopDrag);
    thumb.addEventListener('pointerup', stopDrag);
    track.addEventListener('pointercancel', stopDrag);
    thumb.addEventListener('pointercancel', stopDrag);
    slider.addEventListener('wheel', (e) => {
      if (activeSliderDragCount > 0) e.preventDefault();
    }, { passive: false });

    let editStartValue = Number(currentValue ?? defaultValue ?? 0);
    valueInput.addEventListener('focus', () => {
      editStartValue = Number(valueInput.value);
      valueInput.select();
    });
    valueInput.addEventListener('click', () => valueInput.select());
    valueInput.addEventListener('keydown', (e) => {
      const baseStep = step;
      const jumpStep = step * 10;
      if (e.key === 'Enter') {
        e.preventDefault();
        applyNumberImmediate(Number(valueInput.value));
        valueInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        applyNumberImmediate(editStartValue);
        valueInput.value = String(editStartValue);
        valueInput.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const delta = (e.shiftKey ? jumpStep : baseStep) * (e.key === 'ArrowUp' ? 1 : -1);
        applyNumberImmediate(Number(valueInput.value) + delta);
      }
    });
    valueInput.addEventListener('change', () => applyNumberImmediate(Number(valueInput.value)));
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nextBaseline = getBaselineValueForMeta(meta);
      applyNumberImmediate(Number(nextBaseline.value ?? 0));
    });

    refreshers.push(() => {
      const v = Number(getCurrentValueForMeta(meta) ?? getBaselineValueForMeta(meta).value ?? 0);
      valueInput.value = String(v);
      valueText.textContent = v.toFixed(decimals);
      const pct = max > min ? (v - min) / (max - min) : 0;
      fill.style.width = `${pct * 100}%`;
      thumb.style.left = `${pct * 100}%`;
      updateDirtyState();
    });
    refreshers[refreshers.length - 1]();
    return row;
  }

  function renderHomeTab() {
    const basicGroup = createGroup('Basic Tuning');
    const basicKeys: Array<keyof MovementTuning> = [
      'maxSpeed',
      'accel',
      'dragMove',
      'handedness',
      'bodyManualTurnRateDeg',
      'maxBodyOffsetDeg',
      'bodyReturnTauMs',
      'stickTauMs',
      'maxStickAngleFromBodyDeg',
      'stickMaxAngVelDeg',
      'couplingEnabled',
      'couplingStrength'
    ];
    for (const key of basicKeys) {
      const meta = getMetaByKey(key);
      if (!meta) continue;
      const row = createParamRow(meta, { allowPin: false });
      basicGroup.body.appendChild(row);
    }
    const basicActions = document.createElement('div');
    basicActions.className = 'net-actions';
    basicActions.classList.add('full-span');
    const basicSaveBtn = document.createElement('button');
    basicSaveBtn.className = 'action-btn';
    basicSaveBtn.textContent = 'Save Preset';
    basicSaveBtn.addEventListener('click', handleSavePreset);
    const basicResetBtn = document.createElement('button');
    basicResetBtn.className = 'action-btn warn';
    basicResetBtn.textContent = 'Reset';
    basicResetBtn.addEventListener('click', handleResetRuntime);
    basicActions.append(basicSaveBtn, basicResetBtn);
    basicGroup.body.appendChild(basicActions);
    body.appendChild(basicGroup.root);

    const panelGroup = createGroup('Panel Settings');
    const panelActions = document.createElement('div');
    panelActions.className = 'net-actions';
    panelActions.classList.add('full-span');
    const lockBtn = document.createElement('button');
    lockBtn.className = 'action-btn';
    lockBtn.textContent = state.panelLocked ? 'Unlock Panel' : 'Lock Panel';
    lockBtn.addEventListener('click', () => {
      state.panelLocked = !state.panelLocked;
      applyLockUi();
      persistLayout();
      renderTab();
    });
    const resetLayoutBtn = document.createElement('button');
    resetLayoutBtn.className = 'action-btn';
    resetLayoutBtn.textContent = 'Reset Panel Layout';
    resetLayoutBtn.addEventListener('click', () => {
      const defaults = buildDefaultLayout();
      state.activeTab = defaults.activeTab;
      state.panelLocked = false;
      state.autoLayoutEnabled = defaults.autoLayoutEnabled ?? true;
      state.fixedColumns = defaults.fixedColumns ?? 2;
      state.sectionCollapseOverrides = defaults.sectionCollapseOverrides ?? {};
      applyLockUi();
      applyLayout(defaults);
      renderTab();
      postStatus('Panel layout reset');
    });
    panelActions.append(lockBtn, resetLayoutBtn);
    panelGroup.body.appendChild(panelActions);

    const layoutActions = document.createElement('div');
    layoutActions.className = 'net-actions';
    layoutActions.classList.add('full-span');
    const autoLayoutBtn = document.createElement('button');
    autoLayoutBtn.className = 'action-btn';
    autoLayoutBtn.textContent = `Auto layout: ${state.autoLayoutEnabled ? 'ON' : 'OFF'}`;
    autoLayoutBtn.addEventListener('click', () => {
      state.autoLayoutEnabled = !state.autoLayoutEnabled;
      persistLayout();
      applyLayout({}, false);
      renderTab();
    });
    const colsBtn = document.createElement('button');
    colsBtn.className = 'action-btn';
    colsBtn.textContent = `Columns: ${state.fixedColumns}`;
    colsBtn.disabled = state.autoLayoutEnabled;
    colsBtn.title = state.autoLayoutEnabled ? 'Disable auto layout to set fixed columns' : 'Cycle fixed columns';
    colsBtn.addEventListener('click', () => {
      if (state.autoLayoutEnabled) return;
      state.fixedColumns = state.fixedColumns === 3 ? 1 : (state.fixedColumns + 1) as 1 | 2 | 3;
      persistLayout();
      applyLayout({}, false);
      renderTab();
    });
    layoutActions.append(autoLayoutBtn, colsBtn);
    panelGroup.body.appendChild(layoutActions);

    const modeInfo = document.createElement('div');
    modeInfo.className = 'subtle';
    modeInfo.classList.add('full-span');
    modeInfo.textContent = `Layout: ${layoutMode} | Height: ${heightMode} | Cols: ${getActiveColumns()}`;
    panelGroup.body.appendChild(modeInfo);
    body.appendChild(panelGroup.root);

    const pinnedMetas = state.pinnedKeys
      .map((k) => getMetaByKey(k as keyof MovementTuning))
      .filter((m): m is TuningParamMeta => !!m);
    if (pinnedMetas.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No favourites pinned yet. Pin parameters in Movement to see them here.';
      body.appendChild(empty);
    } else {
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
  }

  function renderMovementTab() {
    const tuning = getTuning();
    const grid = createSectionGrid();
    body.appendChild(grid);

    const stateSectionMeta: SectionMeta = {
      id: 'movement_state',
      title: 'State',
      priority: 100,
      tone: 'core',
      modeRules: {
        NARROW: { order: 0, columnSpan: 1 },
        MEDIUM: { order: 0, columnSpan: 2 },
        WIDE: { order: 0, columnSpan: 3 }
      }
    };
    const stateGroup = createSectionCard('Movement', stateSectionMeta);
    movementSummaryEl = document.createElement('div');
    movementSummaryEl.className = 'subtle';
    movementSummaryEl.style.marginBottom = '6px';
    movementSummaryEl.classList.add('full-span');
    stateGroup.body.appendChild(movementSummaryEl);

    const stateActions = document.createElement('div');
    stateActions.className = 'net-actions';
    stateActions.classList.add('full-span');
    const resetDefaultsBtn = document.createElement('button');
    resetDefaultsBtn.className = 'action-btn';
    resetDefaultsBtn.textContent = 'Reset to Defaults';
    resetDefaultsBtn.addEventListener('click', () => {
      resetTuning();
      for (const refresh of refreshers) refresh();
      refreshStatusLine();
      postStatus('Movement reset to defaults');
    });
    stateActions.appendChild(resetDefaultsBtn);
    stateGroup.body.appendChild(stateActions);
    grid.appendChild(stateGroup.root);

    const movementMetas = PARAM_REGISTRY.filter((m) => m.category === 'Movement');
    const movementGroupPriority: Record<string, number> = {
      Core: 90,
      'Two-Regime': 85,
      'Input / Controls': 83,
      Movement: 82,
      'Arc Movement': 80,
      'Aim / Stick': 72,
      'Assist / Start': 75,
      'Grip & Turn': 70,
      Aim: 65,
      Crosshair: 60,
      Brake: 55,
      'Aim Debug': 20
    };
    const movementGroupTone: Record<string, SectionMeta['tone']> = {
      Core: 'core',
      'Two-Regime': 'control',
      'Input / Controls': 'control',
      Movement: 'control',
      'Arc Movement': 'control',
      'Aim / Stick': 'aim',
      'Assist / Start': 'control',
      'Grip & Turn': 'control',
      Aim: 'aim',
      Crosshair: 'aim',
      Brake: 'control',
      'Aim Debug': 'debug'
    };
    const reduced = movementMetas
      .filter((m) => isMovementContextualRecommended(m, tuning))
      .sort((a, b) => (movementGroupPriority[b.group] ?? 0) - (movementGroupPriority[a.group] ?? 0) || a.label.localeCompare(b.label));
    const reducedGroups = new Map<string, TuningParamMeta[]>();
    for (const meta of reduced) {
      const arr = reducedGroups.get(meta.group) ?? [];
      arr.push(meta);
      reducedGroups.set(meta.group, arr);
    }
    for (const [groupName, metas] of reducedGroups) {
      const section = createSectionCard('Movement', {
        id: `movement_${groupName.toLowerCase().replace(/\s+/g, '_')}`,
        title: groupName,
        priority: movementGroupPriority[groupName] ?? 50,
        tone: movementGroupTone[groupName] ?? 'control',
        collapsible: groupName.toLowerCase().includes('debug'),
        defaultCollapsed: groupName.toLowerCase().includes('debug'),
        modeRules: groupName.toLowerCase().includes('debug')
          ? {
              NARROW: { order: 980, collapsed: true },
              MEDIUM: { order: 980, columnSpan: 2, collapsed: true },
              WIDE: { order: 980, collapsed: true }
            }
          : undefined
      }, { resetMetas: metas });
      if (!section.collapsed) {
        for (const meta of metas) section.body.appendChild(createParamRow(meta));
      }
      grid.appendChild(section.root);
    }

    const reducedKeys = new Set(reduced.map((m) => String(m.key)));
    const advancedMetas = movementMetas.filter((m) => !reducedKeys.has(String(m.key)));
    const advSectionMeta: SectionMeta = {
      id: 'movement_advanced',
      title: 'Advanced',
      priority: 5,
      tone: 'advanced',
      collapsible: true,
      defaultCollapsed: true,
      modeRules: {
        NARROW: { order: 999, columnSpan: 1, collapsed: true },
        MEDIUM: { order: 999, columnSpan: 2, collapsed: heightMode === 'SHORT' },
        WIDE: { order: 999, columnSpan: 3, collapsed: heightMode === 'SHORT' }
      }
    };
    const advancedSection = createSectionCard('Movement', advSectionMeta, { resetMetas: advancedMetas });
    if (!advancedSection.collapsed) {
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
        advancedSection.body.appendChild(group.root);
      }
    }
    grid.appendChild(advancedSection.root);
  }

  function renderRotationTab() {
    const grid = createSectionGrid();
    body.appendChild(grid);
    const runtimeSection = createSectionCard('Rotation', {
      id: 'rotation_stick_runtime',
      title: 'Stick Runtime',
      priority: 100,
      tone: 'debug',
      modeRules: {
        NARROW: { order: 0, columnSpan: 1 },
        MEDIUM: { order: 0, columnSpan: 2 },
        WIDE: { order: 0, columnSpan: 3 }
      }
    });
    const runtimeText = document.createElement('div');
    runtimeText.className = 'subtle';
    runtimeText.classList.add('full-span');
    runtimeText.style.whiteSpace = 'pre-line';
    runtimeSection.body.appendChild(runtimeText);
    refreshers.push(() => {
      const t = (lastTelemetry || {}) as Record<string, any>;
      const mode = String(t.stickMode ?? 'APPROACH');
      const stickDeltaDeg = Number(t.stickDeltaDeg ?? 0);
      const stickAngVelDeg = Number(t.stickAngVelDeg ?? 0);
      const stickAngVelClamped = Boolean(t.stickAngVelClamped);
      const targetSlewActive = Boolean(t.targetSlewActive);
      const aimInputRateLimited = Boolean(t.aimInputRateLimited ?? lastAimInputRateLimited);
      runtimeText.textContent = [
        `mode: ${mode}`,
        `stickDeltaDeg: ${stickDeltaDeg.toFixed(1)}`,
        `stickAngVelDeg: ${stickAngVelDeg.toFixed(1)}`,
        `stickAngVelClamped: ${stickAngVelClamped ? 'true' : 'false'}`,
        `targetSlewActive: ${targetSlewActive ? 'true' : 'false'}`,
        `aimInputRateLimited: ${aimInputRateLimited ? 'true' : 'false'}`
      ].join('\n');
    });
    grid.appendChild(runtimeSection.root);

    const rotationMetas = PARAM_REGISTRY
      .filter((m) => m.category === 'Rotation')
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    const byGroup = new Map<string, TuningParamMeta[]>();
    for (const meta of rotationMetas) {
      const arr = byGroup.get(meta.group) ?? [];
      arr.push(meta);
      byGroup.set(meta.group, arr);
    }
    const sectionMetaByGroup = new Map<string, SectionMeta>([
      ['Body', {
        id: 'rotation_body',
        title: 'Body',
        priority: 90,
        tone: 'control',
        modeRules: { NARROW: { order: 1 }, MEDIUM: { order: 1 }, WIDE: { order: 1 } }
      }],
      ['Body / Edge-Carve', {
        id: 'rotation_body_edge_carve',
        title: 'Body / Edge-Carve',
        priority: 86,
        tone: 'control',
        modeRules: { NARROW: { order: 2 }, MEDIUM: { order: 2 }, WIDE: { order: 2 } }
      }],
      ['Body / Visual Lean', {
        id: 'rotation_body_visual_lean',
        title: 'Body / Visual Lean',
        priority: 84,
        tone: 'control',
        modeRules: { NARROW: { order: 3 }, MEDIUM: { order: 3 }, WIDE: { order: 3 } }
      }],
      ['Aim Input Filter', {
        id: 'rotation_aim',
        title: 'Aim Input Filter',
        priority: 80,
        tone: 'aim',
        modeRules: { NARROW: { order: 4 }, MEDIUM: { order: 4 }, WIDE: { order: 4 } }
      }],
      ['Stick Clamp', {
        id: 'rotation_stick_clamp',
        title: 'Stick Clamp',
        priority: 70,
        tone: 'aim',
        modeRules: { NARROW: { order: 5 }, MEDIUM: { order: 5 }, WIDE: { order: 5 } }
      }],
      ['Stick Trick Boost', {
        id: 'rotation_stick_trick_boost',
        title: 'Stick Trick Boost',
        priority: 65,
        tone: 'aim',
        modeRules: { NARROW: { order: 6 }, MEDIUM: { order: 6 }, WIDE: { order: 6 } }
      }],
      ['Aim Pivot (Stick Base)', {
        id: 'rotation_aim_pivot',
        title: 'Aim Pivot (Stick Base)',
        priority: 60,
        tone: 'aim',
        modeRules: { NARROW: { order: 7 }, MEDIUM: { order: 7 }, WIDE: { order: 7 } }
      }],
      ['Debug', {
        id: 'rotation_debug',
        title: 'Debug',
        priority: 20,
        tone: 'debug',
        collapsible: true,
        defaultCollapsed: true,
        modeRules: {
          NARROW: { order: 90, collapsed: true },
          MEDIUM: { order: 90, columnSpan: 2, collapsed: true },
          WIDE: { order: 90, columnSpan: 3, collapsed: true }
        }
      }]
    ]);
    for (const [groupName, metas] of byGroup) {
      const baseMetas = metas.filter((m) => !m.advanced);
      const advancedMetas = metas.filter((m) => !!m.advanced);
      const visibleMetas = baseMetas.length > 0 ? baseMetas : metas;
      const sectionMeta = sectionMetaByGroup.get(groupName) ?? {
        id: `rotation_${groupName.toLowerCase().replace(/\s+/g, '_')}`,
        title: groupName,
        priority: 10,
        tone: groupName.toLowerCase().includes('debug') ? 'debug' : 'control'
      };
      const section = createSectionCard('Rotation', sectionMeta, { resetMetas: visibleMetas });
      if (!section.collapsed) {
        for (const meta of visibleMetas) section.body.appendChild(createParamRow(meta));
      }
      grid.appendChild(section.root);

      if (advancedMetas.length > 0 && baseMetas.length > 0) {
        const advancedSection = createSectionCard('Rotation', {
          id: `rotation_${groupName.toLowerCase().replace(/\s+/g, '_')}_advanced`,
          title: `${groupName} Advanced`,
          priority: (sectionMeta.priority ?? 10) - 1,
          tone: 'advanced',
          collapsible: true,
          defaultCollapsed: true
        }, { resetMetas: advancedMetas });
        if (!advancedSection.collapsed) {
          for (const meta of advancedMetas) advancedSection.body.appendChild(createParamRow(meta));
        }
        grid.appendChild(advancedSection.root);
      }
    }
    if (rotationMetas.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No rotation parameters registered.';
      body.appendChild(empty);
    }
  }

  function renderPuckTab() {
    const grid = createSectionGrid();
    body.appendChild(grid);

    const stateSection = createSectionCard('Puck', {
      id: 'puck_state',
      title: 'State',
      priority: 100,
      tone: 'core',
      modeRules: {
        NARROW: { order: 0, columnSpan: 1 },
        MEDIUM: { order: 0, columnSpan: 2 },
        WIDE: { order: 0, columnSpan: 3 }
      }
    });
    const resetDefaultsBtn = document.createElement('button');
    resetDefaultsBtn.className = 'action-btn';
    resetDefaultsBtn.classList.add('full-span');
    resetDefaultsBtn.textContent = 'Reset to Puck Defaults';
    resetDefaultsBtn.addEventListener('click', () => {
      puckStickTuningStore.resetToDefaults();
      for (const refresh of refreshers) refresh();
      refreshStatusLine();
      postStatus('Puck/Stick reset to defaults');
    });
    stateSection.body.appendChild(resetDefaultsBtn);
    grid.appendChild(stateSection.root);

    const puckMetas = PARAM_REGISTRY
      .filter((m) => m.category === 'Puck')
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    const byGroup = new Map<string, TuningParamMeta[]>();
    for (const meta of puckMetas) {
      const arr = byGroup.get(meta.group) ?? [];
      arr.push(meta);
      byGroup.set(meta.group, arr);
    }

    const sectionMetaByGroup = new Map<string, SectionMeta>([
      ['Puk - fyzika', {
        id: 'puck_core',
        title: 'Puk - fyzika',
        priority: 90,
        tone: 'core',
        modeRules: { NARROW: { order: 1 }, MEDIUM: { order: 1 }, WIDE: { order: 1 } }
      }],
      ['Vedeni puku', {
        id: 'puck_control',
        title: 'Vedeni puku',
        priority: 80,
        tone: 'control',
        modeRules: { NARROW: { order: 2 }, MEDIUM: { order: 2 }, WIDE: { order: 2 } }
      }],
      ['Strela', {
        id: 'puck_shot',
        title: 'Strela',
        priority: 70,
        tone: 'shot',
        modeRules: { NARROW: { order: 3 }, MEDIUM: { order: 3 }, WIDE: { order: 3 } }
      }],
      ['Hokejka', {
        id: 'puck_stick',
        title: 'Hokejka',
        priority: 60,
        tone: 'control',
        collapsible: true,
        defaultCollapsed: false,
        modeRules: {
          NARROW: { order: 4, collapsed: heightMode === 'SHORT' },
          MEDIUM: { order: 4, collapsed: false },
          WIDE: { order: 4, columnSpan: 2, collapsed: false }
        }
      }],
      ['Debug puku', {
        id: 'puck_debug',
        title: 'Debug puku',
        priority: 20,
        tone: 'debug',
        collapsible: true,
        defaultCollapsed: true,
        modeRules: {
          NARROW: { order: 90, collapsed: true },
          MEDIUM: { order: 90, columnSpan: 2, collapsed: true },
          WIDE: { order: 90, columnSpan: 3, collapsed: true }
        }
      }],
      ['Debug hokejky', {
        id: 'stick_debug',
        title: 'Debug hokejky',
        priority: 15,
        tone: 'debug',
        collapsible: true,
        defaultCollapsed: true,
        modeRules: {
          NARROW: { order: 91, collapsed: true },
          MEDIUM: { order: 91, columnSpan: 2, collapsed: true },
          WIDE: { order: 91, columnSpan: 3, collapsed: true }
        }
      }]
    ]);

    for (const [groupName, metas] of byGroup) {
      const sectionMeta = sectionMetaByGroup.get(groupName) ?? {
        id: `puck_${groupName.toLowerCase().replace(/\s+/g, '_')}`,
        title: groupName,
        priority: 10,
        tone: groupName.toLowerCase().includes('debug') ? 'debug' : 'control',
        collapsible: true,
        defaultCollapsed: layoutMode === 'NARROW' && heightMode === 'SHORT',
        modeRules: {
          NARROW: { order: 95, collapsed: layoutMode === 'NARROW' && heightMode === 'SHORT' },
          MEDIUM: { order: 95, columnSpan: 2 },
          WIDE: { order: 95 }
        }
      };
      const section = createSectionCard('Puck', sectionMeta, { resetMetas: metas });
      if (!section.collapsed) {
        for (const meta of metas) section.body.appendChild(createParamRow(meta));
      }
      grid.appendChild(section.root);
    }
  }

  function renderNetDebugTab() {
    const group = createSectionCard('NetDebug', {
      id: 'net_actions',
      title: 'Actions',
      priority: 100,
      tone: 'debug',
      modeRules: {
        NARROW: { order: -100, columnSpan: 1 },
        MEDIUM: { order: -100, columnSpan: 2 },
        WIDE: { order: -100, columnSpan: 3 }
      }
    });
    const actions = document.createElement('div');
    actions.className = 'net-actions';
    actions.classList.add('full-span');

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
    status.classList.add('full-span');
    group.body.appendChild(status);
    statusLineEl = status;

    applyLocalBtn.addEventListener('click', () => postStatus('Applied locally'));
    applyServerBtn.addEventListener('click', () => {
      if (!wsClient || !allowTuningSync || !wsClient.isConnected()) return postStatus('Server sync unavailable');
      wsClient.send({ type: 'debug:setMovementTuning', config: JSON.parse(exportTuning()) });
      postStatus('Sent to server');
    });
    saveBtn.addEventListener('click', handleSavePreset);
    saveAsBtn.addEventListener('click', handleSaveAsPreset);
    resetBtn.addEventListener('click', handleResetRuntime);
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
    persistLayout();
    for (const [tab, btn] of tabButtons) btn.classList.toggle('active', tab === state.activeTab);
    if (state.activeTab === 'Home') renderHomeTab();
    else if (state.activeTab === 'Movement') renderMovementTab();
    else if (state.activeTab === 'Rotation') renderRotationTab();
    else if (state.activeTab === 'Puck') renderPuckTab();
    else if (state.activeTab === 'NetDebug') renderNetDebugTab();
    else renderPlaceholder(state.activeTab);
    for (const refresh of refreshers) refresh();
    refreshStatusLine();
  }

  presetSelect.addEventListener('change', () => {
    presetState = applySelection(presetState, presetSelect.value);
    savePresetState(presetState);
    const selected = selectedPreset();
    if (selected) replaceTuning(selected.tuning);
    refreshPresetSelect();
    renderTab();
    postStatus(`Preset applied: ${selected?.name ?? 'n/a'}`);
  });

  headerSaveBtn.addEventListener('click', handleSavePreset);
  headerSaveAsBtn.addEventListener('click', handleSaveAsPreset);
  headerResetBtn.addEventListener('click', handleResetRuntime);
  headerCloseBtn.addEventListener('click', () => {
    visible = false;
    root.style.display = 'none';
  });

  refreshPresetSelect();
  renderTab();

  return {
    root,
    setVisible(next: boolean) {
      visible = next;
      root.style.display = next ? 'flex' : 'none';
      if (next) applyLayout({}, true);
      else setDragLock(false);
    },
    isVisible() {
      return visible;
    },
    onWelcome(msg: WelcomeMsg) {
      allowTuningSync = !!msg.allowTuningSync;
      if (state.activeTab === 'NetDebug') renderTab();
    },
    destroy() {
      stopDrag();
      stopResize();
      unsubscribeTuning();
      window.clearInterval(liveRefreshTimer);
      window.removeEventListener('resize', onWindowResize);
      setDragLock(false);
      root.remove();
    }
  };
}
