// FH_IP=<ip> vynutí adresu (měření přes Cloudflare dřív, než se rozšíří DNS). Doba odezvy přes JEDNO otevřené spojení (jako hra): 20× /health, medián a max. node scripts/rtt_probe.mjs <url>
import https from 'node:https';
const url = process.argv[2]; const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
const get = () => new Promise((res, rej) => { const t = performance.now(); https.get(url, { agent, ...(process.env.FH_IP ? { lookup: (h, o, cb) => o && o.all ? cb(null, [{ address: process.env.FH_IP, family: 4 }]) : cb(null, process.env.FH_IP, 4) } : {}) }, r => { r.resume(); r.on('end', () => res(performance.now() - t)); }).on('error', rej); });
await get(); const xs = []; for (let i = 0; i < 20; i++) xs.push(await get());
xs.sort((a, b) => a - b); console.log(url, 'medián', Math.round(xs[10]), 'ms | min', Math.round(xs[0]), '| max', Math.round(xs[19])); agent.destroy();
