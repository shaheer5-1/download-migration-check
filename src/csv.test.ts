import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { audit } from './audit';
import { checkSlot, decodeCsv, detectSource, mappedRows, missingFields, parseCsv, storeMismatch, type Source } from './csv';
import { exportReport } from './report';

function read(name: string) {
  const bytes = readFileSync(new URL(`./fixtures/${name}.csv`, import.meta.url));
  return decodeCsv(Uint8Array.from(bytes).buffer);
}

const clean = { old: 'clean-old-sendowl', next: 'clean-new-alva', orders: 'clean-shopify-orders' };
const parse = (source: Source, name = clean[source]) => parseCsv(read(name), name, source);
const run = (replacements: Partial<Record<Source, string>> = {}) => audit(parse('old', replacements.old), parse('next', replacements.next), parse('orders', replacements.orders));

describe('messy tester fixtures', () => {
  it.each(['shopify-semicolon', 'shopify-tab-delimited', 'shopify-excel-sep-directive', 'shopify-excel-utf16le',
    'shopify-excel-utf8-bom-crlf-quotes', 'shopify-empty-and-whitespace-rows'])('reads %s with the same baseline counts', orders => {
    expect(run({ orders })).toMatchObject({ buyersChecked: 4, atRiskBuyers: 2 });
  });

  it.each([
    ['shopify-empty-and-whitespace-rows', '7'],
    ['shopify-excel-sep-directive', '6'],
  ])('reports the physical source line in %s', (orders, line) => {
    expect(run({ orders }).findings.find(row => row.sku === 'PRICING')?.record).toBe(line);
  });

  it('counts physical lines inside quoted records without splitting the field', () => {
    const parsed = parseCsv('\uFEFFsep=;\r\nOrder Number;Product\r\n42;"First\r\nproduct"\r\n43;Second', 'new.csv', 'next');
    expect(mappedRows(parsed).map(({ csvRow, product }) => [csvRow, product])).toEqual([[3, 'First\r\nproduct'], [5, 'Second']]);
  });

  it.each(['new-renamed-email-address', 'new-email-case-padding', 'new-header-case-spaces', 'new-duplicates'])('matches %s with baseline counts', next => {
    expect(run({ next })).toMatchObject({ buyersChecked: 4, atRiskBuyers: 2 });
  });

  it.each(['shopify-excel-windows-1252', 'shopify-iso-8859-1'])('decodes %s without losing accented names', orders => {
    const old = orders.includes('iso') ? 'accent-latin1-control-old-sendowl' : 'accent-control-old-sendowl';
    const control = orders.includes('iso') ? 'accent-latin1-control-shopify-utf8' : 'accent-control-shopify-utf8';
    expect(run({ old, orders }).findings).toEqual(run({ old, orders: control }).findings);
  });

  it.each(['old', 'next', 'orders'] as const)('recognizes the %s sample if put in a different slot', source => {
    expect(detectSource(parse(source).headers)).toBe(source);
    expect(() => checkSlot(parse(source), source === 'orders' ? 'old' : 'orders')).toThrow('correct slot');
  });

  it('rejects a Shopify products export and detects incompatible store identifiers', () => {
    expect(() => checkSlot(parseCsv('Handle,Title,Variant SKU\nphotos,Photos,P', 'products.csv', 'next'), 'next')).toThrow('product catalog');
    const storeFile = (store: string) => parseCsv(`Buyer Email,Product,Store Domain\na@example.test,Photos,${store}`, 'file.csv', 'old');
    expect(storeMismatch([storeFile('https://cedar.example/'), storeFile('CEDAR.example')])).toBe(false);
    expect(storeMismatch([storeFile('cedar.example'), storeFile('maple.example')])).toBe(true);
  });

  it.each(['shopify-empty', 'shopify-headers-only'])('rejects %s', orders => {
    expect(() => parse('orders', orders)).toThrow();
  });

  it('preserves an intentional empty new export, but rejects empty or header-only old exports', () => {
    for (const old of ['old-empty', 'old-headers-only']) expect(() => parse('old', old)).toThrow();
    expect(() => parse('next', 'new-empty')).toThrow();
    expect(parse('next', 'new-headers-only').rows).toHaveLength(0);
  });

  it.each(['shopify-missing-financial-status', 'shopify-renamed-financial-status'])('requires manual financial mapping for %s', orders => {
    expect(missingFields(parse('orders', orders).mapping, 'orders')).toContain('financial status');
  });

  it('reports damaged inputs, unknown status and missing buyer identifiers in the audit scope', () => {
    expect(run({ old: 'old-one-truncated-entitlement-row' }).scope.invalidOld).toBe(1);
    expect(run({ next: 'new-one-truncated-entitlement-row' }).scope.invalidNew).toBe(1);
    expect(run({ orders: 'shopify-unknown-financial-status' }).scope.unknownStatus).toBe(1);
    expect(run({ orders: 'shopify-paid-row-with-neither-email-nor-order' }).scope.unidentified).toBe(1);
  });

  it('reviews a possible match from a truncated new row without claiming access or exporting it for restoration', () => {
    const report = run({ next: 'new-one-truncated-entitlement-row' });
    expect(report).toMatchObject({ buyersChecked: 4, coveredBuyers: 1, reviewBuyers: 1, atRiskBuyers: 2, scope: { invalidNew: 1 } });
    const affected = report.findings.filter(row => row.order === '#1043');
    expect(affected).toEqual([expect.objectContaining({ status: 'Review', reason: expect.stringContaining('skipped') })]);
    expect(affected.some(row => row.status === 'Covered')).toBe(false);
    const context = { store: 'Test', date: '2026-11-25', files: ['old.csv', 'new.csv', 'orders.csv'] };
    const risk = exportReport(report, context, 'risk');
    expect(risk).not.toContain('#1043');
    expect(risk).toContain('skipped');
    expect(exportReport(report, context, 'review')).toMatch(/#1043[^\r\n]*Needs review[^\r\n]*skipped/);
    expect(exportReport(report, context, 'summary')).toContain('skipped');
  });

  it('keeps a truncated old row in the skipped count without inventing an entitlement', () => {
    const report = run({ old: 'old-one-truncated-entitlement-row' });
    expect(report).toMatchObject({ buyersChecked: 3, atRiskBuyers: 1, scope: { invalidOld: 1 } });
    expect(report.findings.some(row => row.order === '#1045')).toBe(false);
  });

  it.each(['shopify-refunded', 'shopify-voided', 'shopify-canceled'])('excludes %s from restoration', orders => {
    expect(run({ orders }).scope.excludedStatus).toBeGreaterThan(0);
  });

  it('surfaces partial refunds, paid cancellations and apparent duplicates', () => {
    expect(run({ orders: 'shopify-partially-refunded' }).findings.some(row => row.reason.includes('Partially refunded'))).toBe(true);
    expect(run({ orders: 'shopify-paid-but-cancelled' }).findings.some(row => row.status === 'Review' && row.reason.includes('cancellation'))).toBe(true);
    expect(run({ orders: 'shopify-duplicates' }).scope.duplicates).toBeGreaterThan(0);
  });

  it('accepts a Shopify Digital Products variant-to-file CSV without asserting buyer-level access', () => {
    const catalog = parseCsv('Product title,Variant SKU,File name\nStudio Preset Pack,PRESETS,studio.zip', 'files.csv', 'next');
    expect(missingFields(catalog.mapping, 'next')).toEqual([]);
    const report = audit(parse('old'), catalog, parse('orders'));
    expect(report.findings.find(row => row.sku === 'PRESETS')).toMatchObject({ status: 'Review', reason: expect.stringContaining('does not verify') });
  });
});
