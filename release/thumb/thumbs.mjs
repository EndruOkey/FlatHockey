// Náhledy hry (covery) pro itch.io a CrazyGames: skutečná simulace (seedovaná náhoda, pevný scénář)
// vykreslená herním kódem v plném rozlišení + název. Stejný běh = stejné obrázky.
// Spuštění: node release/thumb/thumbs.mjs [směr]   → release/thumb/out/<směr>-<šířka>x<výška>.png + sheet-*.png
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT  = join(ROOT, 'release', 'thumb', 'out');
const PORT = +process.env.PORT || 4130;
const BASE = `http://localhost:${PORT}`;
mkdirSync(OUT, { recursive: true });

const SIZES = [[1920, 1080], [800, 1200], [1080, 1620], [800, 800], [630, 500]];
const SNAP_AT = 106, SHOOT_AT = 100;   // tick snímku: puk 6 ticků po výstřelu (ve vzduchu)

// Směry: zoom = kolik herních px na výšku záběru (menší = blíž), rot = natočení kamery (°)
const DIRECTIONS = {
  ice:   { zoom: 160, rot: -14, title: 'ice' },     // A: název namalovaný v ledu pod hráči
  close: { zoom: 120, rot: -8,  title: 'bottom' },  // B: detail střely, název dole na tmavém přechodu
  // C „noční aréna“ (zoom 300, světlo na akci) vyřazen: při 200 px mají hráči ~5 px, název překrýval hru
};

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmpdir(), `fh-thumb-${PORT}.db`) }, stdio: 'pipe',
});
await new Promise((res, rej) => {
  server.stdout.on('data', d => String(d).includes('listening') && res());
  server.on('exit', c => rej(new Error('server exit ' + c)));
});

const only = process.argv[2];
const browser = await chromium.launch();
try {
  for (const [name, dir] of Object.entries(DIRECTIONS)) {
    if (only && only !== name) continue;
    for (const [W, H] of SIZES) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      await page.goto(BASE + '/api/season');                 // stejný origin → moduly hry jdou importovat
      await page.setContent(`
        <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,900&display=block" rel="stylesheet">
        <style>html,body{margin:0;background:#0f1420;overflow:hidden}canvas{display:block}</style>
        <canvas id=c width=${W} height=${H}></canvas>`);
      await page.evaluate(() => document.fonts.load('italic 900 80px "Barlow Condensed"'));
      await page.addScriptTag({ type: 'module', content: `
        let a = 1337; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const B = '${BASE}/js/';
        const { Player } = await import(B + 'entities/Player.js');
        const { Puck }   = await import(B + 'entities/Puck.js');
        const { Goalie } = await import(B + 'entities/Goalie.js');
        const { Rink }   = await import(B + 'entities/Rink.js');
        const { World }  = await import(B + 'world.js');
        const { RINK }   = await import(B + 'constants.js');
        const inp = () => ({ dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, aim: 0, aimDist: 100, keys: { Space: false },
          lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false });
        const mk = (id, team, x, y, o) => { const p = new Player(id, team, inp()); Object.assign(p, { x, y, name: id, ...o }); return p; };
        const shooter  = mk('OKEY', 'home', 740, 290, { color: '#3a9fff', num: 17, handed: 1, trail: '#3a9fff' });
        const defender = mk('BOT', 'away', 690, 330, { color: '#ff4455', num: 4 });
        const mate     = mk('ACE', 'home', 760, 140, { color: '#3a9fff', num: 9 });
        const gL = new Goalie('left'), gR = new Goalie('right');
        gL.color = '#3a9fff'; gR.color = '#ff4455';
        const rink = new Rink(), puck = new Puck();
        puck.x = 760; puck.y = 288; puck.trailColor = '#3a9fff';
        const world = new World([rink, mate, defender, shooter, gL, gR, puck]);
        world.authoritative = true;
        const GX = RINK.goalLineRight, GY = RINK.goalY + RINK.goalH / 2;
        for (let t = 0; t < ${SNAP_AT}; t++) {
          const i = shooter.input;
          i.dx = t < 38 ? 1 : 0; i.dy = t < 30 ? -1 : 0;
          i.aim = shooter.hasPuck ? Math.atan2(GY - 14 - shooter.y, GX - shooter.x) : Math.atan2(puck.y - shooter.y, puck.x - shooter.x);
          i.aimDist = shooter.hasPuck ? 140 : 40; shooter.aimDist = i.aimDist; shooter.aimAngle = i.aim;
          defender.input.dx = 1; defender.input.dy = t < 45 ? -1 : 0;   // pronásleduje střelce zezadu
          defender.input.aim = Math.atan2(shooter.y - defender.y, shooter.x - defender.x); defender.aimAngle = defender.input.aim;
          mate.input.dx = 1; mate.input.aim = Math.atan2(puck.y - mate.y, puck.x - mate.x); mate.aimAngle = mate.input.aim;
          if (t >= ${SHOOT_AT} - 40 && t < ${SHOOT_AT} && shooter.hasPuck) shooter.charge = Math.min(0.95, (t - ${SHOOT_AT} + 40) / 40);
          if (t === ${SHOOT_AT} && shooter.hasPuck) { shooter.shoot(puck, shooter.charge); shooter.charge = 0; }
          world.update(1 / 60);
        }

        const dir = ${JSON.stringify(dir)}, W = ${W}, H = ${H};
        const ctx = document.getElementById('c').getContext('2d');
        // Kamera: měřítko podle kratší strany, střed mezi střelcem a brankou, natočení kolem středu plátna
        // Na výšku je šířka úzká → oddálit, ať se střelec i brána vejdou vedle sebe
        const s = Math.min(W, H) / (H > W ? Math.max(dir.zoom, 200) : dir.zoom);
        const fx = (shooter.x * 0.55 + GX * 0.45), fy = (shooter.y * 0.6 + GY * 0.4);
        const cam = { scale: s, ox: -fx * s, oy: -fy * s };
        ctx.fillStyle = '#0f1420'; ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.translate(W / 2, H / 2 + (dir.title === 'bottom' ? -H * 0.08 : dir.title === 'top' ? H * 0.08 : 0));
        const rot = dir.rot * Math.PI / 180;
        ctx.rotate(rot);
        rink.draw(ctx, cam);

        const font = (px) => 'italic 900 ' + px + 'px "Barlow Condensed"';
        if (dir.title === 'ice') {
          // Logo namalované v ledu (jako středové logo kluziště) — pod hráči, mírně „zamrzlé“
          // Velikost: ~80 % šířky záběru; poloha: spodní třetina obrazu, převedená do souřadnic ledu
          ctx.font = font(100);
          // Šikmé logo je širší než text → u užších formátů menší, ať se nic neuřízne
          const px = Math.round(100 * W * (W / H > 1.5 ? 0.8 : 0.7) / ctx.measureText('FLATHOCKEY').width);
          const sx = 0, sy = H * 0.2;                                  // od středu plátna
          ctx.save();
          ctx.translate(sx * Math.cos(-rot) - sy * Math.sin(-rot), sx * Math.sin(-rot) + sy * Math.cos(-rot));
          ctx.rotate(-rot + dir.rot * Math.PI / 180);                  // logo drží šikmou osu střely
          // Barva zamrzlá pod ledem: logo se kreslí do vlastního plátna, tam ho „ojíní“ a poškrábou brusle
          ctx.font = font(px);
          const w1 = ctx.measureText('FLAT').width, w2 = ctx.measureText('HOCKEY').width;
          const pad = px * 0.3, LW = Math.ceil(w1 + w2 + pad * 2), LH = Math.ceil(px * 1.5);
          const L = document.createElement('canvas'); L.width = LW; L.height = LH;
          const l = L.getContext('2d');
          l.filter = 'blur(' + (px * 0.012).toFixed(2) + 'px)';            // barva se rozpila ve vodě
          l.font = font(px); l.textBaseline = 'middle';
          l.fillStyle = '#1b2742'; l.fillText('FLAT', pad, LH / 2);
          l.fillStyle = '#2f7ae8'; l.fillText('HOCKEY', pad + w1, LH / 2);
          l.filter = 'none';
          l.globalCompositeOperation = 'destination-out';
          // Námraza: hrubé skvrny (rozmazaný šum) + jemné zrno ubírají barvu nerovnoměrně
          const noise = (cw, ch, amp) => {
            const n = document.createElement('canvas'); n.width = cw; n.height = ch;
            const nc = n.getContext('2d'), img = nc.createImageData(cw, ch);
            for (let k = 0; k < cw * ch; k++) { img.data[k * 4 + 3] = Math.random() * 255 * amp; }
            nc.putImageData(img, 0, 0); return n;
          };
          l.imageSmoothingEnabled = true;
          l.drawImage(noise(24, 8, 0.32), 0, 0, LW, LH);
          l.drawImage(noise(Math.ceil(LW / 2), Math.ceil(LH / 2), 0.18), 0, 0, LW, LH);
          // Stopy bruslí: dlouhé mírné oblouky, převážně ve směru jízdy, různě silné
          const scratch = (c, n, x0, y0, w, h, lwMax, alpha) => {
            for (let k = 0; k < n; k++) {
              const sxk = x0 + Math.random() * w, syk = y0 + Math.random() * h;
              const len = w * (0.25 + Math.random() * 0.6), ang = (Math.random() - 0.5) * 0.9;
              const ex = sxk + Math.cos(ang) * len, ey = syk + Math.sin(ang) * len;
              const bend = (Math.random() - 0.5) * len * 0.35;
              c.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
              c.lineWidth = lwMax * (0.25 + Math.random() * 0.75); c.lineCap = 'round';
              c.beginPath(); c.moveTo(sxk, syk);
              c.quadraticCurveTo((sxk + ex) / 2 - Math.sin(ang) * bend, (syk + ey) / 2 + Math.cos(ang) * bend, ex, ey);
              c.stroke();
            }
            c.globalAlpha = 1;
          };
          l.strokeStyle = '#000';
          scratch(l, 40, -LW * 0.2, 0, LW * 1.2, LH, px * 0.02, 0.7);
          ctx.globalAlpha = 0.9;
          ctx.drawImage(L, -LW / 2, -LH / 2);
          // Ledový lesk nad logem: světlé škrábance i mimo barvu (led je jedna vrstva)
          ctx.globalAlpha = 1; ctx.strokeStyle = '#f6fbff';
          scratch(ctx, 45, -LW * 0.7, -LH * 1.2, LW * 1.4, LH * 2.4, px * 0.014, 0.55);
          ctx.restore();
        }
        for (const e of world.entities) if (e !== rink) e.draw(ctx, cam);
        ctx.restore();

        if (dir.title === 'top') {
          // Noční aréna: světlo na akci, okraje do herní tmavé
          const g = ctx.createRadialGradient(W / 2, H * 0.58, Math.min(W, H) * 0.18, W / 2, H * 0.58, Math.max(W, H) * 0.75);
          g.addColorStop(0, 'rgba(15,20,32,0)'); g.addColorStop(1, 'rgba(15,20,32,0.92)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        if (dir.title === 'bottom' || dir.title === 'top') {
          const top = dir.title === 'top';
          const px = Math.round(Math.min(W * 0.16, H * 0.2));
          if (!top) {
            const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
            g.addColorStop(0, 'rgba(15,20,32,0)'); g.addColorStop(1, 'rgba(15,20,32,0.95)');
            ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.45);
          }
          ctx.font = font(px); ctx.textBaseline = 'alphabetic';
          const w1 = ctx.measureText('FLAT').width, w2 = ctx.measureText('HOCKEY').width;
          const x0 = (W - w1 - w2) / 2, y = top ? px * 1.05 : H - px * 0.32;
          ctx.fillStyle = '#ffffff'; ctx.fillText('FLAT', x0, y);
          ctx.fillStyle = '#3a9fff'; ctx.fillText('HOCKEY', x0 + w1, y);
        }
        window.__done = true;
      ` });
      await page.waitForFunction(() => window.__done, null, { timeout: 15000 });
      await page.screenshot({ path: join(OUT, `${name}-${W}x${H}.png`) });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
