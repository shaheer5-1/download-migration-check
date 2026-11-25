import { isCatalog, mappedRows, type Dataset } from './csv';

type Row = ReturnType<typeof mappedRows>[number];
type Match = 'Order number' | 'Shopify order ID' | 'Email';
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
  orderId: string;
  lineId: string;
  record: string;
  action: string;
  buyerKey: string;
  origin: 'Shopify' | 'Old download app';
};
export type Report = {
  findings: Finding[];
  buyersChecked: number;
  coveredBuyers: number;
  atRiskBuyers: number;
  reviewBuyers: number;
  unmatchedProducts: string[];
  scope: {
    shopifyRows: number; shopifyOrders: number; checkedRows: number; withoutOld: number;
    excludedStatus: number; unknownStatus: number; unidentified: number; duplicates: number;
    oldRows: number; unmatchedOld: number; oldBuyers: number; invalidOld: number; invalidNew: number;
  };
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

function variantConflicts(name: string, variant: string, otherName: string) {
  const suffix = ` - ${variant}`;
  return !!variant && name.endsWith(suffix) && otherName.startsWith(`${name.split(' - ')[0]} - `) && name !== otherName;
}

function productStrength(a: Row, b: Row) {
  const nameA = productName(a);
  const nameB = productName(b);
  const sameName = !!nameA && nameA === nameB;
  if (a.sku && b.sku) {
    if (normalize(a.sku) !== normalize(b.sku)) return 0;
    if (sameName) return 2;
    const variantA = normalize(a.variant);
    const variantB = normalize(b.variant);
    if ((variantA && variantB && variantA !== variantB) ||
        variantConflicts(nameA, variantA, nameB) || variantConflicts(nameB, variantB, nameA)) return 0;
    return 1;
  }
  if (sameName) return 2;
  return nameA && nameB && (nameA.startsWith(`${nameB} - `) || nameB.startsWith(`${nameA} - `)) ? 1 : 0;
}

type Candidate = { row: Row; strength: number; by: Match };

function indexRows(rows: Row[], allowFallback: (row: Row, target: Row) => boolean = () => true,
  allowOrderNumber: (row: Row, target: Row) => boolean = () => true) {
  const index = new Map<string, Row[]>();
  const identities = (row: Row) => [
    ['order', orderNumber(row.order)], ['orderId', normalize(row.orderId)], ['email', normalize(row.email)],
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
    const orderId = normalize(target.orderId);
    const email = normalize(target.email);
    for (const row of unique(entries)) {
      const strength = productStrength(target, row);
      if (!strength) continue;
      const candidateOrder = orderNumber(row.order);
      const candidateOrderId = normalize(row.orderId);
      const candidateEmail = normalize(row.email);
      const numbersComparable = !!(order && candidateOrder);
      const idsComparable = !!(orderId && candidateOrderId);
      if (idsComparable && orderId === candidateOrderId && (!numbersComparable || order === candidateOrder)) exact.push({ row, strength, by: 'Shopify order ID' });
      else if (numbersComparable && order === candidateOrder && !idsComparable && allowOrderNumber(row, target)) exact.push({ row, strength, by: 'Order number' });
      else if (!allowFallback(row, target)) continue;
      else if (email && email === candidateEmail && !numbersComparable && !idsComparable) exact.push({ row, strength, by: 'Email' });
      else if (order && candidateOrder && looseOrder(order) && looseOrder(order) === looseOrder(candidateOrder)) {
        alternatives.push({ row, reason: 'Order numbers differ in formatting; verify the original purchase.' });
      } else if (email && email === candidateEmail) {
        alternatives.push({ row, reason: 'The same buyer and product appear on a different order.' });
      } else if (email && candidateEmail && looseEmail(email) === looseEmail(candidateEmail)) {
        alternatives.push({ row, reason: 'Buyer emails differ by a plus alias; verify the recipient.' });
      }
    }
    const byOrder = exact.filter(match => match.by !== 'Email');
    const ranked = byOrder.length ? byOrder : exact;
    const best = ranked.reduce((strength, match) => Math.max(strength, match.strength), 0);
    return { matches: ranked.filter(match => match.strength === best), alternatives };
  };
}

function shopifyLineItems(rows: Row[]): Row[] {
  const metadata = new Map<string, Pick<Row, 'email' | 'status' | 'date' | 'cancelled' | 'orderId'>>();
  const orderNames: string[] = [];
  const purchaseKeys: string[] = [];
  let order = '';
  let purchaseKey = '';
  for (const row of rows) {
    if (row.order) {
      order = row.order;
      purchaseKey = key('name', orderNumber(row.order));
    } else if (row.orderId) {
      if (normalize(row.orderId) !== normalize(metadata.get(purchaseKey)?.orderId ?? '')) {
        order = '';
        purchaseKey = key('id', normalize(row.orderId));
      }
    } else if (row.status || row.date || (row.email &&
        (order || normalize(row.email) !== normalize(metadata.get(purchaseKey)?.email ?? '')))) {
      order = purchaseKey = '';
    }
    orderNames.push(order);
    purchaseKeys.push(purchaseKey);
    if (purchaseKey) {
      const previous = metadata.get(purchaseKey);
      metadata.set(purchaseKey, {
        email: row.email || previous?.email || '',
        status: row.status || previous?.status || '',
        date: row.date || previous?.date || '',
        cancelled: row.cancelled || previous?.cancelled || '',
        orderId: row.orderId || previous?.orderId || '',
      });
    }
  }
  return rows.map((row, index) => {
    const order = orderNames[index];
    const shared = metadata.get(purchaseKeys[index]);
    return {
      ...row, order,
      email: row.email || shared?.email || '',
      status: row.status || shared?.status || '',
      date: row.date || shared?.date || '',
      cancelled: row.cancelled || shared?.cancelled || '',
      orderId: row.orderId || shared?.orderId || '',
    };
  });
}

const differentEmail = (a: Row, b: Row) => !!a.email && !!b.email && normalize(a.email) !== normalize(b.email);
const describeRows = (rows: Row[]) => unique(rows.map(row =>
  [(row.order || row.externalOrder) && `Order ${row.order || row.externalOrder}`, row.email, row.product, row.variant,
    row.orderId && `Shopify order ID ${row.orderId}`, row.sku && `SKU ${row.sku}`,
    row.assetId && `ID ${row.assetId}`, row.access].filter(Boolean).join(' · '))).join('; ');
const enabled = (value: string) => ['enabled', 'active', 'granted', 'true', 'yes', '1', 'available'].includes(normalize(value));
const disabled = (value: string) => ['disabled', 'inactive', 'revoked', 'false', 'no', '0', 'unavailable', 'expired'].includes(normalize(value));
const ineligible = new Set(['refunded', 'voided', 'canceled', 'cancelled', 'pending', 'authorized', 'unpaid', 'partially_paid', 'expired']);
const financialStatus = (row: Row) => normalize(row.status).replace(/ /g, '_');
const buyerKey = (row: Row) => row.email ? key('email', normalize(row.email)) : key('order', orderNumber(row.order || row.orderId || row.externalOrder));
const orderKey = (row: Row) => orderNumber(row.order || row.orderId) || key('row', String(row.csvRow));
const validProduct = (row: Row) => !!(row.product || row.sku);
const validPurchase = (row: Row) => validProduct(row) && !!(row.order || row.orderId || row.email);
const validRowWidth = (file: Dataset, row: Row) => file.rows[row.csvRow - 2].length === file.headers.length;
const sourceRecord = (row: Row) => String(row.csvRow);
const outsideShopify = (row: Row) => !!row.gateway && !normalize(row.gateway).includes('shopify');

const productSignature = (row: Row) => key(normalize(row.sku), productName(row), normalize(row.variant));

function indexProducts(rows: Row[]) {
  const index = new Map<string, Row[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const signature = productSignature(row);
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const product of productKeys(row)) {
      for (const bucketKey of row.sku ? [product] : [product, key('no sku', product)]) {
        const bucket = index.get(bucketKey);
        if (bucket) bucket.push(row);
        else index.set(bucketKey, [row]);
      }
    }
  }
  return (row: Row) => {
    const sku = normalize(row.sku);
    if (sku && index.get(key('sku', sku))?.some(order => productStrength(row, order))) return true;
    const name = productName(row);
    return [name, name.split(' - ')[0]].filter(Boolean).some(value => {
      const product = key('name', value);
      return index.get(sku ? key('no sku', product) : product)?.some(order => productStrength(row, order));
    });
  };
}

export function audit(oldApp: Dataset, newApp: Dataset, orders: Dataset): Report {
  const oldRows = mappedRows(oldApp).filter(row => validPurchase(row) && validRowWidth(oldApp, row));
  const lineItems = shopifyLineItems(mappedRows(orders));
  const catalog = isCatalog(newApp.mapping);
  const newRows = mappedRows(newApp).filter(row => validRowWidth(newApp, row) &&
    (catalog ? validProduct(row) && !!(row.file || row.assetId) : validPurchase(row)));
  const newIndex = indexRows(newRows);
  const catalogProducts = new Map<string, Row[]>();
  if (catalog) {
    for (const row of newRows) for (const product of productKeys(row)) {
      const bucket = catalogProducts.get(product);
      if (bucket) bucket.push(row);
      else catalogProducts.set(product, [row]);
    }
  }
  const scope: Report['scope'] = {
    shopifyRows: lineItems.length, shopifyOrders: new Set(lineItems.filter(row => row.order || row.orderId).map(orderKey)).size,
    checkedRows: 0, withoutOld: 0, excludedStatus: 0, unknownStatus: 0, unidentified: 0, duplicates: 0,
    oldRows: oldApp.rows.length, unmatchedOld: 0, oldBuyers: new Set(oldRows.map(buyerKey)).size,
    invalidOld: oldApp.rows.length - oldRows.length, invalidNew: newApp.rows.length - newRows.length,
  };
  const hasOrderProduct = indexProducts(lineItems);
  const productMatches = new Map<string, boolean>();
  const unmatched = new Map<string, string>();
  for (const row of oldRows) {
    const signature = productSignature(row);
    let matches = productMatches.get(signature);
    if (matches === undefined) {
      matches = hasOrderProduct(row);
      productMatches.set(signature, matches);
    }
    if (!matches) {
      unmatched.set(normalize(row.sku || row.product), row.product || row.sku);
    }
  }

  const claims = new Map<Row, Map<string, number>>();
  let purchasesByEmail: Map<string, Row[]> | undefined;
  const hasOtherPurchase = (row: Row, entitlement: Row) => {
    if (!purchasesByEmail) {
      purchasesByEmail = new Map();
      for (const purchase of lineItems) {
        if (!purchase.email || !(purchase.order || purchase.orderId) || !validRowWidth(orders, purchase)) continue;
        for (const product of productKeys(purchase)) {
          const id = key(normalize(purchase.email), product);
          const bucket = purchasesByEmail.get(id);
          if (bucket) bucket.push(purchase);
          else purchasesByEmail.set(id, [purchase]);
        }
      }
    }
    const email = normalize(entitlement.email);
    const purchase = orderKey(row);
    return productKeys(entitlement).some(product => purchasesByEmail?.get(key(email, product))?.some(other =>
      orderKey(other) !== purchase && productStrength(other, entitlement) > 0));
  };
  const oldOrderHeader = normalize(oldApp.headers[oldApp.mapping.order ?? -1] ?? '').replace(/[^a-z]/g, '');
  const shopifyOrderNumber = oldOrderHeader === 'shopifyordernumber' || oldOrderHeader === 'shopifyordername';
  const oldIndex = indexRows(oldRows, (old, target) => !outsideShopify(old) &&
    !(old.orderId && !old.order && hasOtherPurchase(target, old)),
  (old, target) => !outsideShopify(old) || shopifyOrderNumber ||
    (!!old.email && normalize(old.email) === normalize(target.email)));
  const linked = new Set<Row>();
  const partialDigitalCount = new Map<string, number>();
  const duplicateKey = (row: Row) => key(orderKey(row), normalize(row.email), productName(row), normalize(row.sku),
    row.lineId, row.quantity, row.date, financialStatus(row), row.cancelled);
  const repeated = new Map<string, Row[]>();
  for (const row of lineItems) {
    const id = duplicateKey(row);
    const bucket = repeated.get(id);
    if (bucket) bucket.push(row);
    else repeated.set(id, [row]);
  }
  const scoped = lineItems.flatMap(row => {
    const old = oldIndex(row).matches.map(match => match.row);
    for (const asset of old) linked.add(asset);
    const duplicates = repeated.get(duplicateKey(row)) ?? [row];
    if (duplicates[0] !== row) {
      scope.duplicates++;
      return [];
    }
    if (!validRowWidth(orders, row) || !validProduct(row) || !(row.order || row.email || row.orderId)) {
      scope.unidentified++;
      return [];
    }
    const financial = financialStatus(row);
    const unknown = financial !== 'paid' && financial !== 'partially_refunded' && !ineligible.has(financial);
    if (unknown) scope.unknownStatus++;
    else if (ineligible.has(financial)) {
      scope.excludedStatus++;
      return [];
    }
    if (!old.length) {
      if (!unknown) scope.withoutOld++;
      return [];
    }
    if (financial === 'partially_refunded') {
      const order = orderKey(row);
      partialDigitalCount.set(order, (partialDigitalCount.get(order) ?? 0) + 1);
    }
    if (!unknown) scope.checkedRows++;
    const target = { ...row, email: row.email || (unique(old.map(asset => normalize(asset.email)).filter(Boolean)).length === 1
      ? old.find(asset => asset.email)?.email ?? '' : '') };
    const next = newIndex(target);
    const line = key(orderKey(target), normalize(target.email), normalize(row.sku), normalize(row.product));
    for (const match of next.matches) {
      const byLine = claims.get(match.row) ?? new Map();
      byLine.set(line, match.strength);
      claims.set(match.row, byLine);
    }
    return [{ row, old, next, line, target, financial, unknown, duplicates }];
  });

  const findings: Finding[] = [];
  const buyers = new Map<string, number>();
  for (const { row, old, next, line, target, financial, unknown, duplicates } of scoped) {
    const oldAssets = unique(old.map(asset => asset.assetId).filter(Boolean));
    const available = next.matches.filter(match => !differentEmail(target, match.row) &&
      (newApp.mapping.access === undefined || enabled(match.row.access)) &&
      (match.by !== 'Email' || !hasOtherPurchase(row, match.row)) &&
      [...(claims.get(match.row)?.entries() ?? [])].every(([other, strength]) => other === line || strength < match.strength));
    const conflict = old.filter(asset => differentEmail(row, asset));
    const newConflict = next.matches.filter(match => differentEmail(target, match.row));
    const sameAssetIds = oldAssets.length > 1 && oldAssets.every(id => available.some(({ row }) => row.assetId === id));
    let status: Finding['status'] = 'Review';
    let reason: string;
    let candidates = next.matches.map(match => match.row);
    let matchedBy: Finding['matchedBy'] = '';
    if (unknown) {
      reason = `Financial status is ${row.status ? `unrecognized (${row.status})` : 'blank'}; check the Shopify order before restoring access.`;
    } else if (row.cancelled) {
      reason = 'Shopify lists a cancellation date despite an eligible payment status; do not restore without verifying the order.';
    } else if (duplicates.length > 1) {
      reason = `${duplicates.length} Shopify records look identical; confirm quantity and whether they are duplicate export rows.`;
    } else if (financial === 'partially_refunded' && (partialDigitalCount.get(orderKey(row))! > 1 || Number(row.quantity) > 1)) {
      reason = 'Partially refunded order has multiple digital downloads; Shopify does not identify the refunded download in this export.';
    } else if (conflict.length) {
      reason = 'Shopify and the old app disagree on the buyer email.';
      candidates = [...conflict, ...candidates];
    } else if (newConflict.length) {
      reason = 'The matching new entitlement has a different buyer email.';
    } else if (catalog) {
      candidates = unique(productKeys(row).flatMap(product => catalogProducts.get(product) ?? []))
        .filter(candidate => productStrength(row, candidate));
      if (candidates.length) reason = 'A matching file is configured, but a variant-to-file export does not verify this buyer’s access.';
      else {
        status = 'At risk';
        reason = 'No matching file is configured in the new variant-to-file export.';
      }
    } else if (oldAssets.length > 1 && !sameAssetIds && newApp.rows.length) {
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
    if (financial === 'partially_refunded' && !reason.startsWith('Partially refunded')) reason = `Partially refunded order: verify the retained download in Shopify. ${reason}`;
    const buyer = buyerKey(target);
    const severity = status === 'At risk' ? 2 : status === 'Review' ? 1 : 0;
    buyers.set(buyer, Math.max(buyers.get(buyer) ?? 0, severity));
    findings.push({
      order: row.order, email: row.email, product: row.product || row.sku, sku: row.sku, date: row.date,
      status, matchedBy, reason, candidate: describeRows(candidates), oldAssets: oldAssets.join('; '),
      orderId: row.orderId, lineId: row.lineId, record: duplicates.map(sourceRecord).join(', '), buyerKey: buyer, origin: 'Shopify',
      action: status === 'Covered' ? 'No action required.' : status === 'At risk' ? 'Verify the order and retained access, then restore the missing download.' : 'Verify the order, buyer, or file in the source apps before restoring.',
    });
  }
  for (const row of oldRows) {
    if (linked.has(row)) continue;
    scope.unmatchedOld++;
    findings.push({
      order: row.order || row.externalOrder || row.orderId, email: row.email, product: row.product || row.sku, sku: row.sku, date: row.date,
      status: 'Review', matchedBy: '', reason: outsideShopify(row) ? `Old-app sale via ${row.gateway}; no Shopify line item matched.` : 'Old entitlement has no matching Shopify line item in this export.',
      candidate: '', oldAssets: row.assetId, orderId: row.orderId, lineId: '', record: sourceRecord(row), buyerKey: buyerKey(row), origin: 'Old download app',
      action: outsideShopify(row) ? 'Check the new app, then manually resend if access is missing.' : 'Expand the Shopify export or look up the original purchase before restoring.',
    });
  }
  const atRiskBuyers = [...buyers.values()].filter(severity => severity === 2).length;
  const reviewBuyers = [...buyers.values()].filter(severity => severity === 1).length;
  return {
    findings, buyersChecked: buyers.size, coveredBuyers: buyers.size - atRiskBuyers - reviewBuyers,
    atRiskBuyers, reviewBuyers, unmatchedProducts: [...unmatched.values()], scope,
  };
}
