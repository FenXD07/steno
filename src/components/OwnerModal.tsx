import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  LogOut,
  Upload,
  X,
} from 'lucide-react';
import type { OwnerConfig } from '../types';

interface OwnerModalProps {
  open: boolean;
  onClose: () => void;
  ownerConfig: OwnerConfig | null;
  onSaveConfig: (config: OwnerConfig | null) => void;
}

interface UploadItem {
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  message?: string;
}

function guessGitHubRepo(): { owner: string; repo: string } {
  const host = window.location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    const firstSeg = window.location.pathname.split('/').filter(Boolean)[0] || '';
    return { owner, repo: firstSeg || 'steno' };
  }
  return { owner: '', repo: 'steno' };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) return reject(new Error('Failed to encode file'));
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function OwnerModal({
  open,
  onClose,
  ownerConfig,
  onSaveConfig,
}: OwnerModalProps) {
  const guessed = guessGitHubRepo();
  const [owner, setOwner] = useState(ownerConfig?.owner || guessed.owner);
  const [repo, setRepo] = useState(ownerConfig?.repo || guessed.repo);
  const [branch, setBranch] = useState(ownerConfig?.branch || 'main');
  const [token, setToken] = useState(ownerConfig?.token || '');
  const [authError, setAuthError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setAuthError('');
  }, [open]);

  if (!open) return null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim();
    const cleanBranch = branch.trim() || 'main';
    const cleanToken = token.trim();

    if (!cleanOwner || !cleanRepo || !cleanToken) {
      setAuthError('Please fill in your GitHub username, repo name, and token.');
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(cleanOwner)}/${encodeURIComponent(cleanRepo)}`,
        {
          headers: {
            Authorization: `Bearer ${cleanToken}`,
            Accept: 'application/vnd.github+json',
          },
        }
      );

      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? 'Invalid GitHub token.'
            : res.status === 404
            ? 'Repository not found (or token lacks access).'
            : `GitHub returned HTTP ${res.status}.`
        );
      }

      const data = await res.json();
      if (data.permissions && data.permissions.push === false) {
        throw new Error('This token does not have write (Contents) permission on this repo.');
      }

      onSaveConfig({
        owner: cleanOwner,
        repo: cleanRepo,
        branch: cleanBranch,
        token: cleanToken,
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!ownerConfig || uploading) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    setUploading(true);
    setQueue(list.map((f) => ({ name: f.name, status: 'pending' })));

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setQueue((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: 'uploading' } : item))
      );

      try {
        if (file.size > 25 * 1024 * 1024) {
          throw new Error('File exceeds 25 MB browser upload limit. Push via Git instead.');
        }

        const base64 = await fileToBase64(file);
        const safeName = file.name.replace(/[/\\]/g, '_');
        const apiUrl = `https://api.github.com/repos/${encodeURIComponent(
          ownerConfig.owner
        )}/${encodeURIComponent(ownerConfig.repo)}/contents/inbox/${encodeURIComponent(safeName)}`;

        // Check if file already exists in inbox/ to include sha if needed
        let existingSha: string | undefined;
        const headRes = await fetch(
          `${apiUrl}?ref=${encodeURIComponent(ownerConfig.branch)}`,
          {
            headers: {
              Authorization: `Bearer ${ownerConfig.token}`,
              Accept: 'application/vnd.github+json',
            },
          }
        );
        if (headRes.ok) {
          const existing = await headRes.json();
          existingSha = existing.sha;
        }

        const putRes = await fetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${ownerConfig.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `inbox: add ${safeName} via Steno`,
            content: base64,
            branch: ownerConfig.branch,
            ...(existingSha ? { sha: existingSha } : {}),
          }),
        });

        if (!putRes.ok) {
          const errBody = await putRes.json().catch(() => ({}));
          throw new Error(errBody.message || `Upload failed (HTTP ${putRes.status})`);
        }

        setQueue((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? { ...item, status: 'done', message: 'Sent to inbox/ for Gemini sorting' }
              : item
          )
        );
      } catch (err) {
        setQueue((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                  ...item,
                  status: 'error',
                  message: err instanceof Error ? err.message : 'Upload failed',
                }
              : item
          )
        );
      }
    }

    setUploading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-paper border border-rule rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-rule bg-ivory/70 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-2xl text-ink leading-none">
              {ownerConfig ? 'Add Documents to Steno' : 'Owner Mode Sign-In'}
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              {ownerConfig
                ? `Connected to ${ownerConfig.owner}/${ownerConfig.repo}`
                : 'Stored only in your browser so only you can upload.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-paper-warm"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          {!ownerConfig ? (
            <form onSubmit={handleConnect} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[11px] uppercase text-ink-muted mb-1">
                    GitHub Username
                  </label>
                  <input
                    type="text"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="your-username"
                    className="w-full bg-ivory border border-rule rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-mint"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[11px] uppercase text-ink-muted mb-1">
                    Repository
                  </label>
                  <input
                    type="text"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="steno"
                    className="w-full bg-ivory border border-rule rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-mint"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase text-ink-muted mb-1">
                  Branch
                </label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-ivory border border-rule rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-mint"
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase text-ink-muted mb-1">
                  Fine-Grained GitHub Token (Contents: Read & Write)
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="github_pat_..."
                  className="w-full bg-ivory border border-rule rounded-lg px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-mint"
                />
              </div>

              {authError && (
                <p className="text-xs text-terracotta bg-terracotta-soft border border-terracotta/30 rounded-lg px-3 py-2">
                  {authError}
                </p>
              )}

              <button
                type="submit"
                disabled={verifying}
                className="w-full inline-flex items-center justify-center gap-2 bg-ink text-ivory py-2.5 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                {verifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                {verifying ? 'Verifying…' : 'Unlock Owner Mode'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragging
                    ? 'border-mint bg-mint-soft/50'
                    : 'border-rule bg-ivory/60 hover:border-mint hover:bg-ivory'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) uploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="w-11 h-11 rounded-full bg-paper border border-rule flex items-center justify-center mx-auto mb-3">
                  <Upload className="w-5 h-5 text-mint" />
                </div>
                <p className="text-sm font-medium text-ink">
                  Drop study files here, or click to browse
                </p>
                <p className="text-xs text-ink-muted mt-1">
                  PDFs, images, Markdown, Word, PowerPoint, code, or zips (up to 25 MB)
                </p>
              </div>

              {queue.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {queue.map((item, idx) => (
                    <div
                      key={`${item.name}-${idx}`}
                      className="flex items-center justify-between gap-3 bg-ivory border border-rule rounded-lg px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-ink truncate">{item.name}</p>
                        {item.message && (
                          <p
                            className={`mt-0.5 ${
                              item.status === 'error' ? 'text-terracotta' : 'text-ink-muted'
                            }`}
                          >
                            {item.message}
                          </p>
                        )}
                      </div>
                      {item.status === 'uploading' && (
                        <Loader2 className="w-4 h-4 text-mint animate-spin shrink-0" />
                      )}
                      {item.status === 'done' && (
                        <CheckCircle2 className="w-4 h-4 text-mint shrink-0" />
                      )}
                      {item.status === 'error' && (
                        <AlertCircle className="w-4 h-4 text-terracotta shrink-0" />
                      )}
                    </div>
                  ))}
                  {!uploading && queue.some((q) => q.status === 'done') && (
                    <p className="text-[11px] font-mono text-ink-muted pt-1">
                      GitHub Actions + Gemini are sorting your files now. Refresh in ~45 seconds to see them appear.
                    </p>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-rule flex items-center justify-between">
                <span className="text-[11px] font-mono text-ink-muted">
                  Token saved locally on this browser
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onSaveConfig(null);
                    setToken('');
                    setQueue([]);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-terracotta hover:underline"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}