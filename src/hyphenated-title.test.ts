import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('allows a renamed hyphenated title with the same SKU when no variant is identified', () => {
  const old = parseCsv('Order Number,Product,SKU\n42,Workbook - Spring Edition,WORK', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,SKU\n42,Workbook - Updated Edition,WORK', 'new.csv', 'next');
  const orders = parseCsv('Name,Lineitem name,Lineitem sku,Financial Status\n#42,Workbook - Spring Edition,WORK,paid', 'orders.csv', 'orders');
  const report = audit(old, next, orders);
  expect(report.findings).toEqual([expect.objectContaining({ order: '#42', status: 'Covered' })]);
});
