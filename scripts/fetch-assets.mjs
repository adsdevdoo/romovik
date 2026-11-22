import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadCatalog, sha256, assetUrl } from '../src/lib/catalog.mjs';

const base = process.env.ARCHIVE_URL || 'https://rom.creepypaste.rs';
if (new URL(base).protocol !== 'https:') throw new Error('ARCHIVE_URL должен использовать HTTPS.');
for (const record of await loadCatalog()) {
  await mkdir(path.join(ROOT, 'archive', record.id), { recursive: true });
  for (const file of [record.dump, ...record.photos]) {
    const destination = path.join(ROOT, 'archive', record.id, file.file);
    let bytes;
    try { bytes = await readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!bytes) {
      const response = await fetch(new URL(assetUrl(record, file.file), base), { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`${record.id}/${file.file}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error(`Скачанный ${file.file} не прошёл проверку.`);
      await writeFile(destination, bytes, { flag: 'wx' });
    }
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error(`Существующий ${destination} отличается; он НЕ перезаписан.`);
    console.log(`Проверен: ${record.id}/${file.file}`);
  }
}
