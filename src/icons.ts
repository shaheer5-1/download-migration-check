const paths = {
  migration: '<path d="M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  flask: '<path d="M9 3h6m-5 0v7L5.1 18.3A1.8 1.8 0 0 0 6.6 21h10.8a1.8 1.8 0 0 0 1.5-2.7L14 10V3M8 15h8"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9m-9 4h4"/>',
  package: '<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4m-9 4-9-4m9 4v9M7.5 5.5l9 4.5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/>',
  external: '<path d="M13 4h7v7m0-7-9 9m6 0v7H4V7h7"/>',
  shield: '<path d="M12 22s7-4 7-10V5l-7-3-7 3v7c0 6 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>',
} as const;

export function icon(name: keyof typeof paths, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
