const { createRequire } = require('module');

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch {
    const cwdRequire = createRequire(process.cwd() + '/package.json');
    return cwdRequire('playwright');
  }
}

const { chromium } = resolvePlaywright();

async function main() {
  const durationMs = Number(process.env.FH_SESSION_MS ?? 10 * 60 * 1000);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleEvents = [];
  const pageErrors = [];
  let disconnectEvent = null;

  page.on('console', (msg) => {
    const text = msg.text();
    const line = `[BROWSER_CONSOLE] ${new Date().toISOString()} ${msg.type()} ${text}`;
    console.log(line);
    consoleEvents.push(line);
    if (text.includes('[WS_CLIENT] CLOSE') || text.includes('Offline (retrying...)') || text.includes('protocol mismatch')) {
      disconnectEvent = line;
    }
  });

  page.on('pageerror', (err) => {
    const line = `[PAGE_ERROR] ${new Date().toISOString()} ${err.stack || err.message}`;
    console.log(line);
    pageErrors.push(line);
  });

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(1500);

  const start = Date.now();
  let seq = 0;
  let lastMinute = -1;
  while (Date.now() - start < durationMs) {
    const elapsed = Date.now() - start;
    const minute = Math.floor(elapsed / 60000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      console.log(`[SESSION_PROGRESS] minute=${minute}`);
    }

    const centerX = 800;
    const centerY = 450;
    const angle = (elapsed / 1000) * 0.9;
    const radius = 180 + 60 * Math.sin(elapsed / 1800);
    const mouseX = Math.round(centerX + Math.cos(angle) * radius);
    const mouseY = Math.round(centerY + Math.sin(angle) * radius * 0.6);
    await page.mouse.move(mouseX, mouseY, { steps: 6 });

    const phase = seq % 14;
    if (phase === 0 || phase === 1) {
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(280);
      await page.keyboard.up('KeyD');
      await page.keyboard.up('KeyW');
    } else if (phase === 2) {
      await page.keyboard.down('KeyA');
      await page.waitForTimeout(220);
      await page.keyboard.up('KeyA');
    } else if (phase === 3) {
      await page.mouse.down({ button: 'left' });
      await page.waitForTimeout(80);
      await page.mouse.up({ button: 'left' });
    } else if (phase === 4) {
      await page.mouse.down({ button: 'right' });
      await page.waitForTimeout(70);
      await page.mouse.up({ button: 'right' });
    } else if (phase === 5) {
      await page.mouse.down({ button: 'middle' });
      await page.waitForTimeout(60);
      await page.mouse.up({ button: 'middle' });
    } else if (phase === 6) {
      await page.keyboard.press('KeyE');
    } else if (phase === 7) {
      await page.keyboard.press('Space');
    } else if (phase === 8 || phase === 9) {
      await page.keyboard.down('KeyS');
      await page.keyboard.down('KeyA');
      await page.waitForTimeout(240);
      await page.keyboard.up('KeyA');
      await page.keyboard.up('KeyS');
    } else if (phase === 10) {
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(260);
      await page.keyboard.up('KeyW');
    } else if (phase === 11) {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(220);
      await page.keyboard.up('KeyD');
    } else if (phase === 12) {
      await page.mouse.down({ button: 'left' });
      await page.waitForTimeout(60);
      await page.mouse.up({ button: 'left' });
      await page.mouse.down({ button: 'middle' });
      await page.waitForTimeout(40);
      await page.mouse.up({ button: 'middle' });
    } else {
      await page.waitForTimeout(220);
    }

    if (disconnectEvent) {
      break;
    }

    seq += 1;
    await page.waitForTimeout(180);
  }

  console.log(
    '[SESSION_RESULT]',
    JSON.stringify({
      disconnectEvent,
      pageErrorCount: pageErrors.length,
      consoleEventCount: consoleEvents.length,
      ranMs: Date.now() - start
    })
  );

  await browser.close();
}

main().catch((error) => {
  console.error('[SESSION_FATAL]', error?.stack || String(error));
  process.exitCode = 1;
});
