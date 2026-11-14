export type PreviewKind = 'pdf' | 'image' | 'markdown' | 'text' | 'other';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
const TEXT_EXTS = new Set([
  'txt', 'csv', 'json', 'js', 'ts', 'tsx', 'jsx', 'py', 'java',
  'c', 'cpp', 'h', 'html', 'css', 'sql', 'tex', 'yaml', 'yml', 'log',
]);

export function getPreviewKind(ext: string): PreviewKind {
  const e = ext.toLowerCase();
  if (e === 'pdf') return 'pdf';
  if (IMAGE_EXTS.has(e)) return 'image';
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (TEXT_EXTS.has(e)) return 'text';
  return 'other';
}

export function encodeDocUrl(docPath: string): string {
  const encoded = docPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `./${encoded}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}