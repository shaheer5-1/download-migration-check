import type { Finding } from './audit';
import { fields, isCatalog, missingFields, storeKey, type Field, type Source } from './csv';
import { icon } from './icons';
import { filenameFor, reportColumns, type ExportKind, type ReportSummary, type RunContext } from './report';
import { samples } from './samples';
import type { FileInfo, Reply, Request } from './worker';
import './style.css';

const sources = ['old', 'next', 'orders'] as const;
const details = {
  old: { title: 'Old download app', hint: 'Who bought downloads in your old app', icon: 'archive', sample: 'SendOwl',
    guide: 'In SendOwl, open Reports, choose the Orders report, and download it as CSV. Include all dates you want to check, buyer email or Shopify order number, and a product or SKU.' },
  next: { title: 'New download app', hint: 'Who has downloads in your new app', icon: 'package', sample: 'Alva',
    guide: 'In Alva, look for a historical Orders or download access export with order number or email, the product, and access status. For Shopify Digital Products, use a buyer-access list if available, or a CSV with variant SKU or product name and file name. A file list does not prove buyer access.' },
  orders: { title: 'Shopify orders', hint: 'The purchases to compare', icon: 'receipt', sample: 'Shopify orders',
    guide: 'In Shopify admin, go to Orders → Export, choose All orders or a matching date range, and export CSV. Do not use the Products export. Keep the Financial Status and line item columns.' },
} as const;
const labels: Record<Field, string> = {
  order: 'Order number', email: 'Buyer email', product: 'Product name', sku: 'SKU', status: 'Financial status', date: 'Order date',
  assetId: 'Asset ID', variant: 'Variant', access: 'Access status', externalOrder: 'Provider order ID', gateway: 'Gateway',
  cancelled: 'Cancelled at', orderId: 'Shopify order ID', lineId: 'Shopify line ID', quantity: 'Quantity', store: 'Store', file: 'File',
};
const data: Partial<Record<Source, FileInfo>> = {};
const loads: Record<Source, number> = { old: 0, next: 0, orders: 0 };
let emptyNewConfirmed = false;
let runId = 0;
let runState: { busy: boolean; context: RunContext } | undefined;
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const send = (message: Request) => worker.postMessage(message);

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="site-header">
    <div class="frame header-content">
      <div class="brand"><span>${icon('migration', 19)}</span> Download Migration Check</div>
      <div class="privacy-badge">${icon('lock', 13)} Browser-only</div>
    </div>
  </header>
  <main class="frame">
    <section class="hero" aria-labelledby="title">
      <div class="eyebrow"><span></span> SHOPIFY MIGRATION TOOL</div>
      <h1 id="title">Will past buyers keep<br class="hero-break"> their downloads?</h1>
      <p>Compare your old and new download app exports against Shopify orders to see who might lose access before you switch.</p>
    </section>
    <aside class="sample-bar" aria-label="Sample data">
      <span class="sample-icon">${icon('flask', 21)}</span>
      <div class="sample-copy"><strong>Try it with sample data</strong><p>Use three fictional exports to see what the report looks like.</p></div>
      <button class="button secondary" id="load-sample" type="button">Load sample data ${icon('arrow', 16)}</button>
    </aside>
    <section class="step" aria-labelledby="upload-title">
      <div class="step-heading">
        <span class="step-number">01</span>
        <div><h2 id="upload-title">Add your CSV exports</h2><p>Use sample or redacted CSVs only. Keep order numbers and substitute buyer emails consistent across files.</p></div>
      </div>
      <details class="upload-help"><summary>How to make redacted copies ${icon('chevron', 14)}</summary><p>Make copies before editing. Remove names, addresses, phone numbers, payment details, and private download links. Replace each buyer email with the same fictional address in all three copies (for example, buyer01@example.test). Keep order numbers, product names or SKUs, access settings, and financial statuses consistent so the records can still match.</p></details>
      <div class="source-grid">
        ${sources.map(source => {
          const info = details[source];
          return `<article class="source-card">
            <span class="source-icon">${icon(info.icon, 21)}</span>
            <h3>${info.title}</h3><p>${info.hint}</p>
            <details class="source-guide"><summary>How to get this export ${icon('chevron', 14)}</summary><p>${info.guide}</p></details>
            <label class="file-drop" id="drop-${source}">
              <input id="file-${source}" type="file" accept=".csv,text/csv" aria-label="Choose CSV for ${info.title}">
              <span id="file-label-${source}">${icon('upload', 17)} <strong>Choose CSV</strong></span>
            </label>
            <div class="filename" id="name-${source}"></div>
            <div class="source-message" id="message-${source}" role="status"></div>
            <div id="map-${source}"></div>
            <div class="file-actions"><button class="sample-link" id="download-${source}" type="button">${icon('download', 14)} ${info.sample} sample CSV</button><button class="sample-link remove-link" id="clear-${source}" type="button" aria-label="Remove CSV for ${info.title}" hidden>Remove file</button></div>
          </article>`;
        }).join('')}
      </div>
      <div class="store-check">
        <label>Store or project name <input type="text" id="store-name" maxlength="80" placeholder="e.g. Example store"></label>
        <div><label class="check-confirm"><input type="checkbox" id="confirm-store"> I checked that all three exports are from this store</label>
        <p id="store-status" role="status">Many CSVs do not include a store identifier. Confirm the filenames before running.</p></div>
      </div>
      <div class="action-row">
        <p class="privacy-note">${icon('shield', 18)} Files stay in this browser and are never uploaded.</p>
        <div class="run-area"><p id="file-count" role="status">0 of 3 files ready</p><button class="button primary" id="run" type="button" disabled><span id="run-label">Run migration check</span> ${icon('arrow', 17)}</button></div>
      </div>
    </section>
    <section class="step results" aria-labelledby="report-title">
      <div class="step-heading"><span class="step-number">02</span><div><h2 id="report-title" tabindex="-1">Review the report</h2><p>Compare records for possible gaps. The report cannot verify that a buyer’s download link works.</p></div></div>
      <div id="report"><p class="empty">Add all three CSVs and run the migration check to see results here.</p></div>
    </section>
  </main>
  <footer class="site-footer"><div class="frame footer-content"><span>Download Migration Check</span><a href="https://app.devin.ai/sessions/03f45bc59d0f4e62a192801b51c52643" target="_blank" rel="noopener noreferrer">Request changes ${icon('external', 13)}</a></div></footer>
`;

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const run = byId<HTMLButtonElement>('run');
const reportElement = byId('report');
const storeName = byId<HTMLInputElement>('store-name');
const confirmStore = byId<HTMLInputElement>('confirm-store');

function syncControls(invalidate = true) {
  if (invalidate && runState) {
    reportElement.innerHTML = '<p class="empty">Files, mappings, or store confirmation changed. Run the migration check again to update the report.</p>';
    runState = undefined;
    runId++;
  }
  const ready = sources.filter(source => data[source] && !missingFields(data[source].mapping, source).length &&
    (source !== 'next' || data[source].rowCount > 0 || emptyNewConfirmed)).length;
  const distinctStores = new Map(sources.flatMap(source => data[source]?.storeNames ?? []).map(store => [storeKey(store), store]));
  const storeConflict = distinctStores.size > 1;
  byId('store-status').textContent = storeConflict ? `Store identifiers disagree: ${[...distinctStores.values()].slice(0, 3).join(', ')}. Replace mismatched exports.`
    : distinctStores.size ? `Store identifier found: ${[...distinctStores.values()][0]}. Verify the files without an identifier too.`
    : 'Many CSVs do not include a store identifier. Confirm the filenames before running.';
  confirmStore.disabled = storeConflict;
  byId('file-count').textContent = `${ready} of 3 files ready`;
  run.disabled = ready !== 3 || storeConflict || !storeName.value.trim() || !confirmStore.checked || !!runState?.busy;
  byId('run-label').textContent = runState?.busy ? 'Checking exports…' : 'Run migration check';
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSource(source: Source, error = '', fileName = '') {
  const file = data[source];
  const missing = file ? missingFields(file.mapping, source) : [];
  const drop = byId(`drop-${source}`);
  const label = byId(`file-label-${source}`);
  const repaintFile = () => {
    const ready = !!file && !missingFields(file.mapping, source).length && (source !== 'next' || file.rowCount > 0 || emptyNewConfirmed);
    drop.classList.toggle('ready', ready);
    const name = file?.name || fileName;
    label.innerHTML = name ? `${icon(ready ? 'check' : 'upload', 17)} <strong>Replace CSV</strong>` : `${icon('upload', 17)} <strong>Choose CSV</strong>`;
    byId(`clear-${source}`).hidden = !name;
    byId(`name-${source}`).textContent = name;
  };
  repaintFile();
  const panel = byId(`map-${source}`);
  const mappingMessage = () => {
    const unmapped = file ? missingFields(file.mapping, source) : [];
    return unmapped.length ? `Map ${unmapped.join(', ')} to continue, or replace the file if these columns are missing.`
      : file && source === 'next' && isCatalog(file.mapping) ? 'File catalog detected: this can check whether files are configured, not buyer access.' : '';
  };
  byId(`message-${source}`).textContent = error || mappingMessage();
  panel.innerHTML = file ? `
    <details class="mapping" ${missing.length ? 'open' : ''}>
      <summary>Map columns ${icon('chevron', 14)}</summary>
      <div class="mapping-fields">
        ${fields[source].map(field => `<label>${labels[field]}<select data-field="${field}"><option value="">Not mapped</option>${file.headers.map((header, index) =>
          `<option value="${index}" ${file.mapping[field] === index ? 'selected' : ''}>${escapeHTML(header || `Column ${index + 1}`)}</option>`).join('')}</select></label>`).join('')}
      </div>
    </details>
    ${source === 'next' && !file.rowCount ? '<label class="check-confirm"><input type="checkbox" id="confirm-empty"> The new export intentionally has no records</label>' : ''}` : '';
  panel.querySelector<HTMLInputElement>('#confirm-empty')?.addEventListener('change', event => {
    emptyNewConfirmed = (event.target as HTMLInputElement).checked;
    repaintFile();
    syncControls();
  });
  for (const select of panel.querySelectorAll<HTMLSelectElement>('select')) {
    select.addEventListener('change', () => {
      if (!file) return;
      const field = select.dataset.field as Field;
      if (select.value === '') delete file.mapping[field];
      else file.mapping[field] = Number(select.value);
      if (field === 'store') {
        file.storeNames = [];
        confirmStore.checked = false;
      }
      byId(`message-${source}`).textContent = mappingMessage();
      repaintFile();
      syncControls();
    });
  }
}

function setSource(source: Source, file: string | File, name: string) {
  if (source === 'next') emptyNewConfirmed = false;
  delete data[source];
  renderSource(source, 'Reading and checking CSV…', name);
  send({ type: 'load', source, version: ++loads[source], file, name });
  syncControls();
}

for (const source of sources) {
  const input = byId<HTMLInputElement>(`file-${source}`);
  byId(`download-${source}`).addEventListener('click', () => download(samples[source].name, samples[source].text));
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    confirmStore.checked = false;
    setSource(source, file, file.name);
  });
  byId(`clear-${source}`).addEventListener('click', () => {
    confirmStore.checked = false;
    delete data[source];
    send({ type: 'clear', source, version: ++loads[source] });
    renderSource(source);
    syncControls();
    input.focus();
  });
}

byId('load-sample').addEventListener('click', () => {
  storeName.value = 'Example store';
  confirmStore.checked = true;
  for (const source of sources) {
    const sample = samples[source];
    setSource(source, sample.text, sample.name);
  }
});
storeName.addEventListener('input', () => syncControls());
confirmStore.addEventListener('change', () => syncControls());

const pageSize = 50;
let pageToken = 0;

function renderReport(report: ReportSummary, context: RunContext) {
  const metrics = [
    ['Buyers checked', report.buyersChecked, report.scope.invalidOld ? 'Paid orders with matching or possible old download records' : 'Paid orders with old access', 'neutral'],
    ['Covered', report.coveredBuyers, 'All checked downloads matched', 'green'],
    ['At risk', report.atRiskBuyers, 'At least one download missing', 'amber'],
    ['Needs review', report.reviewBuyers, 'Coverage not verified', 'amber'],
    ['Unmatched products', report.unmatchedProducts.length, 'Old-app products not matched to Shopify', 'neutral'],
  ] as const;
  reportElement.innerHTML = `
    <p class="run-context"><strong>${escapeHTML(context.store)}</strong> · ${escapeHTML(context.date)}<br>Compared: ${context.files.map(escapeHTML).join(' · ')}</p>
    <div class="metrics">${metrics.map(([label, value, hint, tone]) => `<div class="metric ${tone}"><div>${label}</div><strong>${value}</strong><p>${hint}</p></div>`).join('')}</div>
    ${report.unmatchedProducts.length ? `<details class="unmatched"><summary>View unmatched products ${icon('chevron', 15)}</summary><ul>${report.unmatchedProducts.slice(0, 50).map(product => `<li>${escapeHTML(product)}</li>`).join('')}</ul>${report.unmatchedProducts.length > 50 ? '<p>Showing the first 50. Filter unlinked old records in the report for more detail.</p>' : ''}</details>` : ''}
    ${report.scope.unknownStatus || report.scope.unidentified || report.scope.invalidOld || report.scope.invalidNew
      ? '<p class="scope-warning"><strong>Incomplete check.</strong> Some records have missing or unrecognized data. Review the scope below before relying on this report.</p>' : ''}
    <details class="unmatched" open><summary>Audit scope ${icon('chevron', 15)}</summary>
      <p>${report.scope.shopifyOrders} identifiable Shopify orders, ${report.scope.shopifyRows} Shopify records: ${report.scope.checkedRows} checked, ${report.scope.withoutOld} without old access, ${report.scope.excludedStatus} excluded by financial status, ${report.scope.unknownStatus} with blank or unrecognized financial status, ${report.scope.unidentified} incomplete or unidentified, ${report.scope.duplicates} repeated.</p>
      <p>${report.scope.oldRows} old-app records, ${report.scope.oldBuyers} identifiable old-app buyers, ${report.scope.unmatchedOld} unlinked old entitlements shown for review. Unlinked old entitlements are separate from the Shopify buyer counts.</p>
      ${report.scope.invalidOld || report.scope.invalidNew ? `<p>Records skipped for missing fields or inconsistent column counts: old app ${report.scope.invalidOld}; new app ${report.scope.invalidNew}.</p>` : ''}
    </details>
    <details class="result-guide" open>
      <summary>What to do next ${icon('chevron', 15)}</summary>
      <ol><li>Review flagged rows in Shopify and both download apps. Check the order, buyer, product or variant, and any refunds before restoring anything.</li>
      <li>Restore missing files or buyer access in the new app. Use the at-risk CSV as a restoration checklist, not as a mailing list. Use the one-row-per-buyer CSV only after verifying the recipients.</li>
      <li>Export fresh records and run the check again before retiring the old app. Verify representative download links in the new app; this report does not open them.</li></ol>
    </details>
    <div class="table-panel">
      <div class="table-heading"><div><h3>Download access</h3><p>Shopify line items and old-app records that could not be linked.</p></div><button class="button secondary" data-export="risk" type="button" ${report.atRiskBuyers ? '' : 'disabled'}>${icon('download', 16)} Download at-risk CSV</button></div>
      <div class="filters">
        <label class="search">${icon('search', 17)}<input type="search" id="query" placeholder="Search order, email, product…" aria-label="Search order, email, product or SKU"></label>
        <label class="status-selector"><span>Status</span><select id="status-filter"><option value="">All statuses</option><option>At risk</option><option value="Review">Needs review</option><option>Covered</option></select></label>
      </div>
      <div class="table-scroll" role="region" aria-label="Download access results" tabindex="0">
        <table><thead><tr>${reportColumns.map(([label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody id="findings"></tbody></table>
      </div>
      <div class="pagination"><p id="row-count" role="status">Loading results…</p><div><button class="button secondary" id="previous-page" type="button" disabled>Previous</button><button class="button secondary" id="next-page" type="button" disabled>Next</button></div></div>
    </div>
    <div class="report-exports">
      <button class="button secondary" data-export="review" type="button" ${report.hasReview ? '' : 'disabled'}>Download review CSV</button>
      <button class="button secondary" data-export="buyers" type="button" ${report.atRiskBuyers ? '' : 'disabled'}>Download one row per at-risk buyer</button>
      <button class="button secondary" data-export="summary" type="button">Download scope summary</button>
      <p id="export-message" role="status"></p>
    </div>`;
  const query = byId<HTMLInputElement>('query');
  const status = byId<HTMLSelectElement>('status-filter');
  const id = runId;
  const requestPage = (page: number) => {
    if (id !== runId) return;
    send({ type: 'page', id, token: ++pageToken, page, size: pageSize, query: query.value, status: status.value });
  };
  let searchTimer: ReturnType<typeof setTimeout>;
  query.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = setTimeout(() => requestPage(0), 160);
  });
  status.addEventListener('change', () => {
    window.clearTimeout(searchTimer);
    requestPage(0);
  });
  for (const [id, offset] of [['previous-page', -1], ['next-page', 1]] as const) {
    const button = byId<HTMLButtonElement>(id);
    button.addEventListener('click', () => requestPage(Number(button.dataset.page ?? 0) + offset));
  }
  for (const button of reportElement.querySelectorAll<HTMLButtonElement>('[data-export]')) {
    button.addEventListener('click', () => {
      byId('export-message').textContent = 'Preparing CSV…';
      send({ type: 'export', id, kind: button.dataset.export as ExportKind, context });
    });
  }
  requestPage(0);
}

function renderPage(rows: Finding[], total: number, page: number) {
  byId('findings').innerHTML = rows.map(finding => `<tr>${reportColumns.map(([label, field]) =>
    field === 'status' ? `<td data-field="status"><span class="status ${finding.status === 'Covered' ? 'covered' : 'risk'}">${finding.status === 'Review' ? 'Needs review' : finding.status}</span></td>` :
      `<td data-field="${field}" data-label="${label}" ${finding[field] ? '' : 'class="blank"'}>${escapeHTML(finding[field] || '—')}</td>`).join('')}</tr>`).join('') ||
    `<tr><td class="empty" colspan="${reportColumns.length}">No matching rows. Check the filters or review the audit scope.</td></tr>`;
  byId('row-count').textContent = total ? `Showing ${page * pageSize + 1}–${page * pageSize + rows.length} of ${total} rows` : 'No matching rows';
  const previous = byId<HTMLButtonElement>('previous-page');
  const next = byId<HTMLButtonElement>('next-page');
  previous.disabled = page === 0;
  next.disabled = (page + 1) * pageSize >= total;
  previous.dataset.page = next.dataset.page = String(page);
}

worker.addEventListener('message', ({ data: reply }: MessageEvent<Reply>) => {
  if (reply.type === 'loaded' || reply.type === 'loadError') {
    const { source, version } = reply;
    if (version !== loads[source]) return;
    if (reply.type === 'loaded') {
      data[source] = reply.info;
      renderSource(source);
    } else {
      renderSource(source, reply.message, byId(`name-${source}`).textContent ?? '');
    }
    syncControls();
    return;
  }
  if (reply.id !== runId || !runState) return;
  if (reply.type === 'report') {
    runState.busy = false;
    syncControls(false);
    renderReport(reply.summary, runState.context);
    byId('report-title').focus();
    byId('report-title').scrollIntoView({ block: 'start' });
  } else if (reply.type === 'page' && reply.token === pageToken) {
    renderPage(reply.rows, reply.total, reply.page);
  } else if (reply.type === 'export') {
    download(filenameFor(runState.context, reply.kind), reply.csv);
    byId('export-message').textContent = 'CSV ready.';
  } else if (reply.type === 'error') {
    runState.busy = false;
    syncControls(false);
    if (reply.operation === 'run') reportElement.innerHTML = `<p class="scope-warning" role="alert">${escapeHTML(reply.message)}</p>`;
    else byId(reply.operation === 'page' ? 'row-count' : 'export-message').textContent = reply.message;
  }
});

worker.addEventListener('error', () => {
  if (runState) runState.busy = false;
  syncControls(false);
  reportElement.innerHTML = '<p class="scope-warning" role="alert">The browser could not finish processing these files. Reload the page and try a smaller export.</p>';
});

run.addEventListener('click', () => {
  if (!data.old || !data.next || !data.orders || run.disabled) return;
  runState = { busy: true, context: { store: storeName.value.trim(), date: new Date().toISOString(), files: sources.map(source => data[source]!.name) } };
  syncControls(false);
  reportElement.innerHTML = '<p class="empty" role="status">Checking records in this browser. Large files may take a moment…</p>';
  send({ type: 'run', id: ++runId, mappings: { old: data.old.mapping, next: data.next.mapping, orders: data.orders.mapping } });
});
