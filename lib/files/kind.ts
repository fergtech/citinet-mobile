import type { IconSymbolName } from '@/components/ui/icon-symbol';
import type { FileKind } from '@/lib/api/types';

// hub_files has no kind/category column at all — this mirrors citinet web's
// own FilesScreen, which maps extension + mime_type to a badge/icon
// client-side rather than trusting a server-provided field that doesn't exist.
const EXT_KIND: Record<string, FileKind> = {
  doc: 'doc', docx: 'doc', rtf: 'doc', odt: 'doc', txt: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet',
  ppt: 'slides', pptx: 'slides', key: 'slides', odp: 'slides',
  zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip',
};

export function fileKind(fileName: string, mimeType: string | null): FileKind {
  const mime = mimeType ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  return EXT_KIND[ext] ?? 'other';
}

export const FILE_KIND_META: Record<FileKind, { label: string; color: string; icon: IconSymbolName }> = {
  pdf: { label: 'PDF', color: '#dc2626', icon: 'doc.fill' },
  doc: { label: 'Document', color: '#2563eb', icon: 'doc.text.fill' },
  sheet: { label: 'Spreadsheet', color: '#059669', icon: 'tablecells.fill' },
  slides: { label: 'Presentation', color: '#d97706', icon: 'rectangle.fill.on.rectangle.fill' },
  image: { label: 'Image', color: '#c026d3', icon: 'photo.fill' },
  video: { label: 'Video', color: '#7c3aed', icon: 'video.fill' },
  audio: { label: 'Audio', color: '#0891b2', icon: 'waveform' },
  zip: { label: 'Archive', color: '#64748b', icon: 'archivebox.fill' },
  other: { label: 'File', color: '#64748b', icon: 'doc' },
};

// Matches citinet web's own preview gating (image/video/audio/pdf get an
// in-app viewer, everything else is download-to-open) — not a mobile
// simplification, the real web client draws this same line.
export function isPreviewable(kind: FileKind): boolean {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf';
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
