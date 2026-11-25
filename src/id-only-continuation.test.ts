import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('inherits the Shopify ID on a continuation line repeating the buyer email', () => {
  const old = parseCsv('Shopify Order ID,Product,SKU\n9000001,Guide,GDE\n9000001,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Shopify Order ID,Product,SKU\n9000001,Guide,GDE\n9000001,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Id,Email,Lineitem name,Lineitem sku,Financial Status\n9000001,buyer@example.test,Guide,GDE,paid\n,buyer@example.test,Pattern,PAT,', 'orders.csv', 'orders');
  const report = audit(old, next, orders);
  expect(report.findings).toEqual([
    expect.objectContaining({ orderId: '9000001', product: 'Guide', status: 'Covered' }),
    expect.objectContaining({ orderId: '9000001', product: 'Pattern', status: 'Covered' }),
  ]);
});
