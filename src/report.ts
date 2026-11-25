import Papa from 'papaparse';
import type { Finding, Report } from './audit';

export const reportColumns = [
  ['Order', 'order'], ['Buyer email', 'email'], ['Status', 'status'], ['Product', 'product'], ['SKU', 'sku'],
  ['Reason', 'reason'], ['Candidate', 'candidate'], ['Old file IDs', 'oldAssets'], ['Matched by', 'matchedBy'], ['Order date', 'date'],
  ['Source', 'origin'], ['Shopify order ID', 'orderId'], ['Shopify line ID', 'lineId'], ['CSV record', 'record'], ['Next step', 'action'],
] as const satisfies ReadonlyArray<readonly [string, keyof Finding]>;

export type RunContext = { store: string; date: string; files: string[] };
export type ExportKind = 'risk' | 'review' | 'buyers' | 'summary';
export type ReportSummary = Omit<Report, 'findings'> & { rowCount: number; hasReview: boolean };

export const filenameFor = (context: RunContext, kind: ExportKind) => {
  const store = context.store.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  const time = context.date.replace(/[:.]/g, '-');
  const title = { risk: 'at-risk-downloads', review: 'needs-review', buyers: 'at-risk-buyers', summary: 'scope-summary' };
  return `${store || 'store'}-${time}-${title[kind]}.csv`;
};

const unparse = (fields: string[], data: (string | number)[][]) => Papa.unparse({ fields, data }, { escapeFormulae: true });

export function exportReport(report: Report, context: RunContext, kind: ExportKind) {
  if (kind === 'summary') {
    const scope = report.scope;
    return unparse(['Metric', 'Value'], [
      ['Store', context.store], ['Run (UTC)', context.date], ['Old app CSV', context.files[0]],
      ['New app CSV', context.files[1]], ['Shopify CSV', context.files[2]], ['Shopify orders identified', scope.shopifyOrders],
      ['Shopify records', scope.shopifyRows], ['Shopify checked records', scope.checkedRows],
      ['No old entitlement', scope.withoutOld], ['Excluded by status', scope.excludedStatus],
      ['Blank or unrecognized financial status', scope.unknownStatus], ['Incomplete Shopify records', scope.unidentified],
      ['Repeated Shopify records', scope.duplicates], ['Old app records', scope.oldRows], ['Identifiable old app buyers', scope.oldBuyers],
      ['Unlinked old records', scope.unmatchedOld], ['Unmatched products', report.unmatchedProducts.length],
      ['Invalid old app records', scope.invalidOld], ['Invalid new app records', scope.invalidNew], ['Buyers checked', report.buyersChecked],
      ['Covered', report.coveredBuyers], ['At risk', report.atRiskBuyers], ['Need review', report.reviewBuyers],
      ['Limit', 'CSV comparisons cannot verify live download access. Check the source apps before contacting buyers.'],
    ]);
  }
  const status = kind === 'review' ? 'Review' : 'At risk';
  const records = report.findings.filter(row => row.status === status);
  if (kind === 'buyers') {
    const grouped = new Map<string, Finding[]>();
    for (const row of records) {
      const group = grouped.get(row.buyerKey);
      if (group) group.push(row);
      else grouped.set(row.buyerKey, [row]);
    }
    return unparse(['Store', 'Run (UTC)', 'Buyer email', 'Orders', 'Shopify order IDs', 'Missing products', 'Reasons', 'Next step'],
      [...grouped.values()].map(rows => {
        const join = (field: keyof Finding) => [...new Set(rows.map(row => row[field]).filter(Boolean))].join('; ');
        return [context.store, context.date, join('email'), join('order'), join('orderId'), join('product'), join('reason'),
          join('email') ? 'Verify and restore the downloads in the new app before contacting the buyer.' : 'Look up the buyer by order ID or order number in Shopify.'];
      }));
  }
  return unparse(['Store', 'Run (UTC)', ...reportColumns.map(([label]) => label)],
    records.map(row => [context.store, context.date, ...reportColumns.map(([, field]) => field === 'status' && status === 'Review' ? 'Needs review' : row[field])]));
}

export function filterRows(rows: Finding[], query: string, status: string) {
  const term = query.trim().toLowerCase();
  return rows.filter(row => (!status || status === row.status) &&
    (!term || [row.order, row.email, row.product, row.sku, row.candidate, row.reason, row.orderId, row.lineId].some(value => value.toLowerCase().includes(term))));
}
