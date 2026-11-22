import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, ROOT } from '../src/lib/catalog.mjs';
import { getDatasheet, datasheetUrl } from '../src/lib/datasheets.mjs';
import { verifyDatasheets } from '../scripts/verify-datasheets.mjs';

test('published chips share intact PDFs without confusing manufacturer or read profile', async () => {
  await verifyDatasheets(ROOT);
  const records = await loadCatalog();
  for (const record of records) assert.ok(getDatasheet(record), record.id);
  const byNumber = number => getDatasheet(records.find(record => record.sequence === number));
  for (const [first, second] of [[2, 4], [3, 8], [5, 6]]) assert.equal(datasheetUrl(byNumber(first)), datasheetUrl(byNumber(second)));
  assert.equal(byNumber(9).id, 'm27512'); // M27C512 filename is only the programmer profile.
  assert.equal(getDatasheet({ chip: 'M27C512', manufacturer: 'STMicroelectronics' }), null);
  assert.equal(getDatasheet({ chip: 'TMS27C256', manufacturer: 'AMD' }), null);
});
