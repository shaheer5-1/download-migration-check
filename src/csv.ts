import Papa from 'papaparse';

export type Source = 'old' | 'next' | 'orders';
export type Field = 'order' | 'email' | 'product' | 'sku' | 'status' | 'date' | 'assetId'
  | 'variant' | 'access' | 'externalOrder' | 'gateway' | 'cancelled' | 'orderId' | 'lineId' | 'quantity' | 'store' | 'file';
export type Mapping = Partial<Record<Field, number>>;
export type Dataset = { headers: string[]; rows: string[][]; mapping: Mapping; name: string; storeNames: string[] };

export const fields: Record<Source, Field[]> = {
  old: ['order', 'orderId', 'email', 'product', 'sku', 'variant', 'assetId', 'date', 'externalOrder', 'gateway', 'store'],
  next: ['order', 'orderId', 'email', 'product', 'sku', 'variant', 'assetId', 'file', 'access', 'store'],
  orders: ['order', 'email', 'product', 'sku', 'status', 'date', 'cancelled', 'orderId', 'lineId', 'quantity', 'store'],
};

const aliases: Record<Field, string[]> = {
  order: ['Shopify Order Number', 'Shopify Order Name', 'Order number', 'Order Name', 'Order ID', 'Order #', 'Order'],
  email: ['Email', 'Email Address', 'Buyer Email', 'Customer Email', 'Recipient Email', 'Purchaser Email', 'Buyer', 'Customer'],
  product: ['Lineitem name', 'Line item name', 'Product name', 'Product title', 'Product', 'Item name', 'Item', 'Download name'],
  sku: ['Lineitem sku', 'Line item sku', 'Product sku', 'Variant sku', 'SKU'],
  status: ['Financial Status', 'Payment Status', 'Status'],
  date: ['Created at', 'Order date', 'Date', 'Paid at'],
  assetId: ['Asset ID', 'File ID', 'Download ID', 'Entitlement ID'],
  variant: ['Variant', 'Variant Title', 'Variant Name', 'Product Variant'],
  access: ['Access', 'Access Status', 'Entitlement Status', 'Download Status'],
  externalOrder: ['Provider Order ID', 'SendOwl Order ID'],
  gateway: ['Gateway', 'Payment Gateway'],
  cancelled: ['Cancelled at', 'Canceled at', 'Cancellation date'],
  orderId: ['Shopify Order ID'],
  lineId: ['Lineitem ID', 'Line item ID', 'Order Line ID'],
  quantity: ['Lineitem quantity', 'Line item quantity', 'Quantity'],
  store: ['Shopify Store', 'Shopify Domain', 'Shop Domain', 'Store Domain', 'Shop URL', 'Store URL', 'Shop Name', 'Store Name', 'Store'],
  file: ['File name', 'Download file', 'File URL', 'File'],
};

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9#]/g, '');

export function detectMapping(headers: string[], source: Source): Mapping {
  const names = headers.map(normalizeHeader);
  const mapping: Mapping = {};
  for (const field of fields[source]) {
    const candidates = field === 'order' && source === 'orders' ? ['Name', ...aliases.order]
      : field === 'orderId' && source === 'orders' ? ['Id', ...aliases.orderId] : aliases[field];
    const match = candidates.map(name => names.indexOf(normalizeHeader(name))).find(index => index >= 0);
    if (match !== undefined) mapping[field] = match;
  }
  if (source === 'old' && names.includes('state') && mapping.gateway !== undefined &&
      mapping.order !== undefined && names[mapping.order] === 'orderid') {
    mapping.externalOrder = mapping.order;
    delete mapping.order;
  }
  return mapping;
}

export function missingFields(mapping: Mapping, source: Source): string[] {
  const missing = [];
  if (mapping.order === undefined && mapping.orderId === undefined && mapping.email === undefined &&
      !(source === 'next' && isCatalog(mapping))) missing.push('order number or buyer email');
  if (mapping.product === undefined && mapping.sku === undefined) missing.push('product name or SKU');
  if (source === 'orders' && mapping.status === undefined) missing.push('financial status');
  return missing;
}

export function isCatalog(mapping: Mapping) {
  return mapping.order === undefined && mapping.orderId === undefined && mapping.email === undefined &&
    (mapping.file !== undefined || mapping.assetId !== undefined);
}

export function decodeCsv(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export function detectSource(headers: string[]): Source | undefined {
  const names = new Set(headers.map(normalizeHeader));
  if (names.has('lineitemname') || names.has('lineitemsku') || names.has('financialstatus')) return 'orders';
  if ((names.has('state') && names.has('gateway')) || (names.has('downloadlink') && names.has('buyeremail'))) return 'old';
  if (names.has('licensekeys') || (names.has('shopifyordernumber') && names.has('customeremail'))) return 'next';
}

export function productCatalog(headers: string[]) {
  const names = new Set(headers.map(normalizeHeader));
  return names.has('handle') && (names.has('title') || names.has('variantprice')) && !['file', 'filename', 'fileurl', 'downloadfile'].some(name => names.has(name));
}

export function checkSlot(file: Dataset, source: Source) {
  if (productCatalog(file.headers)) throw new Error('This looks like a product catalog, not a download or orders export. Replace it with the CSV described above.');
  const detected = detectSource(file.headers);
  const titles = { old: 'Old download app', next: 'New download app', orders: 'Shopify orders' };
  if (detected && detected !== source) throw new Error(`This looks like a file for “${titles[detected]}”. Replace this file or use the correct slot.`);
}

export function storesIn(file: Dataset) {
  const column = file.mapping.store;
  if (column === undefined) return [];
  const values = new Map<string, string>();
  for (const row of file.rows) {
    const store = row[column]?.trim();
    if (store) values.set(storeKey(store), store);
    if (values.size === 2) break;
  }
  return [...values.values()];
}

export function storeMismatch(files: Dataset[]) {
  return new Set(files.flatMap(storesIn).map(storeKey)).size > 1;
}

export function storeKey(store: string) {
  return store.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\s+/g, ' ');
}

export function parseCsv(data: string, name: string, source: Source): Dataset {
  const directive = /^\uFEFF?sep=([,;\t])\r?\n/i.exec(data);
  const parsed = Papa.parse<string[]>(directive ? data.slice(directive[0].length) : data, {
    delimiter: directive?.[1], delimitersToGuess: [',', ';', '\t'], skipEmptyLines: 'greedy',
  });
  const error = parsed.errors.find(error => error.code !== 'UndetectableDelimiter');
  if (error) throw new Error(error.message);
  const [headerRow, ...rows] = parsed.data;
  if (!headerRow?.some(header => header.trim())) throw new Error('The CSV needs a header row.');
  if (headerRow.length === 1) throw new Error('Expected column headers separated by commas, semicolons, or tabs.');
  const headers = headerRow.map(header => header.trim());
  if (!rows.length && source !== 'next') throw new Error('This file has headers but no data rows. Export a file with records.');
  const file = { headers, rows, mapping: detectMapping(headers, source), name, storeNames: [] as string[] };
  file.storeNames = storesIn(file);
  return file;
}

export function mappedRows(data: Dataset): (Record<Field, string> & { csvRow: number })[] {
  return data.rows.map((row, index) => {
    const val = (field: Field) => row[data.mapping[field] ?? -1]?.trim() ?? '';
    const values = Object.fromEntries((Object.keys(aliases) as Field[]).map(field => [field, val(field)])) as Record<Field, string>;
    return { ...values, csvRow: index + 2 };
  });
}
