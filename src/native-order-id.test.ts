import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('does not compare the app’s native Order ID to the Shopify order number', () => {
  const old = parseCsv('Order ID,Shopify Order ID,Product,SKU\n1234,9000001,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Order ID,Shopify Order ID,Product,SKU\n5678,9000001,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Id,Lineitem name,Lineitem sku,Financial Status\n#42,9000001,Pattern,PAT,paid', 'orders.csv', 'orders');
  const report = audit(old, next, orders);
  expect(report.findings).toEqual([expect.objectContaining({ order: '#42', status: 'Covered', matchedBy: 'Shopify order ID' })]);
});

it('falls back to Order # instead of dropping the order number when the app also exports both IDs', () => {
  const old = parseCsv('Order ID,Shopify Order ID,Order #,Product,SKU\n1234,,42,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Order ID,Shopify Order ID,Order #,Product,SKU\n5678,,42,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Id,Lineitem name,Lineitem sku,Financial Status\n#42,9000001,Pattern,PAT,paid', 'orders.csv', 'orders');
  expect(audit(old, next, orders).findings).toEqual([expect.objectContaining({ order: '#42', status: 'Covered', matchedBy: 'Order number' })]);
});
