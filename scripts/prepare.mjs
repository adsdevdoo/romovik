import { mkdir, rm, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadCatalog, verifyAssets, assetPath } from '../src/lib/catalog.mjs';

const records = await loadCatalog();
await verifyAssets(ROOT, records);
// Generated static dumps must not shadow the database-backed /dumps routes.
const generated = path.resolve(ROOT, 'public/dumps');
if (path.relative(ROOT, generated) !== path.join('public', 'dumps')) throw new Error('Неверный каталог генерации.');
if (!process.argv.includes('--check')) await rm(generated, { recursive: true, force: true });
if (process.argv.includes('--static-export')) {
  const output = path.resolve(ROOT, 'public/dumps');
  if (path.relative(ROOT, output) !== path.join('public', 'dumps')) throw new Error('Неверный каталог генерации.');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const record of records) {
    const directory = path.join(output, record.id);
    await mkdir(directory);
    for (const file of [record.dump.file, ...record.photos.map(photo => photo.file)]) await cp(await assetPath(ROOT, record.id, file), path.join(directory, file));
  }
  await writeFile(path.join(output, 'catalog.json'), `${JSON.stringify(records, null, 2)}\n`);
}
console.log(`Каталог проверен: ${records.length} записей. Размеры, SHA-256 и вложения совпадают.`);
