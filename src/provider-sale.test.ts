import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('keeps a separate SendOwl storefront sale in review when the same buyer also bought the product on Shopify', () => {
  const old = parseCsv('Order ID,State,Gateway,Buyer Email,Product,SKU\n80001,complete,Shopify,buyer@example.test,Pattern,PAT\n80002,complete,Stripe,buyer@example.test,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,SKU\n42,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Email,Lineitem name,Lineitem sku,Financial Status\n#42,buyer@example.test,Pattern,PAT,paid', 'orders.csv', 'orders');
  expect(audit(old, next, orders).findings).toEqual([
    expect.objectContaining({ order: '#42', status: 'Covered' }),
    expect.objectContaining({ order: '80002', status: 'Review', origin: 'Old download app', reason: expect.stringContaining('Stripe') }),
  ]);
});

it('keeps a provider sale in review when only its generic order number collides with Shopify', () => {
  const old = parseCsv('Provider Order ID,Gateway,Order Number,Buyer Email,Product,SKU\n80001,Stripe,42,,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,SKU\n42,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Email,Lineitem name,Lineitem sku,Financial Status\n#42,buyer@example.test,Pattern,PAT,paid', 'orders.csv', 'orders');
  expect(audit(old, next, orders)).toMatchObject({
    scope: { withoutOld: 1, unmatchedOld: 1 },
    findings: [expect.objectContaining({ origin: 'Old download app', status: 'Review', reason: expect.stringContaining('Stripe') })],
  });
});
