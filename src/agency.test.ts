import { describe, expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';
import mapleOld from './fixtures/maple-old.csv?raw';
import mapleNew from './fixtures/maple-new.csv?raw';
import mapleOrders from './fixtures/maple-orders.csv?raw';
import cedarOld from './fixtures/cedar-old.csv?raw';
import cedarNew from './fixtures/cedar-new.csv?raw';
import cedarOrders from './fixtures/cedar-orders.csv?raw';
import emptyStatus from './fixtures/mapped-but-empty-orders.csv?raw';

const maple = (orderFile = mapleOrders) => audit(parseCsv(mapleOld, 'maple-old.csv', 'old'), parseCsv(mapleNew, 'maple-new.csv', 'next'), parseCsv(orderFile, 'maple-orders.csv', 'orders'));
const cedar = () => audit(parseCsv(cedarOld, 'cedar-old.csv', 'old'), parseCsv(cedarNew, 'cedar-new.csv', 'next'), parseCsv(cedarOrders, 'cedar-orders.csv', 'orders'));

describe('agency entitlement regressions', () => {
  it('flags wrong-recipient and approximate or conflicting order candidates without verifying coverage', () => {
    const rows = maple().findings;
    const find = (order: string) => rows.find(row => row.order === order);
    expect(find('#1001')?.status).toBe('Covered');
    expect(find('#1002')).toMatchObject({ status: 'Review', reason: expect.stringContaining('different order') });
    expect(find('#1003')).toMatchObject({ status: 'Review', email: 'correct@maple.example', candidate: expect.stringContaining('wrong@other.example') });
    expect(find('#1004')).toMatchObject({ status: 'Covered', matchedBy: 'Email' });
    for (const order of ['#0005', '#1006-A', 'MAP-1007', '#1008']) {
      expect(find(order)).toMatchObject({ status: 'Review', candidate: expect.any(String) });
      expect(find(order)?.candidate).not.toBe('');
    }
    expect(find('#1010')).toBeUndefined();
  });

  it('does not use one new entitlement to cover distinct variants or files', () => {
    const rows = cedar().findings;
    expect(rows.filter(row => row.order === '#1001').map(row => row.status)).toEqual(['Covered', 'Review']);
    expect(rows.filter(row => row.order === '#1002').map(row => row.status)).toEqual(['Review', 'Review']);
    expect(rows.find(row => row.order === '#1008')).toMatchObject({ status: 'Review', oldAssets: 'old-jpg; old-raw' });
  });

  it('reviews partial refunds and cancellation without adding duplicates to restoration work', () => {
    const report = cedar();
    const byOrder = (order: string) => report.findings.filter(row => row.order === order);
    expect(byOrder('#1003')).toHaveLength(2);
    expect(byOrder('#1003').every(row => row.status === 'Review' && row.reason.includes('Partially refunded'))).toBe(true);
    expect(byOrder('#1004')[0]).toMatchObject({ status: 'Review', reason: expect.stringContaining('cancellation') });
    expect(byOrder('#1005')).toHaveLength(0);
    expect(byOrder('#1006')).toHaveLength(1);
    expect(byOrder('#1006')[0]).toMatchObject({ status: 'Review', record: '10, 11' });
    expect(byOrder('#1001')[1].orderId).toBe('9900001');
  });

  it('reports unlinked old records even if Shopify includes the same product', () => {
    expect(maple()).toMatchObject({
      unmatchedProducts: [],
      scope: { unmatchedOld: 1 },
      findings: expect.arrayContaining([expect.objectContaining({ order: '9999', origin: 'Old download app', status: 'Review' })]),
    });
  });

  it('discloses a mapped but blank financial status and surfaces the order for review', () => {
    const report = maple(emptyStatus);
    expect(report.scope).toMatchObject({ unknownStatus: 1, checkedRows: 0 });
    expect(report.findings.find(row => row.order === '#1001')).toMatchObject({ status: 'Review', reason: expect.stringContaining('blank') });
  });
});
