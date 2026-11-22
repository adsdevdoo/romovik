import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { loadCatalog, sha256 } from '../src/lib/catalog.mjs';
const base = process.env.CHECK_URL || 'http://localhost:4321';
await stat('dist/server/entry.mjs');
const records = await loadCatalog();
const publicCatalog = await (await fetch(`${base}/dumps/catalog.json`)).json();
assert.deepEqual(publicCatalog, records, 'Database catalog differs from the reviewed snapshot');
const index = await (await fetch(base)).text();
assert.deepEqual([...index.matchAll(/data-sequence="(\d+)"/g)].map(m => Number(m[1])), records.map(r => r.sequence));
assert.ok(!index.includes('id="sort"'));
const paths = ['/', '/about/', '/submit/', '/moderation/', ...records.map(r => `/rom/${r.id}/`)];
const links = new Set();
for (const path of paths) {
  const response = await fetch(`${base}${path}`); assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.match(html, /<html lang="ru"/); assert.match(html, /<title>.+?<\/title>/); assert.match(html, /rel="canonical" href="https:\/\//);
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s); assert.ok(json); JSON.parse(json[1]);
  if (path === '/moderation/') assert.ok(html.includes('noindex'));
  for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]*)[^\"]*"/g)) if (!match[1].startsWith('//')) links.add(match[1]);
}
for (const path of links) assert.equal((await fetch(`${base}${path}`)).status, 200, path);
assert.equal((await fetch(`${base}/rom/no-such-chip/`)).status, 404);
assert.equal((await fetch(`${base}/api/moderation/submissions`)).status, 401);
const sitemap = await (await fetch(`${base}/sitemap-0.xml`)).text();
let assets = 0;
for (const record of records) {
  assert.ok(sitemap.includes(`/rom/${record.id}/`));
  assert.ok(index.includes(record.dump.originalFilename));
  for (const asset of [record.dump, ...record.photos]) {
    const response = await fetch(`${base}/dumps/${record.id}/${asset.file}`); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.length, asset.size); assert.equal(sha256(bytes), asset.sha256); assets++;
  }
  const html = await (await fetch(`${base}/rom/${record.id}/`)).text();
  for (const item of record.strings) assert.ok(html.includes(item.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')));
}
assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Allow: \/[\s\S]+Sitemap: https:/);
console.log(`Verified ${paths.length} SSR pages, ${links.size} links, ${records.length} records, ${assets} byte-identical assets, search order, sitemap, 404, private moderation.`);
