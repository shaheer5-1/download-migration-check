import { describe, expect, it } from 'vitest';
import { audit } from './audit';
import { missingFields, parseCsv } from './csv';

const shopify = (rows: string) => parseCsv('Name,Email,Financial Status,Lineitem name,Lineitem sku,Created at\n' + rows, 'shopify.csv', 'orders');
const oldApp = (rows: string) => parseCsv('Order ID,Buyer Email,Product name,SKU,Download Link\n' + rows, 'old.csv', 'old');
const newApp = (rows: string) => parseCsv('Shopify Order Number,Customer Email,Product Title,Product SKU\n' + rows, 'new.csv', 'next');

describe('migration audit', () => {
  it('matches normalized order numbers and products, then falls back to buyer email', () => {
    const report = audit(
      oldApp('# 1001,one@example.test,Field   Guide,FG1,https://example.test/file\n,shop@example.test,Photo Kit,,'),
      newApp('1001,,Renamed Guide,fg1\n,SHOP@example.test,Photo Kit,'),
      shopify('1001,one@example.test,Paid,FIELD GUIDE,FG1,2025-11-03\n#1002,shop@example.test,paid,photo kit,PK1,2025-11-04'),
    );
    expect(report.findings.map(row => row.matchedBy)).toEqual(['Order number', 'Email']);
    expect(report).toMatchObject({ buyersChecked: 2, coveredBuyers: 2, atRiskBuyers: 0 });
  });

  it('checks paid digital lines, inherits Shopify continuation metadata, and counts a mixed buyer as at risk', () => {
    const report = audit(
      oldApp('10,one@example.test,Guide,A,\n10,one@example.test,Kit,B,\n11,two@example.test,Guide,A,\n12,three@example.test,Guide,A,\n13,four@example.test,Unknown,Z,'),
      newApp('10,one@example.test,Guide,A\n10,another@example.test,Wrong Product,C'),
      shopify('#10,one@example.test,paid,Guide,A,2025-11-03\n,,,Kit,B,\n,,,Physical T-shirt,T,\n#11,two@example.test,pending,Guide,A,\n#12,three@example.test,refunded,Guide,A,'),
    );
    expect(report.findings.map(({ order, product, status }) => [order, product, status])).toEqual([
      ['#10', 'Guide', 'Covered'], ['#10', 'Kit', 'At risk'],
    ]);
    expect(report.findings[1]).toMatchObject({ email: 'one@example.test', date: '2025-11-03' });
    expect(report).toMatchObject({ buyersChecked: 1, coveredBuyers: 0, atRiskBuyers: 1, unmatchedProducts: ['Unknown'] });
  });

  it('allows a header-only new app export when no entitlements were imported', () => {
    const report = audit(oldApp('10,,Guide,A,'), newApp(''), shopify('10,,paid,Guide,A,'));
    expect(report).toMatchObject({ buyersChecked: 1, coveredBuyers: 0, atRiskBuyers: 1 });
  });

  it('does not treat two SKUs with the same product name as the same entitlement', () => {
    const report = audit(oldApp('10,,Guide,A,'),
      newApp('10,,Guide,B'),
      shopify('10,,paid,Guide,A,'));
    expect(report).toMatchObject({ buyersChecked: 1, coveredBuyers: 0, atRiskBuyers: 1 });
  });
});

describe('column mapping', () => {
  it('allows manually mapping unfamiliar headers and preserves quoted CSV cells', () => {
    const file = parseCsv('Reference,Thing\n010,"Guide, Volume 2"', 'custom.csv', 'old');
    expect(missingFields(file.mapping, 'old')).toEqual(['order number or buyer email', 'product name or SKU']);
    file.mapping = { order: 0, product: 1 };
    expect(missingFields(file.mapping, 'old')).toEqual([]);
    expect(file.rows).toEqual([['010', 'Guide, Volume 2']]);
  });
});
