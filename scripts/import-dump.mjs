import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { ROOT, sha256, loadCatalog, validateRecord } from '../src/lib/catalog.mjs';

export async function importDump(options, root = ROOT) {
  const bytes = await readFile(options.file);
  if (!bytes.length) throw new Error('Пустой дамп не добавлен.');
  if (options.verify && !bytes.equals(await readFile(options.verify))) throw new Error('Повторное чтение отличается. Файлы не добавлены.');
  const digest = sha256(bytes);
  const existing = await loadCatalog(root);
  const duplicates = existing.filter(record => record.dump.sha256 === digest).map(record => record.id);
  const ext = path.extname(options.file).toLowerCase();
  const photoBytes = await Promise.all((options.photos ?? []).map(file => readFile(file)));
  const record = validateRecord({
    sequence: existing.reduce((highest, item) => Math.max(highest, item.sequence), 0) + 1,
    id: options.id, chip: options.chip, manufacturer: options.manufacturer ?? '',
    type: options.type ?? 'Другое', package: options.package ?? '', label: options.label ?? '',
    description: options.description ?? '', device: options.device ?? '', board: options.board ?? '',
    origin: options.origin ?? 'unknown', programmer: options.programmer ?? 'T56', profile: options.profile ?? '',
    dateAdded: options.date ?? new Date().toISOString().slice(0, 10), readDate: null,
    readVerification: options.verify ? 'matching' : 'not-recorded', readCount: options.verify ? 2 : null,
    deviceTest: 'not-tested', notes: '', tags: [],
    dump: { file: `dump${/^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin'}`, originalFilename: path.basename(options.file), size: bytes.length, sha256: digest },
    photos: (options.photos ?? []).map((file, i) => ({ file: `photo-${i + 1}${path.extname(file).toLowerCase()}`, alt: `${options.chip} — фотография ${i + 1}`, size: photoBytes[i].length, sha256: sha256(photoBytes[i]) })),
  });
  if (existing.some(item => item.id === record.id)) throw new Error(`Запись ${record.id} уже существует.`);
  for (const file of options.photos ?? []) if (!(await stat(file)).isFile()) throw new Error('Фотография не является файлом.');
  // mkdir без recursive для записи не позволяет перезаписать старые исходники.
  await mkdir(path.join(root, 'archive'), { recursive: true });
  const destination = path.join(root, 'archive', record.id);
  await mkdir(destination);
  await writeFile(path.join(destination, record.dump.file), bytes, { flag: 'wx' });
  for (const [index, file] of (options.photos ?? []).entries()) await copyFile(file, path.join(destination, record.photos[index].file), constants.COPYFILE_EXCL);
  await writeFile(path.join(root, 'catalog', `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  return { record, duplicates };
}
