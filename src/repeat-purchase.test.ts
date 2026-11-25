import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('does not assign an email-only new record to a repeat buyer when only one purchase is in the old export', () => {
  const old = parseCsv('Order Number,Email,Product,SKU\n42,buyer@example.test,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Email,Product,SKU\nbuyer@example.test,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Email,Lineitem name,Lineitem sku,Financial Status\n#42,buyer@example.test,Pattern,PAT,paid\n#43,buyer@example.test,Pattern,PAT,paid', 'orders.csv', 'orders');
  expect(audit(old, next, orders).findings).toEqual([expect.objectContaining({
    order: '#42', status: 'Review', reason: expect.stringContaining('another line item or purchase'),
  })]);
});

it('does not count refunded or voided orders as competing purchases for email fallback', () => {
  const old = parseCsv('Order Number,Email,Product,SKU\n42,buyer@example.test,Pattern,PAT', 'old.csv', 'old');
  const next = parseCsv('Email,Product,SKU\nbuyer@example.test,Pattern,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Email,Lineitem name,Lineitem sku,Financial Status\n#42,buyer@example.test,Pattern,PAT,paid\n#43,buyer@example.test,Pattern,PAT,refunded\n#44,buyer@example.test,Pattern,PAT,voided', 'orders.csv', 'orders');
  expect(audit(old, next, orders)).toMatchObject({
    scope: { excludedStatus: 2 },
    findings: [expect.objectContaining({ order: '#42', status: 'Covered', matchedBy: 'Email' })],
  });
});
