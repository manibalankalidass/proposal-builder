/**
 * Cross-user export / import for saved Templates, Designs, and Components.
 *
 * A user can export any saved item to a small `.bflow.json` file and share it;
 * another user imports that file to add it to their own library. The file is a
 * self-describing, versioned envelope so imports can be validated and migrated.
 */

export const EXPORT_FORMAT = 'brochureflow.export';
export const EXPORT_VERSION = 1;

export type ExportType = 'template' | 'design' | 'component';

export interface ExportItem {
  name: string;
  html: string;
  thumbnail?: string;
  kind?: 'single' | 'group';
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  type: ExportType;
  exportedAt: number;
  items: ExportItem[];
}

/** Wrap one or more items in a versioned export envelope. */
export function buildExportFile(type: ExportType, items: ExportItem[]): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    type,
    exportedAt: Date.now(),
    items: items.map((i) => ({
      name: i.name || 'Untitled',
      html: i.html,
      thumbnail: i.thumbnail || '',
      ...(i.kind ? { kind: i.kind } : {}),
    })),
  };
}

/** Trigger a browser download of `data` as pretty-printed JSON. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Make a safe filename fragment from an item name. */
export function sanitizeFilename(name: string): string {
  return (name || 'export').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export';
}

/** Parse + validate an imported file's text. Throws a friendly error on bad input. */
export function parseImportFile(text: string): ExportFile {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error('Not a valid JSON file.'); }
  if (!data || data.format !== EXPORT_FORMAT) {
    throw new Error('This file is not a BrochureFlow export.');
  }
  if ((data.version || 0) > EXPORT_VERSION) {
    throw new Error('This file was made with a newer version. Please update the editor.');
  }
  if (!['template', 'design', 'component'].includes(data.type)) {
    throw new Error('Unknown export type in the file.');
  }
  const items = Array.isArray(data.items)
    ? data.items.filter((it: any) => it && typeof it.html === 'string' && it.html.trim().length)
    : [];
  if (!items.length) throw new Error('No usable items found in the file.');
  return { ...data, items } as ExportFile;
}

/** Read a File object as UTF-8 text. */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsText(file);
  });
}
