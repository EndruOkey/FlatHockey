// Vloží aktuální public/js/entities/skin.js (kresba hry) do scripts/visual_variants.html mezi značky /*SKIN-BEGIN*/ … /*SKIN-END*/,
// aby náhled kreslil PŘESNĚ stejným kódem jako hra a fungoval i bez serveru (file://).   Spuštění: node scripts/visual_build.mjs
import fs from 'fs';
const root = new URL('..', import.meta.url);
const src = fs.readFileSync(new URL('public/js/entities/skin.js', root), 'utf8');
const names = [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map(m => m[1]);
const body = src.replace(/^export /gm, '');
const block = `/*SKIN-BEGIN*/\nconst SKIN = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();\n/*SKIN-END*/`;
const p = new URL('scripts/visual_variants.html', root);
const html = fs.readFileSync(p, 'utf8');
const re = /\/\*SKIN-BEGIN\*\/[\s\S]*?\/\*SKIN-END\*\//;
if (!re.test(html)) throw new Error('chybí značky /*SKIN-BEGIN*/ /*SKIN-END*/');
fs.writeFileSync(p, html.replace(re, () => block));
console.log('skin.js vložen:', names.join(', '));
