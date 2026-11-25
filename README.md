# Download Migration Check

A browser-only tool for Shopify merchants who want to spot gaps in digital download access before switching apps. Use fictional or redacted CSVs only; keep the replacement order numbers, emails, and product identifiers consistent across files. No files are uploaded and no Shopify login or payment is required.

## Try it

1. Select **Load sample data**, or choose three CSVs: your old download app export, your new download app export, and a Shopify orders export. Each sample is also downloadable from its file card.
2. Confirm the columns under **Map columns** if the app doesn't recognize your headers. Use the per-slot guidance to find the right exports, and confirm your files all describe the same store.
3. Select **Run migration check**, verify flagged records in the source apps, and download the at-risk rows as a restoration checklist. You can also export a one-row-per-buyer list, a review queue, or a scope summary.

The audit checks paid or partially refunded Shopify line items that match an old download record. It looks for a new record by order number and product first, then by buyer email and product if an order number is missing. Products match by SKU or product/variant names. Matching ignores case, redundant whitespace, and leading order-number hashes; potentially similar IDs or emails are review candidates, not automatic matches. Conflicts, unclear refunds, repeat rows, cancelled paid orders, and unlinked old records are flagged for review. A variant-to-file export checks file configuration, not buyer-level access. No download links are opened or tested.

The buyer counts prioritize **At risk**, then **Needs review**, then **Covered** so each Shopify buyer is counted once. Off-Shopify and other unlinked old records are listed separately. Use the scope breakdown to see skipped or incomplete records. Resolve issues in the source apps, run the check again with fresh exports, and verify downloads before retiring the old app.

## Development

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
npm test
npm run build
```

The production build is written to `dist/`. To preview it locally, run `npm run preview -- --host 0.0.0.0 --port 4173`.
