import { mappedRows, type Dataset } from './csv';

type Row = ReturnType<typeof mappedRows>[number];
type Match = 'Order number' | 'Email';
export type Finding = {
  order: string;
  email: string;
  product: string;
  sku: string;
  date: string;
  status: 'At risk' | 'Covered' | 'Review';
  matchedBy: Match | '';
  reason: string;
  candidate: string;
  oldAssets: string;
};
export type Report = {
  findings: Finding[];
  buyersChecked: number;
  coveredBuyers: number;
  atRiskBuyers: number;
  reviewBuyers: number;
  unmatchedProducts: string[];
};

const normalize = (value: string) => value.toLowerCase().trim().replace(/\s+/g, ' ');
const orderNumber = (value: string) => normalize(value).replace(/^#+\s*/, '');
const looseOrder = (value: string) => {
  const number = orderNumber(value).match(/^[a-z -]*(\d+)[a-z -]*$/)?.[1];
  return number?.replace(/^0+(?=\d)/, '') ?? '';
};
const looseEmail = (value: string) => normalize(value).replace(/\+[^@]+(?=@)/, '');
const key = (...parts: string[]) => JSON.stringify(parts);
const unique = <T>(values: T[]) => [...new Set(values)];

function productKeys(row: Row) {
  const name = productName(row);
  const base = name.split(' - ')[0];
  return unique([row.sku && key('sku', normalize(row.sku)), name && key('name', name), base && key('name', base)].filter(Boolean));
}

const productName = (row: Row) => normalize(row.product && row.variant && !normalize(row.product).endsWith(` - ${normalize(row.variant)}`)
  ? `${row.product} - ${row.variant}` : row.product);

function productStrength(a: Row, b: Row) {
  const nameA = productName(a);
  const nameB = productName(b);
  const sameName = !!nameA && nameA === nameB;
  if (a.sku && b.sku) return normalize(a.sku) === normalize(b.sku) ? (sameName ? 2 : 1) : 0;
  if (sameName) return 2;
  return nameA && nameB && (nameA.startsWith(`${nameB} - `) || nameB.startsWith(`${nameA} - `)) ? 1 : 0;
}

type Candidate = { row: Row; strength: number; by: Match };

function indexRows(rows: Row[]) {
  const index = new Map<string, Row[]>();
  const identities = (row: Row) => [
    ['order', orderNumber(row.order)], ['email', normalize(row.email)],
    ['similar order', looseOrder(row.order)], ['similar email', looseEmail(row.email)],
  ];
  for (const row of rows) {
    for (const [type, value] of identities(row)) {
      if (!value) continue;
      for (const product of productKeys(row)) {
        const id = key(type, value, product);
        const bucket = index.get(id);
        if (bucket) bucket.push(row);
        else index.set(id, [row]);
      }
    }
  }
  return (target: Row) => {
    const entries = identities(target).flatMap(([type, value]) => value
      ? productKeys(target).flatMap(product => index.get(key(type, value, product)) ?? [])
      : []);
    const exact: Candidate[] = [];
    const alternatives: { row: Row; reason: string }[] = [];
    const order = orderNumber(target.order);
    const email = normalize(target.email);
    for (const row of unique(entries)) {
      const strength = productStrength(target, row);
      if (!strength) continue;
      const candidateOrder = orderNumber(row.order);
      const candidateEmail = normalize(row.email);
      if (order && order === candidateOrder) exact.push({ row, strength, by: 'Order number' });
      else if (email && email === candidateEmail && (!order || !candidateOrder)) exact.push({ row, strength, by: 'Email' });
      else if (order && candidateOrder && looseOrder(order) && looseOrder(order) === looseOrder(candidateOrder)) {
        alternatives.push({ row, reason: 'Order numbers differ in formatting; verify the original purchase.' });
      } else if (email && email === candidateEmail) {
        alternatives.push({ row, reason: 'The same buyer and product appear on a different order.' });
      } else if (email && candidateEmail && looseEmail(email) === looseEmail(candidateEmail)) {
        alternatives.push({ row, reason: 'Buyer emails differ by a plus alias; verify the recipient.' });
      }
    }
    const byOrder = exact.filter(match => match.by === 'Order number');
    const ranked = byOrder.length ? byOrder : exact;
    const best = ranked.reduce((strength, match) => Math.max(strength, match.strength), 0);
    return { matches: ranked.filter(match => match.strength === best), alternatives };
  };
}

function shopifyLineItems(rows: Row[]): Row[] {
  const metadata = new Map<string, Pick<Row, 'email' | 'status' | 'date'>>();
  const orderIds: string[] = [];
  let order = '';
  for (const row of rows) {
    if (row.order) order = row.order;
    else if (row.status || row.date || row.email) order = '';
    const id = orderNumber(order);
    orderIds.push(order);
    if (id) {
      const previous = metadata.get(id);
      metadata.set(id, {
        email: row.email || previous?.email || '',
        status: row.status || previous?.status || '',
        date: row.date || previous?.date || '',
      });
    }
  }
  return rows.map((row, index) => {
    const order = orderIds[index];
    const shared = metadata.get(orderNumber(order));
    return {
      ...row, order,
      email: row.email || shared?.email || '',
      status: row.status || shared?.status || '',
      date: row.date || shared?.date || '',
    };
  });
}

const differentEmail = (a: Row, b: Row) => !!a.email && !!b.email && normalize(a.email) !== normalize(b.email);
const describeRows = (rows: Row[]) => unique(rows.map(row =>
  [(row.order || row.externalOrder) && `Order ${row.order || row.externalOrder}`, row.email, row.product, row.variant,
    row.sku && `SKU ${row.sku}`, row.assetId && `ID ${row.assetId}`, row.access].filter(Boolean).join(' · '))).join('; ');
const enabled = (value: string) => ['enabled', 'active', 'granted', 'true', 'yes', '1', 'available'].includes(normalize(value));
const disabled = (value: string) => ['disabled', 'inactive', 'revoked', 'false', 'no', '0', 'unavailable', 'expired'].includes(normalize(value));

export function audit(oldApp: Dataset, newApp: Dataset, orders: Dataset): Report {
  const oldRows = mappedRows(oldApp);
  const lineItems = shopifyLineItems(mappedRows(orders));
  const oldIndex = indexRows(oldRows);
  const newIndex = indexRows(mappedRows(newApp));
  const orderProducts = new Map<string, Row[]>();
  for (const row of lineItems) {
    for (const product of productKeys(row)) {
      const bucket = orderProducts.get(product);
      if (bucket) bucket.push(row);
      else orderProducts.set(product, [row]);
    }
  }
  const unmatched = new Map<string, string>();
  for (const row of oldRows) {
    const products = productKeys(row);
    if (products.length && !products.some(product => orderProducts.get(product)?.some(order => productStrength(row, order)))) {
      unmatched.set(normalize(row.sku || row.product), row.product || row.sku);
    }
  }

  const claims = new Map<Row, Map<string, number>>();
  const scoped = lineItems.flatMap(row => {
    if (normalize(row.status) !== 'paid') return [];
    const old = oldIndex(row).matches.map(match => match.row);
    if (!old.length) return [];
    const target = { ...row, email: row.email || (unique(old.map(asset => normalize(asset.email)).filter(Boolean)).length === 1
      ? old.find(asset => asset.email)?.email ?? '' : '') };
    const next = newIndex(target);
    const line = key(orderNumber(target.order), normalize(target.email), normalize(row.sku), normalize(row.product));
    for (const match of next.matches) {
      const byLine = claims.get(match.row) ?? new Map();
      byLine.set(line, match.strength);
      claims.set(match.row, byLine);
    }
    return [{ row, old, next, line, target }];
  });

  const findings: Finding[] = [];
  const buyers = new Map<string, number>();
  for (const { row, old, next, line, target } of scoped) {
    const oldAssets = unique(old.map(asset => asset.assetId).filter(Boolean));
    const available = next.matches.filter(match => !differentEmail(target, match.row) &&
      (newApp.mapping.access === undefined || enabled(match.row.access)) &&
      [...(claims.get(match.row)?.entries() ?? [])].every(([other, strength]) => other === line || strength < match.strength));
    const conflict = old.filter(asset => differentEmail(row, asset));
    const newConflict = next.matches.filter(match => differentEmail(target, match.row));
    const sameAssetIds = oldAssets.length > 1 && oldAssets.every(id => available.some(({ row }) => row.assetId === id));
    let status: Finding['status'] = 'Review';
    let reason: string;
    let candidates = next.matches.map(match => match.row);
    let matchedBy: Finding['matchedBy'] = '';
    if (conflict.length) {
      reason = 'Shopify and the old app disagree on the buyer email.';
      candidates = [...conflict, ...candidates];
    } else if (newConflict.length) {
      reason = 'The matching new entitlement has a different buyer email.';
    } else if (oldAssets.length > 1 && !sameAssetIds) {
      reason = 'Multiple old files share this line item; the new file IDs do not verify all of them.';
    } else if (available.length) {
      status = 'Covered';
      matchedBy = available[0].by;
      reason = 'Matching new entitlement found.';
    } else if (next.matches.length && newApp.mapping.access !== undefined && next.matches.every(match => disabled(match.row.access))) {
      status = 'At risk';
      reason = 'The matching new entitlement is disabled or revoked.';
    } else if (next.matches.length && newApp.mapping.access !== undefined && next.matches.some(match => !disabled(match.row.access) && !enabled(match.row.access))) {
      reason = 'The matching new entitlement has a missing or unrecognized access status.';
    } else if (next.matches.length) {
      reason = 'The new entitlement could belong to another line item or purchase; verify the exact variant or file.';
    } else if (next.alternatives.length) {
      reason = unique(next.alternatives.map(match => match.reason)).join(' ');
      candidates = next.alternatives.map(match => match.row);
    } else {
      status = 'At risk';
      reason = 'No new entitlement found for this purchase.';
    }
    const buyer = target.email ? key('email', normalize(target.email)) : key('order', orderNumber(row.order));
    const severity = status === 'At risk' ? 2 : status === 'Review' ? 1 : 0;
    buyers.set(buyer, Math.max(buyers.get(buyer) ?? 0, severity));
    findings.push({
      order: row.order, email: row.email, product: row.product || row.sku, sku: row.sku, date: row.date,
      status, matchedBy, reason, candidate: describeRows(candidates), oldAssets: oldAssets.join('; '),
    });
  }
  const atRiskBuyers = [...buyers.values()].filter(severity => severity === 2).length;
  const reviewBuyers = [...buyers.values()].filter(severity => severity === 1).length;
  return {
    findings, buyersChecked: buyers.size, coveredBuyers: buyers.size - atRiskBuyers - reviewBuyers,
    atRiskBuyers, reviewBuyers, unmatchedProducts: [...unmatched.values()],
  };
}
