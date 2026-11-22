import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Astro moves bundled modules into dist; npm scripts always run from the project root.
export const ROOT = process.cwd();
export const TYPES = ['EPROM', 'EEPROM', 'Flash', 'ROM', 'Другое'];
export const ORIGINS = { known: 'Происхождение известно', uncertain: 'Предположительное происхождение', unknown: 'Устройство неизвестно' };
export const READINGS = { 'not-recorded': 'Проверка чтения не записана', single: 'Одно чтение', matching: 'Повторные чтения совпали', unstable: 'Чтения различаются' };
export const DEVICE_TESTS = { 'not-tested': 'В устройстве не проверено', working: 'Работа в устройстве подтверждена', 'not-working': 'В устройстве не работает' };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const normalizeSearch = value => String(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е');
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  return `${Number((bytes / (bytes < 1048576 ? 1024 : 1048576)).toFixed(2))} ${bytes < 1048576 ? 'КиБ' : 'МиБ'}`;
}
export const dateLabel = value => new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const fail = message => { throw new Error(message); };
function textField(value, field, required = false) {
  if (typeof value !== 'string' || (required && !value.trim())) fail(`Поле ${field}: требуется текст${required ? ' (не пустой)' : ''}.`);
}
function safeName(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) && !value.includes('..');
}
export function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('Карточка должна быть объектом.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id ?? '')) fail('id: используйте строчные латинские буквы, цифры и дефисы.');
  for (const field of ['chip', 'manufacturer', 'package', 'label', 'description', 'device', 'board', 'programmer', 'profile', 'notes']) textField(record[field], field, field === 'chip');
  if (!TYPES.includes(record.type)) fail(`Неизвестный тип: ${record.type}`);
  for (const [key, values] of [['origin', ORIGINS], ['readVerification', READINGS], ['deviceTest', DEVICE_TESTS]]) if (!Object.hasOwn(values, record[key])) fail(`Недопустимое значение ${key}.`);
  if (!isDate(record.dateAdded) || (record.readDate !== null && !isDate(record.readDate))) fail('Дата должна существовать и иметь формат YYYY-MM-DD.');
  if (record.readCount !== null && (!Number.isSafeInteger(record.readCount) || record.readCount < 1)) fail('readCount: положительное целое или null.');
  if (record.readVerification === 'matching' && !(record.readCount >= 2)) fail('Для совпавших чтений нужны минимум два чтения.');
  if (!record.dump || !safeName(record.dump.file) || !Number.isSafeInteger(record.dump.size) || record.dump.size < 1 || !/^[a-f0-9]{64}$/.test(record.dump.sha256 ?? '')) fail('Некорректные данные файла дампа.');
  if (!Array.isArray(record.tags) || record.tags.some(tag => typeof tag !== 'string' || !tag.trim())) fail('tags: массив непустых строк.');
  record.strings ??= [];
  record.stringsReviewed ??= false;
  if (typeof record.stringsReviewed !== 'boolean' || !Array.isArray(record.strings)) fail('Некорректные сведения об извлечённых строках.');
  for (const item of record.strings) {
    if (!Number.isSafeInteger(item.offset) || item.offset < 0 || item.encoding !== 'ASCII' || typeof item.text !== 'string' || !/^[\x20-\x7e]+$/.test(item.text) || item.offset + item.text.length > record.dump.size) fail('Некорректная извлечённая строка.');
  }
  if (!Array.isArray(record.photos)) fail('photos: требуется массив.');
  const names = new Set([record.dump.file]);
  for (const photo of record.photos) {
    if (!safeName(photo.file) || !/\.(png|jpe?g|webp)$/i.test(photo.file) || names.has(photo.file)) fail('Недопустимое или повторное имя фотографии.');
    textField(photo.alt, 'photo.alt', true);
    if (!Number.isSafeInteger(photo.size) || photo.size < 1 || !/^[a-f0-9]{64}$/.test(photo.sha256 ?? '')) fail('Некорректные размер или SHA-256 фотографии.');
    names.add(photo.file);
  }
  return record;
}
export async function loadCatalog(root = ROOT) {
  const directory = path.join(root, 'catalog');
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  const records = [];
  for (const name of files) {
    try {
      const record = validateRecord(JSON.parse(await readFile(path.join(directory, name), 'utf8')));
      if (name !== `${record.id}.json`) fail('Имя файла должно совпадать с id.');
      records.push(record);
    } catch (error) { fail(`${name}: ${error.message}`); }
  }
  return records.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || a.id.localeCompare(b.id));
}
export async function assetPath(root, id, filename) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !safeName(filename)) fail('Недопустимый путь вложения.');
  const archive = await realpath(path.join(root, 'archive'));
  const resolved = await realpath(path.join(archive, id, filename));
  const relative = path.relative(archive, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('Вложение находится за пределами archive.');
  if (!(await stat(resolved)).isFile()) fail('Вложение не является файлом.');
  return resolved;
}
export async function verifyAssets(root, records) {
  for (const record of records) {
    const bytes = await readFile(await assetPath(root, record.id, record.dump.file));
    if (bytes.length !== record.dump.size || sha256(bytes) !== record.dump.sha256) fail(`${record.id}: размер или SHA-256 дампа не совпадает с карточкой.`);
    for (const item of record.strings) if (!bytes.subarray(item.offset, item.offset + item.text.length).equals(Buffer.from(item.text, 'ascii'))) fail(`${record.id}: строка по адресу ${item.offset} не совпадает с байтами дампа.`);
    for (const photo of record.photos) {
      const image = await readFile(await assetPath(root, record.id, photo.file));
      if (image.length !== photo.size || sha256(image) !== photo.sha256) fail(`${record.id}: фотография не совпадает с карточкой.`);
    }
  }
}
export const assetUrl = (record, file = record.dump.file) => `/dumps/${record.id}/${encodeURIComponent(file)}`;
export const searchText = record => normalizeSearch([record.chip, record.manufacturer, record.label, record.device, record.board, record.description, record.notes, record.dump.sha256, ...record.tags, ...(record.strings ?? []).map(item => item.text)].join(' '));
