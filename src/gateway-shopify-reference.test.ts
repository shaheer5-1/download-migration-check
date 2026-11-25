import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('links a third-party gateway sale when its explicit Shopify order reference matches', () => {
  const old = parseCsv('Provider Order ID,Gateway,Shopify Order Number,Buyer Email,Product,SKU\n80001,Stripe,42,buyer@example.test,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,SKU\n42,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Email,Lineitem name,Lineitem sku,Financial Status\n#42,buyer@example.test,Pattern,PAT,paid', 'orders.csv', 'orders');
  const report = audit(old, next, orders);
  expect(report.findings).toEqual([expect.objectContaining({ order: '#42', status: 'Covered' })]);
});
