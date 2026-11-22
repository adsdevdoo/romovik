import { readFile } from 'node:fs/promises';
import { extractAscii } from '../src/lib/strings.mjs';
if (!process.argv[2]) { console.error('node scripts/inspect-dump.mjs <файл>'); process.exit(1); }
console.log(JSON.stringify(extractAscii(await readFile(process.argv[2])), null, 2));
