import {
  Download,
  File,
  FileArchive,
  FileCode,
  FileText,
  Folder,
  Image as ImageIcon,
} from 'lucide-react';
import type { StenoDocument } from '../types';
import { encodeDocUrl, formatBytes, formatDate, getPreviewKind } from '../utils/format';

interface DocumentListProps {
  documents: StenoDocument[];
  onOpenDoc: (doc: StenoDocument) => void;
  onSelectTag: (tag: string) => void;
  selectedTags: string[];
}

function DocIcon({ ext }: { ext: string }) {
  const kind = getPreviewKind(ext);
  if (kind === 'image') return <ImageIcon className="w-4 h-4 text-terracotta" />;
  if (kind === 'pdf' || kind === 'markdown') return <FileText className="w-4 h-4 text-mint" />;
  if (kind === 'text') return <FileCode className="w-4 h-4 text-ink-muted" />;
  if (ext === 'zip' || ext === 'rar' || ext === '7z') {
    return <FileArchive className="w-4 h-4 text-ink-muted" />;
  }
  return <File className="w-4 h-4 text-ink-muted" />;
}

export function DocumentList({
  documents,
  onOpenDoc,
  onSelectTag,
  selectedTags,
}: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <div className="bg-paper border border-rule rounded-xl p-12 text-center shadow-xs">
        <p className="font-serif text-2xl text-ink">Nothing on this page yet</p>
        <p className="text-sm text-ink-muted mt-1.5 max-w-md mx-auto">
          Try clearing your search or filters, or drop a study file into{' '}
          <code className="font-mono text-xs bg-paper-warm px-1.5 py-0.5 rounded">inbox/</code>{' '}
          to let Steno sort it automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-paper border border-rule rounded-xl overflow-hidden shadow-xs divide-y divide-rule">
      {documents.map((doc) => (
        <div
          key={doc.id}
          onClick={() => onOpenDoc(doc)}
          className="group px-5 py-4 hover:bg-ivory/70 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-paper-warm border border-rule/70 flex items-center justify-center shrink-0">
                <DocIcon ext={doc.ext} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium text-ink group-hover:text-terracotta transition-colors truncate">
                    {doc.title}
                  </h3>
                  <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-paper-warm text-ink-muted border border-rule/70 shrink-0">
                    {doc.ext}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-muted mt-0.5">
                  <span className="inline-flex items-center gap-1">
                    <Folder className="w-3 h-3 text-mint" />
                    {doc.folder}
                  </span>
                  <span>•</span>
                  <span className="font-mono text-[11px]">{formatBytes(doc.size)}</span>
                  {doc.addedAt && (
                    <>
                      <span className="hidden sm:inline">•</span>
                      <span className="hidden sm:inline font-mono text-[11px]">
                        {formatDate(doc.addedAt)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {doc.summary && (
              <p className="text-sm text-ink-muted mt-2 pl-10.5 line-clamp-2">
                {doc.summary}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 pl-10.5 sm:pl-0 shrink-0 flex-wrap">
            {doc.tags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTag(tag);
                  }}
                  className={`font-mono text-[11px] px-2 py-0.5 rounded border transition-colors ${
                    active
                      ? 'bg-terracotta text-paper border-terracotta'
                      : 'bg-ivory text-ink-muted border-rule hover:border-mint hover:text-ink'
                  }`}
                >
                  #{tag}
                </button>
              );
            })}

            <a
              href={encodeDocUrl(doc.path)}
              download={doc.filename}
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-paper-warm border border-transparent hover:border-rule transition-colors"
              title={`Download ${doc.filename}`}
              aria-label={`Download ${doc.filename}`}
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}