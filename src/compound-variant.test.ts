import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('does not cover a different compound variant sharing the same SKU', () => {
  const old = parseCsv('Order Number,Product,Variant,SKU\n42,Pattern,PDF - A4,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,Variant,SKU\n42,Pattern,SVG - A4,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Lineitem name,Lineitem sku,Financial Status\n#42,Pattern - PDF - A4,PAT,paid', 'orders.csv', 'orders');
  const report = audit(old, next, orders);
  expect(report.findings).toEqual([expect.objectContaining({ order: '#42', status: 'At risk' })]);
});

it('does not cover Pattern - PDF - A4 with Pattern - SVG - A4 when only the new export splits out A4', () => {
  const old = parseCsv('Order Number,Product,SKU\n42,Pattern - PDF - A4,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,Variant,SKU\n42,Pattern - SVG,A4,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Lineitem name,Lineitem sku,Financial Status\n#42,Pattern - PDF - A4,PAT,paid', 'orders.csv', 'orders');
  expect(audit(old, next, orders).findings).toEqual([expect.objectContaining({ order: '#42', status: 'At risk' })]);
});

it('covers the same SKU and variant when the new app drops a hyphenated product title suffix', () => {
  const old = parseCsv('Order Number,Product,Variant,SKU\n42,Pattern - Deluxe,A4,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,Variant,SKU\n42,Pattern,A4,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Lineitem name,Lineitem sku,Financial Status\n#42,Pattern - Deluxe - A4,PAT,paid', 'orders.csv', 'orders');
  expect(audit(old, next, orders).findings).toEqual([expect.objectContaining({ order: '#42', status: 'Covered' })]);
});
