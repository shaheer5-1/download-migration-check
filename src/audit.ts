import { mappedRows, type Dataset } from './csv';

type Row = ReturnType<typeof mappedRows>[number];
export type Finding = {
  order: string;
  email: string;
  product: string;
  sku: string;
  date: string;
  status: 'At risk' | 'Covered';
  matchedBy: 'Order number' | 'Email' | '';
};
export type Report = {
  findings: Finding[];
  buyersChecked: number;
  coveredBuyers: number;
  atRiskBuyers: number;
  unmatchedProducts: string[];
};

const normalize = (value: string) => value.toLowerCase().trim().replace(/\s+/g, ' ');
const orderNumber = (value: string) => normalize(value).replace(/^#+\s*/, '');
const key = (...parts: string[]) => JSON.stringify(parts);

function productKeys(row: Row, side: 'index' | 'lookup') {
  const sku = normalize(row.sku);
  const name = normalize(row.product);
  const products = sku ? [key('sku', sku)] : [];
  if (name && (side === 'index' || !sku)) products.push(key('name', name));
  if (name && (side === 'index' ? !sku : !!sku)) products.push(key('name-without-sku', name));
  return products;
}

function addProductKeys(index: Set<string>, row: Row, identity: string) {
  if (identity) for (const product of productKeys(row, 'index')) index.add(key(identity, product));
}

function matchesProduct(index: Set<string>, row: Row, identity: string) {
  return !!identity && productKeys(row, 'lookup').some(product => index.has(key(identity, product)));
}

function indexEntitlements(rows: Row[]) {
  const orderKeys = new Set<string>();
  const emailKeys = new Set<string>();
  for (const row of rows) {
    addProductKeys(orderKeys, row, orderNumber(row.order));
    addProductKeys(emailKeys, row, normalize(row.email));
  }
  return (row: Row): Finding['matchedBy'] => {
    if (matchesProduct(orderKeys, row, orderNumber(row.order))) return 'Order number';
    if (matchesProduct(emailKeys, row, normalize(row.email))) return 'Email';
    return '';
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

export function audit(oldApp: Dataset, newApp: Dataset, orders: Dataset): Report {
  const oldRows = mappedRows(oldApp);
  const lineItems = shopifyLineItems(mappedRows(orders));
  const hadAccess = indexEntitlements(oldRows);
  const hasAccess = indexEntitlements(mappedRows(newApp));
  const findings: Finding[] = [];
  const buyers = new Map<string, boolean>();
  const orderProducts = new Set(lineItems.flatMap(row => productKeys(row, 'index')));
  const unmatched = new Map<string, string>();

  for (const row of oldRows) {
    const products = productKeys(row, 'lookup');
    if (products.length && !products.some(product => orderProducts.has(product))) {
      unmatched.set(normalize(row.sku || row.product), row.product || row.sku);
    }
  }

  for (const row of lineItems) {
    if (normalize(row.status) !== 'paid' || !hadAccess(row)) continue;
    const matchedBy = hasAccess(row);
    const buyer = row.email ? key('email', normalize(row.email)) : key('order', orderNumber(row.order));
    buyers.set(buyer, (buyers.get(buyer) ?? false) || !matchedBy);
    findings.push({
      order: row.order, email: row.email, product: row.product || row.sku, sku: row.sku, date: row.date,
      status: matchedBy ? 'Covered' : 'At risk', matchedBy,
    });
  }
  const atRiskBuyers = [...buyers.values()].filter(Boolean).length;
  return {
    findings, buyersChecked: buyers.size, coveredBuyers: buyers.size - atRiskBuyers,
    atRiskBuyers, unmatchedProducts: [...unmatched.values()],
  };
}
