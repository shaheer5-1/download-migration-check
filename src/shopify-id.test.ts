import { expect, it } from 'vitest';
import { audit } from './audit';
import { missingFields, parseCsv } from './csv';

it('compares explicitly labeled Shopify IDs to Shopify Id, not to the order name', () => {
  const old = parseCsv('Shopify Order ID,Product,SKU\n9000001,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Shopify Order ID,Product,SKU\n9000001,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Id,Lineitem name,Lineitem sku,Financial Status\n#42,9000001,Pattern,PAT,paid', 'orders.csv', 'orders');
  expect(missingFields(old.mapping, 'old')).toEqual([]);
  expect(missingFields(next.mapping, 'next')).toEqual([]);
  expect(audit(old, next, orders).findings).toEqual([expect.objectContaining({ order: '#42', status: 'Covered', matchedBy: 'Shopify order ID' })]);
});
