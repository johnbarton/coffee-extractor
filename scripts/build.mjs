import { readFile, readdir, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { normalizeCoffee } from '../shared/coffee.mjs';
import { generateValidator } from './generate-validator.mjs';

const validate = await generateValidator();
const records = [];
const ids = new Set();
for (const file of (await readdir('data/coffees')).filter(f => f.endsWith('.yaml')).sort()) {
  const doc = parseDocument(await readFile(`data/coffees/${file}`, 'utf8'), { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`${file}: ${doc.errors[0].message}`);
  const record = doc.toJS({ maxAliasCount: 0 });
  if (!validate(record)) throw new Error(`${file}: ${JSON.stringify(validate.errors)}`);
  if (file !== `${record.id}.yaml` || ids.has(record.id)) throw new Error(`Invalid or duplicate ID: ${file}`);
  ids.add(record.id);
  records.push(normalizeCoffee(record));
}
records.sort((a, b) => (b.roastDate || '').localeCompare(a.roastDate || '') || a.id.localeCompare(b.id));
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });
// Keep data and app from a single publication together when a deployment changes.
const data = JSON.stringify(records);
const dataName = `coffees.${createHash('sha256').update(data).digest('hex').slice(0, 12)}.json`;
await writeFile(`dist/${dataName}`, data);
let revision = 'local';
try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* local archive */ }
const app = (await readFile('dist/app.js', 'utf8')).replace('__COFFEE_DATA_URL__', `/${dataName}`);
const appName = `app.${createHash('sha256').update(app).digest('hex').slice(0, 12)}.js`;
await writeFile(`dist/${appName}`, app);
await rm('dist/app.js');
const html = (await readFile('dist/index.html', 'utf8')).replace('/app.js', `/${appName}`);
await writeFile('dist/index.html', html);
await writeFile('dist/version.json', JSON.stringify({ revision, builtAt: new Date().toISOString(), count: records.length }));
console.log(`Built ${records.length} validated coffees (${revision}).`);
