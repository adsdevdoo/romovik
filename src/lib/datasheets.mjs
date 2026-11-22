import documents from './datasheets.json' with { type: 'json' };
import gaps from './datasheet-gaps.json' with { type: 'json' };

export const datasheets = documents;
export const datasheetGaps = gaps;
const normalized = value => String(value ?? '').trim().toUpperCase();
export const datasheetUrl = document => `/datasheets/${document.file}`;

// Explicit model + manufacturer pairs: a programmer profile is not identification.
export function getDatasheet(record) {
  return datasheets.find(document =>
    document.models.some(model => normalized(model) === normalized(record.chip)) &&
    document.manufacturers.some(name => normalized(name) === normalized(record.manufacturer))
  ) ?? null;
}

// A documented unsuccessful search never permits using another manufacturer's PDF.
export function getDatasheetGap(record) {
  return gaps.find(gap => normalized(gap.chip) === normalized(record.chip) &&
    normalized(gap.manufacturer) === normalized(record.manufacturer)) ?? null;
}
