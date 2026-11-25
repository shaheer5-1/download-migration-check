import { audit, type Finding, type Report } from './audit';
import { checkSlot, decodeCsv, parseCsv, storeMismatch, type Dataset, type Mapping, type Source } from './csv';
import { exportReport, filterRows, type ExportKind, type ReportSummary, type RunContext } from './report';

export type FileInfo = Omit<Dataset, 'rows' | 'rowLines'> & { rowCount: number };
export type Request =
  | { type: 'load'; source: Source; version: number; file: File | string; name: string }
  | { type: 'clear'; source: Source; version: number }
  | { type: 'run'; id: number; mappings: Record<Source, Mapping> }
  | { type: 'page'; id: number; token: number; page: number; size: number; query: string; status: string }
  | { type: 'export'; id: number; kind: ExportKind; context: RunContext };
export type Reply =
  | { type: 'loaded'; source: Source; version: number; info: FileInfo }
  | { type: 'loadError'; source: Source; version: number; message: string }
  | { type: 'report'; id: number; summary: ReportSummary }
  | { type: 'page'; id: number; token: number; rows: Finding[]; total: number; page: number }
  | { type: 'export'; id: number; kind: ExportKind; csv: string }
  | { type: 'error'; id: number; operation: 'run' | 'page' | 'export'; message: string };

const send = (reply: Reply) => self.postMessage(reply);
const datasets: Partial<Record<Source, Dataset>> = {};
const versions: Record<Source, number> = { old: 0, next: 0, orders: 0 };
let current: { id: number; report: Report } | undefined;
let filter: { query: string; status: string; rows: Finding[] } | undefined;

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if (data.type === 'load' || data.type === 'clear') {
    const { source, version } = data;
    versions[source] = version;
    delete datasets[source];
    current = undefined;
    filter = undefined;
    if (data.type === 'clear') return;
    try {
      const text = typeof data.file === 'string' ? data.file : decodeCsv(await data.file.arrayBuffer());
      if (versions[source] !== version) return;
      const file = parseCsv(text, data.name, source);
      checkSlot(file, source);
      datasets[source] = file;
      const { rows, rowLines, ...metadata } = file;
      send({ type: 'loaded', source, version, info: { ...metadata, rowCount: rows.length } });
    } catch (error) {
      if (versions[source] === version) send({ type: 'loadError', source, version, message: error instanceof Error ? error.message : 'Could not read this CSV.' });
    }
    return;
  }
  try {
    if (data.type === 'run') {
      const { old, next, orders } = datasets;
      if (!old || !next || !orders) throw new Error('Add all three files before running the check.');
      old.mapping = data.mappings.old;
      next.mapping = data.mappings.next;
      orders.mapping = data.mappings.orders;
      if (storeMismatch([old, next, orders])) throw new Error('Store identifiers disagree across these CSVs. Replace any export that belongs to a different store and try again.');
      const report = audit(old, next, orders);
      current = { id: data.id, report };
      filter = undefined;
      const { findings, ...summary } = report;
      send({ type: 'report', id: data.id, summary: { ...summary, rowCount: findings.length, hasReview: findings.some(row => row.status === 'Review') } });
      return;
    }
    if (!current || current.id !== data.id) return;
    if (data.type === 'page') {
      const { query, status, size, token } = data;
      if (!filter || filter.query !== query || filter.status !== status) filter = { query, status, rows: filterRows(current.report.findings, query, status) };
      const total = filter.rows.length;
      const page = Math.max(0, Math.min(data.page, Math.ceil(total / size) - 1));
      send({ type: 'page', id: data.id, token, total, page, rows: filter.rows.slice(page * size, (page + 1) * size) });
    } else {
      send({ type: 'export', id: data.id, kind: data.kind, csv: exportReport(current.report, data.context, data.kind) });
    }
  } catch (error) {
    send({ type: 'error', id: data.id, operation: data.type, message: error instanceof Error ? error.message : 'Something went wrong. Please try again.' });
  }
};
