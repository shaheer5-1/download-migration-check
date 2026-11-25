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
