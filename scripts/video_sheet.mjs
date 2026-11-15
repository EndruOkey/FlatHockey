// List snímků z videa (WebM z rekordéru F9) přes Chromium — bez ffmpeg. node scripts/video_sheet.mjs <video.webm> <out.png> [počet=24]
import { chromium } from 'playwright'; import { readFileSync, writeFileSync } from 'fs';
const [src, out, nArg] = process.argv.slice(2), N = +(nArg || 24);
const b = await chromium.launch(); const p = await b.newPage();
const b64 = readFileSync(src).toString('base64');
const png = await p.evaluate(async ([b64, N]) => {
  const v = document.createElement('video'); v.muted = true; v.src = 'data:video/webm;base64,' + b64; document.body.appendChild(v);
  await new Promise(r => v.onloadeddata = r);
  if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise(r => v.ontimeupdate = r); v.ontimeupdate = null; }
  const D = v.duration, W = v.videoWidth, H = v.videoHeight, cols = 6, rows = Math.ceil(N / cols), S = 0.6;
  const c = document.createElement('canvas'); c.width = cols * W * S; c.height = rows * H * S; const x = c.getContext('2d');
  for (let i = 0; i < N; i++) { v.currentTime = Math.min(D - 0.01, (i + 0.5) / N * D); await new Promise(r => v.onseeked = r); x.drawImage(v, (i % cols) * W * S, Math.floor(i / cols) * H * S, W * S, H * S); }
  return c.toDataURL('image/png'); }, [b64, N]);
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64')); await b.close(); console.log('ok', out);
