import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('does not cover a purchased variant with a differently named variant sharing its SKU', () => {
  const old = parseCsv('Order Number,Product,Variant,SKU\n42,Pattern,PDF,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,Variant,SKU\n42,Pattern,SVG,PAT', 'new.csv', 'next');
  const orders = parseCsv('Name,Lineitem name,Lineitem sku,Financial Status\n#42,Pattern - PDF,PAT,paid', 'orders.csv', 'orders');
  expect(audit(old, next, orders).findings).toEqual([expect.objectContaining({ status: 'At risk', product: 'Pattern - PDF' })]);
});
