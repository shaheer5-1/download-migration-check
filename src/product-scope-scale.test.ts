import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';

it('counts high-volume products with the same title and different SKUs without scanning purchases pairwise', () => {
  const count = 6500;
  const old = parseCsv('Order Number,Product,SKU\n' + Array.from({ length: count }, (_, i) => `old-${i},Pattern,OLD`).join('\n'), 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,SKU', 'new.csv', 'next');
  const orders = parseCsv('Name,Lineitem name,Lineitem sku,Financial Status\n' + Array.from({ length: count }, (_, i) => `#${i},Pattern,NEW,paid`).join('\n'), 'orders.csv', 'orders');
  const started = performance.now();
  const report = audit(old, next, orders);
  expect(performance.now() - started).toBeLessThan(3000);
  expect(report.unmatchedProducts).toEqual(['Pattern']);
  expect(report.scope).toMatchObject({ withoutOld: count, unmatchedOld: count });
}, 60000);

it('reconciles thousands of purchases spanning distinct variants with one shared SKU', () => {
  const count = 4800;
  const variants = 96;
  const old = parseCsv('Order Number,Product,Variant,SKU\n' + Array.from({ length: count }, (_, i) => `${i},Pattern,V${i % variants},PAT`).join('\n') +
    '\nmissing,Pattern,Missing,PAT', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,SKU', 'new.csv', 'next');
  const orders = parseCsv('Name,Lineitem name,Lineitem sku,Financial Status\n' +
    Array.from({ length: count }, (_, i) => `#${i},Pattern - V${i % variants},PAT,paid`).join('\n'), 'orders.csv', 'orders');
  const report = audit(old, next, orders);
  expect(report.scope).toMatchObject({ checkedRows: count, withoutOld: 0, unmatchedOld: 1 });
  expect(report.unmatchedProducts).toEqual(['Pattern']);
});
