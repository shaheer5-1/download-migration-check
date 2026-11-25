import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';
import { exportReport } from './report';

it('includes known missing multi-file purchases in the restoration list for a confirmed empty new export', () => {
  const old = parseCsv('Order Number,Product,SKU,Asset ID\n42,Pattern,PAT,pdf\n42,Pattern,PAT,svg', 'old.csv', 'old');
  const next = parseCsv('Order Number,Product,SKU,Asset ID', 'new.csv', 'next');
  const orders = parseCsv('Name,Lineitem name,Lineitem sku,Financial Status\n#42,Pattern,PAT,paid', 'orders.csv', 'orders');
  const report = audit(old, next, orders);
  expect(report.findings).toEqual([expect.objectContaining({ status: 'At risk', oldAssets: 'pdf; svg' })]);
  expect(exportReport(report, { store: 'Test', date: '2025-01-01', files: ['old.csv', 'new.csv', 'orders.csv'] }, 'risk')).toContain('pdf; svg');
});
