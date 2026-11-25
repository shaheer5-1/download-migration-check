import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { audit } from './audit';
import { decodeCsv, detectSource, missingFields, parseCsv, type Source } from './csv';

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
