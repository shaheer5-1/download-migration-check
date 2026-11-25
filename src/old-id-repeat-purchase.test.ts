import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('leaves an old Shopify ID unlinked when two purchases match only by email', () => {
  const old = parseCsv('Shopify Order ID,Email,Product,SKU\n9000001,buyer@example.test,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,SKU\n42,Pattern,PAT\n43,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Email,Lineitem name,Lineitem sku,Financial Status\n#42,buyer@example.test,Pattern,PAT,paid\n#43,buyer@example.test,Pattern,PAT,paid', 'orders.csv', 'orders');
  const report = audit(old, next, orders);
  expect(report).toMatchObject({ buyersChecked: 0, findings: [expect.objectContaining({ orderId: '9000001', origin: 'Old download app', status: 'Review' })] });
});
