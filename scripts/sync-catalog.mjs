import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { validateRecord } from '../src/lib/catalog.mjs';
const base = process.env.SITE_URL || 'https://rom.creepypaste.rs';
const response = await fetch(new URL('/dumps/catalog.json', base));
if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
const records = (await response.json()).map(validateRecord);
if (new Set(records.map(r=>r.id)).size !== records.length || new Set(records.map(r=>r.sequence)).size !== records.length) throw new Error('Duplicate ids/sequences');
await mkdir('catalog', {recursive:true});
for (const record of records) {
  const file = `catalog/${record.id}.json`;
  let previous; try { previous = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (previous && (previous.dump.sha256 !== record.dump.sha256 || previous.dump.originalFilename !== record.dump.originalFilename)) throw new Error(`Original file changed: ${record.id}`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
}
console.log(`Synced ${records.length} public records. Local unimported records retained; server assigns their final sequence.`);
