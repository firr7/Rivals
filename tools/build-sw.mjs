#!/usr/bin/env node
// Rigenera l'elenco dei file da mettere in cache e la VERSION in sw.js.
// Eseguilo ogni volta che modifichi un file del gioco:   node tools/build-sw.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'tests', 'tools']);
const SKIP_FILES = new Set(['sw.js', 'README.md', '.nojekyll', '.gitignore', 'LICENSE']);
const SKIP_PREFIX = ['icons/screenshot'];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    const st = fs.statSync(full);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full, out); continue; }
    if (SKIP_FILES.has(name) || SKIP_PREFIX.some((p) => rel.startsWith(p))) continue;
    out.push(rel);
  }
  return out;
}

const files = walk(root).sort();
const hash = crypto.createHash('sha256');
for (const f of files) { hash.update(f); hash.update(fs.readFileSync(path.join(root, f))); }
const version = 'rr-' + hash.digest('hex').slice(0, 10);

const list = ['./', ...files.map((f) => './' + f)];
const swPath = path.join(root, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/\/\/ <build:version>[\s\S]*?\/\/ <\/build:version>/, `// <build:version>\nconst VERSION = '${version}';\n// </build:version>`);
sw = sw.replace(/\/\/ <build:precache>[\s\S]*?\/\/ <\/build:precache>/,
  `// <build:precache>\nconst PRECACHE = [\n${list.map((f) => `  '${f}',`).join('\n')}\n];\n// </build:precache>`);
fs.writeFileSync(swPath, sw);
const total = files.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
console.log(`sw.js aggiornato: ${version} · ${files.length} file · ${(total / 1024).toFixed(0)} KB`);
