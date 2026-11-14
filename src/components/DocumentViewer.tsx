import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  File,
  Folder,
  X,
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { StenoDocument } from '../types';
import { encodeDocUrl, formatBytes, formatDate, getPreviewKind } from '../utils/format';

interface DocumentViewerProps {
  doc: StenoDocument | null;
  onClose: () => void;
}

export function DocumentViewer({ doc, onClose }: DocumentViewerProps) {
  const [textContent, setTextContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const kind = doc ? getPreviewKind(doc.ext) : 'other';
  const docUrl = doc ? encodeDocUrl(doc.path) : '';

  useEffect(() => {
    if (!doc) return;
    setError('');
    setTextContent('');
    setCopied(false);

    if (kind === 'markdown' || kind === 'text') {
      setLoading(true);
      fetch(docUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((txt) => setTextContent(txt))
        .catch(() => setError('Could not load file preview. Try downloading instead.'))
        .finally(() => setLoading(false));
    }
  }, [doc, docUrl, kind]);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, onClose]);

  const renderedMarkdown = useMemo(() => {
    if (kind !== 'markdown' || !textContent) return '';
    const rawHtml = marked.parse(textContent, { async: false }) as string;
    return DOMPurify.sanitize(rawHtml);
  }, [kind, textContent]);

  if (!doc) return null;

  const handleCopy = async () => {
    if (!textContent) return;
    await navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-paper border border-rule rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-rule bg-ivory/70 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl text-ink truncate leading-tight">
              {doc.title}
            </h2>
            <div className="flex items-center gap-2 text-xs text-ink-muted mt-0.5 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Folder className="w-3 h-3 text-mint" />
                {doc.folder}
              </span>
              <span>•</span>
              <span className="font-mono">{doc.filename}</span>
              <span>•</span>
              <span className="font-mono">{formatBytes(doc.size)}</span>
              {doc.addedAt && (
                <>
                  <span>•</span>
                  <span className="font-mono">{formatDate(doc.addedAt)}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {(kind === 'markdown' || kind === 'text') && textContent && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-rule bg-paper text-ink-muted hover:text-ink hover:bg-paper-warm transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-mint" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}

            <a
              href={docUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-rule bg-paper text-ink-muted hover:text-ink hover:bg-paper-warm transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open
            </a>

            <a
              href={docUrl}
              download={doc.filename}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-ink text-ivory hover:opacity-90 transition-opacity"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-paper-warm transition-colors"
              aria-label="Close preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-ivory/40">
          {kind === 'pdf' && (
            <iframe
              src={docUrl}
              title={doc.title}
              className="w-full h-[75vh] border-0 bg-paper"
            />
          )}

          {kind === 'image' && (
            <div className="p-6 flex items-center justify-center min-h-[50vh]">
              <img
                src={docUrl}
                alt={doc.title}
                className="max-w-full max-h-[72vh] rounded-lg border border-rule shadow-sm object-contain bg-paper"
              />
            </div>
          )}

          {kind === 'markdown' && (
            <div className="p-6 sm:p-10 max-w-3xl mx-auto bg-paper min-h-full border-x border-rule/50">
              {loading && <p className="text-sm text-ink-muted">Loading note…</p>}
              {error && <p className="text-sm text-terracotta">{error}</p>}
              {!loading && !error && (
                <div
                  className="steno-prose"
                  dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
                />
              )}
            </div>
          )}

          {kind === 'text' && (
            <div className="p-6 max-w-4xl mx-auto">
              {loading && <p className="text-sm text-ink-muted">Loading file…</p>}
              {error && <p className="text-sm text-terracotta">{error}</p>}
              {!loading && !error && (
                <pre className="bg-paper border border-rule rounded-lg p-5 font-mono text-xs sm:text-sm text-ink overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {textContent}
                </pre>
              )}
            </div>
          )}

          {kind === 'other' && (
            <div className="p-10 flex flex-col items-center justify-center text-center min-h-[45vh]">
              <div className="w-16 h-16 rounded-2xl bg-paper border border-rule flex items-center justify-center mb-4 shadow-xs">
                <File className="w-7 h-7 text-mint" />
              </div>
              <h3 className="font-serif text-2xl text-ink">{doc.filename}</h3>
              {doc.summary && (
                <p className="text-sm text-ink-muted max-w-md mt-2 leading-relaxed">
                  {doc.summary}
                </p>
              )}
              <div className="flex items-center gap-1.5 mt-4 flex-wrap justify-center">
                {doc.tags.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[11px] px-2 py-0.5 rounded bg-paper border border-rule text-ink-muted"
                  >
                    #{t}
                  </span>
                ))}
              </div>
              <p className="text-xs text-ink-muted mt-5">
                Inline preview isn’t supported for <span className="font-mono">.{doc.ext}</span> files.
              </p>
              <a
                href={docUrl}
                download={doc.filename}
                className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-ink text-ivory text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Download className="w-4 h-4" />
                Download {doc.filename} ({formatBytes(doc.size)})
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}