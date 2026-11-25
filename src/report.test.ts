import Papa from 'papaparse';
import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';
import { exportReport, filenameFor, filterRows } from './report';
import cedarOld from './fixtures/cedar-old.csv?raw';
import cedarNew from './fixtures/cedar-new.csv?raw';
import cedarOrders from './fixtures/cedar-orders.csv?raw';

const context = { store: 'Cedar Studio', date: '2025-06-15T12:00:00.000Z', files: ['cedar-old.csv', 'cedar-new.csv', 'cedar-orders.csv'] };
const check = (newText = cedarNew) => audit(parseCsv(cedarOld, 'cedar-old.csv', 'old'), parseCsv(newText, 'cedar-new.csv', 'next'), parseCsv(cedarOrders, 'cedar-orders.csv', 'orders'));
const records = (csv: string) => Papa.parse<Record<string, string>>(csv, { header: true }).data;

it('exports run identity, scope, reasons and reliable lookup details separately from review rows', () => {
  const report = check();
  expect(filenameFor(context, 'risk')).toBe('cedar-studio-2025-06-15T12-00-00-000Z-at-risk-downloads.csv');
  expect(records(exportReport(report, context, 'risk'))).toEqual([
    expect.objectContaining({ Store: 'Cedar Studio', Order: '#1007', 'Buyer email': '', 'CSV record': '12', 'Next step': expect.stringContaining('restore') }),
  ]);
  expect(records(exportReport(report, context, 'review'))).toEqual(expect.arrayContaining([
    expect.objectContaining({ Order: '#1004', Status: 'Needs review', Reason: expect.stringContaining('cancellation') }),
  ]));
  expect(records(exportReport(report, context, 'summary'))).toContainEqual({ Metric: 'Shopify CSV', Value: 'cedar-orders.csv' });
});

it('keeps each missing item in the restoration list, with one record per buyer in the outreach export', () => {
  const report = check('Order Number,Buyer Email,Product Name,SKU,Asset ID');
  const lines = records(exportReport(report, context, 'risk'));
  expect(lines.filter(row => row.Order === '#1001')).toHaveLength(2);
  const buyers = records(exportReport(report, context, 'buyers'));
  expect(buyers.filter(row => row.Orders === '#1001')).toEqual([expect.objectContaining({ 'Missing products': 'Pattern PDF; Pattern SVG' })]);
  expect(filterRows(report.findings, 'bundle@cedar.example', 'At risk')).toHaveLength(2);
});
