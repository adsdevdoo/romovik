import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importDump } from '../scripts/import-dump.mjs';
import { loadCatalog, verifyAssets, validateRecord, searchText, isDate, sha256 } from '../src/lib/catalog.mjs';
import { extractAscii } from '../src/lib/strings.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'romovik-test-'));
  t.after(async () => { if (!path.basename(root).startsWith('romovik-test-') || path.dirname(root) !== os.tmpdir()) throw new Error('Unsafe test cleanup'); await rm(root, { recursive: true, force: true }); });
  await mkdir(path.join(root, 'catalog'));
  const file = path.join(root, 'input.bin');
  const bytes = Buffer.from([0, 1, 255, ...Buffer.from(' IMATIC 95 '), 0, 127, 128]);
  await writeFile(file, bytes);
  return { root, file, bytes, options: { file, id: 'test-chip', chip: 'Тестовый чип', type: 'EPROM', date: '2026-11-22' } };
}
test('import keeps bytes unchanged and leaves origin and device test unconfirmed', async t => {
  const f = await fixture(t);
  const { record } = await importDump(f.options, f.root);
  assert.deepEqual(await readFile(path.join(f.root, 'archive', record.id, record.dump.file)), f.bytes);
  assert.equal(record.dump.sha256, sha256(f.bytes));
  assert.equal(record.dump.originalFilename, 'input.bin');
  assert.match(searchText(record), /input\.bin/);
  assert.equal(record.origin, 'unknown'); assert.equal(record.deviceTest, 'not-tested'); assert.equal(record.readVerification, 'not-recorded');
  await verifyAssets(f.root, await loadCatalog(f.root));
  await assert.rejects(importDump(f.options, f.root), /уже существует/);
});
test('duplicate content retains a separate physical chip record', async t => {
  const f = await fixture(t); await importDump(f.options, f.root);
  const result = await importDump({ ...f.options, id: 'second-chip' }, f.root);
  assert.deepEqual(result.duplicates, ['test-chip']); assert.equal((await loadCatalog(f.root)).length, 2);
});
test('second reading must be byte-identical before a matching status is assigned', async t => {
  const f = await fixture(t);
  const other = path.join(f.root, 'other.bin'); await writeFile(other, Buffer.from('wrong'));
  await assert.rejects(importDump({ ...f.options, verify: other }, f.root), /отличается/);
  assert.equal((await loadCatalog(f.root)).length, 0);
  const { record } = await importDump({ ...f.options, verify: f.file }, f.root);
  assert.equal(record.readVerification, 'matching'); assert.equal(record.readCount, 2);
});
test('tampered bytes and invented extracted strings stop verification', async t => {
  const f = await fixture(t); const { record } = await importDump(f.options, f.root);
  record.strings = [{ text: 'IMATIC 95', offset: 4, encoding: 'ASCII' }]; await verifyAssets(f.root, [record]);
  record.strings[0].offset = 5; await assert.rejects(verifyAssets(f.root, [record]), /строка/);
  record.strings = []; await writeFile(path.join(f.root, 'archive', record.id, record.dump.file), Buffer.alloc(f.bytes.length));
  await assert.rejects(verifyAssets(f.root, [record]), /SHA-256/);
});
test('path traversal and impossible dates are rejected before writing', async t => {
  const f = await fixture(t);
  await assert.rejects(importDump({ ...f.options, id: '../escape' }, f.root), /id/);
  await assert.rejects(importDump({ ...f.options, date: '2026-02-30' }, f.root), /Дата/);
  const { record } = await importDump(f.options, f.root);
  assert.throws(() => validateRecord({ ...record, dump: { ...record.dump, file: '../secret.bin' } }), /файла/);
  assert.throws(() => validateRecord({ ...record, dump: { ...record.dump, originalFilename: 'C:/private/input.bin' } }), /originalFilename/);
  assert.equal(isDate('2024-02-29'), true);
});
test('photo bytes are included in integrity verification', async t => {
  const f = await fixture(t); const photo = path.join(f.root, 'photo.png'); await writeFile(photo, Buffer.from('test image bytes'));
  const { record } = await importDump({ ...f.options, photos: [photo] }, f.root); await verifyAssets(f.root, [record]);
  await writeFile(path.join(f.root, 'archive', record.id, record.photos[0].file), Buffer.from('changed'));
  await assert.rejects(verifyAssets(f.root, [record]), /фотография/);
});
test('ASCII extraction preserves offsets including a string at end of file', () => {
  const b = Buffer.from('\0  Firmware 1.2  \0Last string');
  assert.deepEqual(extractAscii(b), [{ offset: 3, encoding: 'ASCII', text: 'Firmware 1.2' }, { offset: 18, encoding: 'ASCII', text: 'Last string' }]);
});
test('search includes extracted signatures and UTF-8 descriptions', async t => {
  const f = await fixture(t); const { record } = await importDump({ ...f.options, description: 'Счётчик из платы' }, f.root);
  record.strings = [{ text: 'IMATIC 95', offset: 4, encoding: 'ASCII' }];
  assert.match(searchText(record), /imatic 95/); assert.match(searchText(record), /счетчик/);
});

test('catalog keeps permanent insertion order across same-day imports and edits', async t => {
  const f = await fixture(t);
  const first = (await importDump({ ...f.options, id: 'z-first' }, f.root)).record;
  const second = (await importDump({ ...f.options, id: 'a-second' }, f.root)).record;
  assert.equal(first.sequence, 1); assert.equal(second.sequence, 2);
  first.chip = 'Updated marking'; first.dateAdded = '2020-01-01';
  await writeFile(path.join(f.root, 'catalog', 'z-first.json'), JSON.stringify(first));
  assert.deepEqual((await loadCatalog(f.root)).map(r => r.id), ['z-first', 'a-second']);
  const third = (await importDump({ ...f.options, id: 'm-third', date: '2019-01-01' }, f.root)).record;
  assert.equal(third.sequence, 3);
  assert.deepEqual((await loadCatalog(f.root)).map(r => r.id), ['z-first', 'a-second', 'm-third']);
  second.sequence = 1;
  await writeFile(path.join(f.root, 'catalog', 'a-second.json'), JSON.stringify(second));
  await assert.rejects(loadCatalog(f.root), /Повторный номер добавления/);
});
