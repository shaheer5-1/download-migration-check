import Papa from 'papaparse';

export type Source = 'old' | 'next' | 'orders';
export type Field = 'order' | 'email' | 'product' | 'sku' | 'status' | 'date';
export type Mapping = Partial<Record<Field, number>>;
export type Dataset = { headers: string[]; rows: string[][]; mapping: Mapping; name: string };

export const fields: Record<Source, Field[]> = {
  old: ['order', 'email', 'product', 'sku'],
  next: ['order', 'email', 'product', 'sku'],
  orders: ['order', 'email', 'product', 'sku', 'status', 'date'],
};

const aliases: Record<Field, string[]> = {
  order: ['Order number', 'Order Name', 'Shopify Order Number', 'Shopify Order Name', 'Shopify Order ID', 'Order ID', 'Order #', 'Order'],
  email: ['Email', 'Buyer Email', 'Customer Email', 'Recipient Email', 'Purchaser Email', 'Buyer', 'Customer'],
  product: ['Lineitem name', 'Line item name', 'Product name', 'Product title', 'Product', 'Item name', 'Item', 'Download name'],
  sku: ['Lineitem sku', 'Line item sku', 'Product sku', 'Variant sku', 'SKU'],
  status: ['Financial Status', 'Payment Status', 'Status'],
  date: ['Created at', 'Order date', 'Date', 'Paid at'],
};

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9#]/g, '');

export function detectMapping(headers: string[], source: Source): Mapping {
  const names = headers.map(normalizeHeader);
  const mapping: Mapping = {};
  for (const field of fields[source]) {
    const candidates = field === 'order' && source === 'orders' ? ['Name', ...aliases.order] : aliases[field];
    const match = candidates.map(name => names.indexOf(normalizeHeader(name))).find(index => index >= 0);
    if (match !== undefined) mapping[field] = match;
  }
  return mapping;
}

export function missingFields(mapping: Mapping, source: Source): string[] {
  const missing = [];
  if (mapping.order === undefined && mapping.email === undefined) missing.push('order number or buyer email');
  if (mapping.product === undefined && mapping.sku === undefined) missing.push('product name or SKU');
  if (source === 'orders' && mapping.status === undefined) missing.push('financial status');
  return missing;
}

export function parseCsv(data: string, name: string, source: Source): Dataset {
  const parsed = Papa.parse<string[]>(data, { delimiter: ',', skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  const [headerRow, ...rows] = parsed.data;
  if (!headerRow?.some(header => header.trim())) throw new Error('The CSV needs a header row.');
  const headers = headerRow.map(header => header.trim());
  return { headers, rows, mapping: detectMapping(headers, source), name };
}

export function mappedRows(data: Dataset): Record<Field, string>[] {
  return data.rows.map(row => {
    const val = (field: Field) => row[data.mapping[field] ?? -1]?.trim() ?? '';
    return { order: val('order'), email: val('email'), product: val('product'), sku: val('sku'), status: val('status'), date: val('date') };
  });
}
