// Candidates only: binary graphics and machine code can also look like ASCII.
export function extractAscii(bytes, minLength = 6) {
  const rows = [];
  let start = 0;
  for (let offset = 0; offset <= bytes.length; offset++) {
    if (offset < bytes.length && bytes[offset] >= 32 && bytes[offset] <= 126) continue;
    if (offset - start >= minLength) {
      const raw = bytes.subarray(start, offset).toString('ascii');
      const text = raw.trim();
      if (text.length >= minLength && /[a-z]{4}/i.test(text)) rows.push({ offset: start + raw.length - raw.trimStart().length, encoding: 'ASCII', text });
    }
    start = offset + 1;
  }
  return rows;
}
