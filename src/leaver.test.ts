import { expect, it } from 'vitest';
import { audit } from './audit';
import { parseCsv } from './csv';
import sendowl from './fixtures/sendowl-orders-report.csv?raw';
import alva from './fixtures/alva-no1010.csv?raw';
import shopify from './fixtures/shopify-orders_export.csv?raw';

const leaver = () => audit(parseCsv(sendowl, 'sendowl.csv', 'old'), parseCsv(alva, 'alva.csv', 'next'), parseCsv(shopify, 'shopify.csv', 'orders'));

it('links SendOwl provider IDs via email and Shopify variant titles without covering disabled Alva access', () => {
  const report = leaver();
  const byOrder = (order: string) => report.findings.find(row => row.order === order);
  expect(byOrder('#1001')?.status).toBe('Covered');
  expect(byOrder('#1005')).toMatchObject({ status: 'At risk', reason: expect.stringContaining('disabled') });
  expect(byOrder('#1010')).toMatchObject({ status: 'At risk', product: 'Studio Preset Pack - Capture One' });
  expect(report.unmatchedProducts).not.toContain('Studio Preset Pack');
});

it('surfaces off-Shopify sales and single-digital-item partial refunds', () => {
  const report = leaver();
  expect(report.scope).toMatchObject({ oldBuyers: 10, unmatchedOld: 1, excludedStatus: 1 });
  expect(report.findings.find(row => row.email === 'finley@example.test')).toMatchObject({ status: 'Review', action: expect.stringContaining('manually resend') });
  expect(report.findings.find(row => row.order === '#1003')).toMatchObject({ status: 'At risk', reason: expect.stringContaining('Partially refunded') });
});
