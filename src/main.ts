import Papa from 'papaparse';
import { audit, type Finding, type Report } from './audit';
import { fields, missingFields, parseCsv, type Dataset, type Field, type Source } from './csv';
import { icon } from './icons';
import { samples } from './samples';
import './style.css';

const sources = ['old', 'next', 'orders'] as const;
const details = {
  old: { title: 'Old download app', hint: 'Entitlements from your old app', icon: 'archive', sample: 'SendOwl' },
  next: { title: 'New download app', hint: 'Entitlements in your new app', icon: 'package', sample: 'Alva' },
  orders: { title: 'Shopify orders', hint: 'Your Shopify orders export', icon: 'receipt', sample: 'Shopify orders' },
} as const;
const labels: Record<Field, string> = {
  order: 'Order number', email: 'Buyer email', product: 'Product name', sku: 'SKU', status: 'Financial status', date: 'Order date',
  assetId: 'Asset ID', variant: 'Variant', access: 'Access status', externalOrder: 'Provider order ID', gateway: 'Gateway',
  cancelled: 'Cancelled at', orderId: 'Shopify order ID', lineId: 'Shopify line ID', quantity: 'Quantity', store: 'Store',
};
const data: Partial<Record<Source, Dataset>> = {};
const loads: Record<Source, number> = { old: 0, next: 0, orders: 0 };

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
      <div class="source-grid">
        ${sources.map(source => {
          const info = details[source];
          return `<article class="source-card">
            <span class="source-icon">${icon(info.icon, 21)}</span>
            <h3>${info.title}</h3><p>${info.hint}</p>
            <label class="file-drop" id="drop-${source}">
              <input id="file-${source}" type="file" accept=".csv,text/csv" aria-label="Choose CSV for ${info.title}">
              <span id="file-label-${source}">${icon('upload', 17)} <strong>Choose CSV</strong></span>
            </label>
            <div class="source-message" id="message-${source}" role="status"></div>
            <div id="map-${source}"></div>
            <button class="sample-link" id="download-${source}" type="button">${icon('download', 14)} ${info.sample} sample CSV</button>
          </article>`;
        }).join('')}
      </div>
      <div class="action-row">
        <p class="privacy-note">${icon('shield', 18)} Files stay in this browser and are never uploaded.</p>
        <div class="run-area"><p id="file-count" role="status">0 of 3 files ready</p><button class="button primary" id="run" type="button" disabled>Run migration check ${icon('arrow', 17)}</button></div>
      </div>
    </section>
    <section class="step results" aria-labelledby="report-title">
      <div class="step-heading"><span class="step-number">02</span><div><h2 id="report-title" tabindex="-1">Review the report</h2><p>See who still has access and who needs their downloads restored.</p></div></div>
      <div id="report"><p class="empty">Add all three CSVs and run the migration check to see results here.</p></div>
    </section>
  </main>
  <footer class="site-footer"><div class="frame footer-content"><span>Download Migration Check</span><a href="https://app.devin.ai/sessions/03f45bc59d0f4e62a192801b51c52643" target="_blank" rel="noopener noreferrer">Request changes ${icon('external', 13)}</a></div></footer>
`;

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const run = byId<HTMLButtonElement>('run');
const reportElement = byId('report');
let hasReport = false;

function syncControls() {
  const ready = sources.filter(source => data[source] && !missingFields(data[source].mapping, source).length).length;
  byId('file-count').textContent = `${ready} of 3 files ready`;
  run.disabled = ready !== 3;
  if (hasReport) reportElement.innerHTML = '<p class="empty">Files or mappings changed. Run the migration check again to update the report.</p>';
  hasReport = false;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSource(source: Source, error = '') {
  const file = data[source];
  const drop = byId(`drop-${source}`);
  drop.classList.toggle('ready', !!file);
  const label = byId(`file-label-${source}`);
  label.innerHTML = file ? `${icon('check', 17)} <strong>${escapeHTML(file.name)}</strong>` : `${icon('upload', 17)} <strong>Choose CSV</strong>`;
  if (file) label.title = file.name;
  else label.removeAttribute('title');
  const panel = byId(`map-${source}`);
  const missing = file ? missingFields(file.mapping, source) : [];
  byId(`message-${source}`).textContent = error || (missing.length ? `Map ${missing.join(', ')} to continue.` : '');
  panel.innerHTML = file ? `
    <details class="mapping" ${missing.length ? 'open' : ''}>
      <summary>Map columns ${icon('chevron', 14)}</summary>
      <div class="mapping-fields">
        ${fields[source].map(field => `<label>${labels[field]}<select data-field="${field}"><option value="">Not mapped</option>${file.headers.map((header, index) =>
          `<option value="${index}" ${file.mapping[field] === index ? 'selected' : ''}>${escapeHTML(header || `Column ${index + 1}`)}</option>`).join('')}</select></label>`).join('')}
      </div>
    </details>` : '';
  for (const select of panel.querySelectorAll<HTMLSelectElement>('select')) {
    select.addEventListener('change', () => {
      if (!file) return;
      const field = select.dataset.field as Field;
      if (select.value === '') delete file.mapping[field];
      else file.mapping[field] = Number(select.value);
      const unmapped = missingFields(file.mapping, source);
      byId(`message-${source}`).textContent = unmapped.length ? `Map ${unmapped.join(', ')} to continue.` : '';
      syncControls();
    });
  }
}

function setSource(source: Source, text: string, name: string) {
  try {
    data[source] = parseCsv(text, name, source);
    renderSource(source);
  } catch (error) {
    delete data[source];
    renderSource(source, error instanceof Error ? error.message : 'Could not read this CSV.');
  }
  syncControls();
}

for (const source of sources) {
  const input = byId<HTMLInputElement>(`file-${source}`);
  byId(`download-${source}`).addEventListener('click', () => download(samples[source].name, samples[source].text));
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    const load = ++loads[source];
    delete data[source];
    renderSource(source, 'Reading CSV…');
    syncControls();
    try {
      const text = await file.text();
      if (load === loads[source]) setSource(source, text, file.name);
    } catch {
      if (load !== loads[source]) return;
      renderSource(source, 'Could not read this CSV.');
      syncControls();
    }
  });
}

byId('load-sample').addEventListener('click', () => {
  for (const source of sources) {
    loads[source]++;
    const sample = samples[source];
    setSource(source, sample.text, sample.name);
  }
});

const reportColumns = [
  ['Order', 'order'], ['Buyer email', 'email'], ['Product', 'product'], ['SKU', 'sku'], ['Status', 'status'],
  ['Reason', 'reason'], ['Candidate', 'candidate'], ['Old file IDs', 'oldAssets'], ['Matched by', 'matchedBy'], ['Order date', 'date'],
] as const satisfies ReadonlyArray<readonly [string, keyof Finding]>;

function renderReport(report: Report) {
  const metrics = [
    ['Buyers checked', report.buyersChecked, 'Paid orders with old access', 'neutral'],
    ['Covered', report.coveredBuyers, 'All checked downloads matched', 'green'],
    ['At risk', report.atRiskBuyers, 'At least one download missing', 'amber'],
    ['Needs review', report.reviewBuyers, 'Coverage not verified', 'amber'],
    ['Unmatched products', report.unmatchedProducts.length, 'Old-app products not matched to Shopify', 'neutral'],
  ] as const;
  reportElement.innerHTML = `
    <div class="metrics">${metrics.map(([label, value, hint, tone]) => `<div class="metric ${tone}"><div>${label}</div><strong>${value}</strong><p>${hint}</p></div>`).join('')}</div>
    ${report.unmatchedProducts.length ? `<details class="unmatched"><summary>View unmatched products ${icon('chevron', 15)}</summary><ul>${report.unmatchedProducts.map(product => `<li>${escapeHTML(product)}</li>`).join('')}</ul></details>` : ''}
    <div class="table-panel">
      <div class="table-heading"><div><h3>Download access</h3><p>One row per checked Shopify line item.</p></div><button class="button secondary" id="export" type="button" ${report.atRiskBuyers ? '' : 'disabled'}>${icon('download', 16)} Download at-risk CSV</button></div>
      <div class="filters">
        <label class="search">${icon('search', 17)}<input type="search" id="query" placeholder="Search order, email, product…" aria-label="Search order, email, product or SKU"></label>
        <label class="status-selector"><span>Status</span><select id="status-filter"><option value="">All statuses</option><option>At risk</option><option>Review</option><option>Covered</option></select></label>
      </div>
      <div class="table-scroll" role="region" aria-label="Download access results" tabindex="0">
        <table><thead><tr>${reportColumns.map(([label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody id="findings"></tbody></table>
      </div>
      <p class="row-count" id="row-count" role="status"></p>
    </div>`;
  const query = byId<HTMLInputElement>('query');
  const status = byId<HTMLSelectElement>('status-filter');
  const renderRows = () => {
    const term = query.value.trim().toLowerCase();
    const visible = report.findings.filter(finding => (!status.value || status.value === finding.status) &&
      [finding.order, finding.email, finding.product, finding.sku, finding.candidate, finding.reason].some(value => value.toLowerCase().includes(term)));
    byId('findings').innerHTML = visible.map(finding => `<tr>${reportColumns.map(([, field]) =>
      field === 'status' ? `<td><span class="status ${finding.status === 'Covered' ? 'covered' : 'risk'}">${finding.status}</span></td>` :
        `<td>${escapeHTML(finding[field] || '—')}</td>`).join('')}</tr>`).join('') ||
      `<tr><td class="empty" colspan="${reportColumns.length}">${report.findings.length ? 'No matching rows.' : 'No paid Shopify line items matched the old app export. Check your files and mappings.'}</td></tr>`;
    byId('row-count').textContent = `Showing ${visible.length} of ${report.findings.length} rows`;
  };
  query.addEventListener('input', renderRows);
  status.addEventListener('change', renderRows);
  byId('export').addEventListener('click', () => {
    const rows = report.findings.filter(finding => finding.status === 'At risk');
    const csv = Papa.unparse({ fields: reportColumns.map(([label]) => label), data: rows.map(row => reportColumns.map(([, field]) => row[field])) }, { escapeFormulae: true });
    download('at-risk-downloads.csv', csv);
  });
  renderRows();
}

run.addEventListener('click', () => {
  if (!data.old || !data.next || !data.orders || run.disabled) return;
  renderReport(audit(data.old, data.next, data.orders));
  hasReport = true;
  byId('report-title').focus();
  byId('report-title').scrollIntoView({ block: 'start' });
});
