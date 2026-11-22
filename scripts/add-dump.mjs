import { parseArgs } from 'node:util';
import { importDump } from './import-dump.mjs';

const { values } = parseArgs({ options: Object.fromEntries([
  ...['file', 'id', 'chip', 'manufacturer', 'type', 'package', 'label', 'description', 'device', 'board', 'origin', 'programmer', 'profile', 'date', 'verify'].map(key => [key, { type: 'string' }]),
  ['photo', { type: 'string', multiple: true }], ['help', { type: 'boolean' }],
]) });
if (values.help || !values.file || !values.id || !values.chip) {
  console.log('npm run add-dump -- --file <путь> --id <постоянный-id> --chip <маркировка> [--type EPROM] [--description <текст>] [--photo <путь>] [--verify <повторное-чтение>]');
  process.exit(values.help ? 0 : 1);
}
try {
  const { record, duplicates } = await importDump({ ...values, photos: values.photo });
  console.log(`Добавлено: ${record.id}\nРазмер: ${record.dump.size} байт\nSHA-256: ${record.dump.sha256}`);
  if (duplicates.length) console.log(`Такое содержимое уже есть: ${duplicates.join(', ')}. Происхождение сохранено отдельной карточкой.`);
  console.log('Проверьте описание и происхождение в catalog; затем npm run build.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
