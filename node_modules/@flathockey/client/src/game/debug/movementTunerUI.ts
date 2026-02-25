import { getTuning, setTuning, resetTuning, exportTuning, importTuning, DEFAULTS } from './movementTuning';

function qs(sel: string, root: Document | HTMLElement = document) { return root.querySelector(sel) as HTMLElement | null; }

function createSlider(labelText: string, key: string, min: number, max: number, step: number) {
  const row = document.createElement('div');
  row.style.margin = '6px 0';

  const label = document.createElement('label');
  label.textContent = labelText;
  label.style.display = 'block';
  label.style.fontSize = '12px';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.style.width = '180px';

  const value = document.createElement('span');
  value.style.marginLeft = '8px';
  value.style.fontFamily = 'monospace';

  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(value);

  function updateFromModel() {
    const t = getTuning() as any;
    const v = t[key];
    input.value = String(v ?? 0);
    value.textContent = String(Math.round(Number(v) * 100) / 100);
  }

  input.addEventListener('input', () => {
    const val = Number(input.value);
    setTuning({ [key]: val } as any);
    value.textContent = String(Math.round(val * 100) / 100);
  });

  return { row, updateFromModel };
}

export function createMovementTuner(wsClient?: any) {
  const tuning = getTuning();
  const root = document.createElement('div');
  root.id = 'movement-tuner';
  root.style.position = 'fixed';
  root.style.right = '12px';
  root.style.top = '12px';
  root.style.background = 'rgba(0,0,0,0.75)';
  root.style.color = 'white';
  root.style.padding = '10px';
  root.style.zIndex = '9999';
  root.style.minWidth = '220px';
  root.style.fontSize = '12px';
  root.style.borderRadius = '6px';

  const title = document.createElement('div');
  title.textContent = 'Movement Tuner (DEV)';
  title.style.fontWeight = '600';
  title.style.marginBottom = '8px';
  root.appendChild(title);

  // sliders
  const sliders: Array<() => void> = [];
  const sAccel = createSlider('Accel', 'accel', 100, 5000, 10);
  const sMax = createSlider('Max Speed', 'maxSpeed', 50, 2000, 1);
  const sDrag = createSlider('Drag', 'drag', 0, 10, 0.01);
  const sTurnLow = createSlider('Turn LowSpeed', 'turnLowSpeed', 0, 40, 0.1);
  const sTurnHigh = createSlider('Turn HighSpeed', 'turnHighSpeed', 0, 40, 0.1);
  const sBrake = createSlider('Brake Drag', 'brakeDrag', 0, 40, 0.1);

  [sAccel, sMax, sDrag, sTurnLow, sTurnHigh, sBrake].forEach(s => { root.appendChild(s.row); sliders.push(s.updateFromModel); });

  const diagRow = document.createElement('div');
  diagRow.style.margin = '6px 0';
  const diagLabel = document.createElement('label');
  diagLabel.textContent = 'Diagonal Normalize';
  const diagInput = document.createElement('input');
  diagInput.type = 'checkbox';
  diagInput.style.marginLeft = '8px';
  diagRow.appendChild(diagLabel);
  diagRow.appendChild(diagInput);
  diagInput.addEventListener('change', () => setTuning({ diagonalNormalize: diagInput.checked }));
  root.appendChild(diagRow);

  // presets
  const presetsRow = document.createElement('div');
  presetsRow.style.margin = '8px 0';
  const presetA = document.createElement('button'); presetA.textContent = 'Preset A (Snappy)';
  const presetB = document.createElement('button'); presetB.textContent = 'Preset B (Hybrid)';
  const presetC = document.createElement('button'); presetC.textContent = 'Preset C (Arcade)';
  [presetA, presetB, presetC].forEach(b => { b.style.marginRight = '6px'; b.style.fontSize='11px'; });
  presetsRow.appendChild(presetA); presetsRow.appendChild(presetB); presetsRow.appendChild(presetC);
  root.appendChild(presetsRow);

  presetA.addEventListener('click', () => {
    setTuning({ maxSpeed: 560, accel: 2600, drag: 1.2, brakeDrag: 12, turnLowSpeed: 16, turnHighSpeed: 5.0 });
    sliders.forEach(f => f()); diagInput.checked = getTuning().diagonalNormalize;
  });
  presetB.addEventListener('click', () => {
    setTuning({ maxSpeed: DEFAULTS.maxSpeed, accel: DEFAULTS.accel, drag: DEFAULTS.drag, brakeDrag: DEFAULTS.brakeDrag, turnLowSpeed: DEFAULTS.turnLowSpeed, turnHighSpeed: DEFAULTS.turnHighSpeed });
    sliders.forEach(f => f()); diagInput.checked = getTuning().diagonalNormalize;
  });
  presetC.addEventListener('click', () => {
    setTuning({ maxSpeed: 720, accel: 3000, drag: 0.8, brakeDrag: 6, turnLowSpeed: 20, turnHighSpeed: 3.0 });
    sliders.forEach(f => f()); diagInput.checked = getTuning().diagonalNormalize;
  });

  // tools
  const toolsRow = document.createElement('div');
  toolsRow.style.marginTop = '8px';
  const resetBtn = document.createElement('button'); resetBtn.textContent = 'Reset';
  const copyBtn = document.createElement('button'); copyBtn.textContent = 'Copy JSON';
  const logBtn = document.createElement('button'); logBtn.textContent = 'Log JSON';
  const clearBtn = document.createElement('button'); clearBtn.textContent = 'Clear Saved';
  [resetBtn, copyBtn, logBtn, clearBtn].forEach(b => { b.style.marginRight = '6px'; b.style.fontSize='11px'; });
  toolsRow.appendChild(resetBtn); toolsRow.appendChild(copyBtn); toolsRow.appendChild(logBtn); toolsRow.appendChild(clearBtn);
  root.appendChild(toolsRow);

  resetBtn.addEventListener('click', () => { resetTuning(); sliders.forEach(f => f()); diagInput.checked = getTuning().diagonalNormalize; });
  copyBtn.addEventListener('click', async () => { await navigator.clipboard.writeText(exportTuning()); });
  logBtn.addEventListener('click', () => console.log(exportTuning()));
  clearBtn.addEventListener('click', () => { localStorage.removeItem('movementTuning_v1'); resetTuning(); sliders.forEach(f => f()); diagInput.checked = getTuning().diagonalNormalize; });

  // sync to server (dev-only)
  const syncRow = document.createElement('div');
  syncRow.style.marginTop = '8px';
  const syncLabel = document.createElement('label'); syncLabel.textContent = 'Sync to server (dev only)';
  const syncChk = document.createElement('input'); syncChk.type = 'checkbox'; syncChk.style.marginLeft='8px';
  syncRow.appendChild(syncLabel); syncRow.appendChild(syncChk);
  root.appendChild(syncRow);

  // update UI from model
  function refreshAll() {
    const t = getTuning() as any;
    (sAccel.row.querySelector('input') as HTMLInputElement).value = String(t.accel);
    (sMax.row.querySelector('input') as HTMLInputElement).value = String(t.maxSpeed);
    (sDrag.row.querySelector('input') as HTMLInputElement).value = String(t.drag);
    (sTurnLow.row.querySelector('input') as HTMLInputElement).value = String(t.turnLowSpeed);
    (sTurnHigh.row.querySelector('input') as HTMLInputElement).value = String(t.turnHighSpeed);
    (sBrake.row.querySelector('input') as HTMLInputElement).value = String(t.brakeDrag);
    Array.from(root.querySelectorAll('input[type=range]')).forEach(i => { const span = i.nextSibling as HTMLElement; if (span) span.textContent = i.value; });
    diagInput.checked = t.diagonalNormalize;
  }

  // send tuning updates when toggled
  const origSet = setTuning;
  // subscribe: simple polling to apply current tuning UI values
  setInterval(() => {
    if (syncChk.checked && wsClient && wsClient.send) {
      try { wsClient.send({ type: 'debug:setMovementTuning', tuning: JSON.parse(exportTuning()) }); } catch {}
    }
  }, 1000);

  refreshAll();
  document.body.appendChild(root);

  return { root, refreshAll };
}
