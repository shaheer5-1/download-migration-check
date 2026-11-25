# Download Migration Check

A browser-only tool for Shopify merchants who want to spot gaps in digital download access before switching apps. Use fictional or redacted CSVs only; keep the replacement order numbers, emails, and product identifiers consistent across files. No files are uploaded and no Shopify login or payment is required.

## Try it

1. Select **Load sample data**, or choose three CSVs: your old download app export, your new download app export, and a Shopify orders export. Each sample is also downloadable from its file card.
2. Confirm the columns under **Map columns** if the app doesn't recognize your headers.
3. Select **Run migration check**, filter the results, and download the at-risk rows as a CSV.

The audit checks paid Shopify line items that match an old entitlement. It looks for a new entitlement by order number and product first, then by buyer email and product. Products match by SKU when both files provide one and by name otherwise. Matching ignores case, redundant whitespace, and leading order-number hashes. A buyer is at risk if any checked line is missing access. Unique buyers are counted by email when available, otherwise by order number. Unmatched products are old-app products with no matching product in the supplied Shopify export. Download links in exports are not opened or tested.

## Development

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
npm test
npm run build
```

The production build is written to `dist/`. To preview it locally, run `npm run preview -- --host 0.0.0.0 --port 4173`.
