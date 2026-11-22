import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../src/lib/catalog.mjs';
import { datasheets, datasheetGaps, getDatasheet } from '../src/lib/datasheets.mjs';

export async function verifyDatasheets(root) {
  const directory = path.join(root, 'public/datasheets');
  const ids = new Set(), hashes = new Set(), pairs = new Set();
  for (const document of datasheets) {
    assert.match(document.id, /^[a-z0-9-]+$/);
    assert.match(document.sha256, /^[a-f0-9]{64}$/);
    assert.equal(document.file, `${document.id}-${document.sha256.slice(0, 12)}.pdf`);
    assert.ok(!ids.has(document.id), `Duplicate datasheet id: ${document.id}`);
    assert.ok(!hashes.has(document.sha256), `Duplicate PDF: ${document.id}`);
    ids.add(document.id); hashes.add(document.sha256);
    assert.ok(document.title && document.publisher && document.revision);
    assert.equal(new URL(document.sourceUrl).protocol, 'https:');
    assert.ok(Number.isSafeInteger(document.pages) && document.pages > 0);
    assert.ok(document.models.length && document.manufacturers.length);
    for (const model of document.models) for (const manufacturer of document.manufacturers) {
      const pair = JSON.stringify([model.trim().toUpperCase(), manufacturer.trim().toUpperCase()]);
      assert.ok(!pairs.has(pair), `Ambiguous datasheet: ${pair}`);
      pairs.add(pair);
    }
    const bytes = await readFile(path.join(directory, document.file));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', document.file);
    assert.equal(bytes.length, document.size, document.file);
    assert.equal(sha256(bytes), document.sha256, document.file);
  }
  assert.deepEqual((await readdir(directory)).sort(), datasheets.map(document => document.file).sort(), 'Unregistered datasheet files');
  const gapPairs = new Set();
  for (const gap of datasheetGaps) {
    assert.ok(gap.chip && gap.manufacturer && gap.reason);
    assert.match(gap.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    const pair = JSON.stringify([gap.chip.trim().toUpperCase(), gap.manufacturer.trim().toUpperCase()]);
    assert.ok(!gapPairs.has(pair), `Duplicate datasheet gap: ${pair}`);
    gapPairs.add(pair);
    assert.equal(getDatasheet(gap), null, `Remove resolved datasheet gap: ${gap.chip}`);
  }
  return datasheets.length;
}
