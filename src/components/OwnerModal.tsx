import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  LogOut,
  Upload,
  X,
} from 'lucide-react';
import type { OwnerConfig } from '../types';
import { formatBytes } from '../utils/format';

interface OwnerModalProps {
  open: boolean;
  onClose: () => void;
  ownerConfig: OwnerConfig | null;
  onSaveConfig: (config: OwnerConfig | null) => void;
}

interface UploadItem {
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  message?: string;
}

const MAX_BROWSER_BYTES = 95 * 1024 * 1024; // 95 MB (GitHub max is 100 MB)

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
  const [commitStatus, setCommitStatus] = useState('');
  const [commitError, setCommitError] = useState('');
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
    setCommitStatus('');
    setCommitError('');
    setQueue(list.map((f) => ({ name: f.name, size: f.size, status: 'pending' })));

    const apiBase = `https://api.github.com/repos/${encodeURIComponent(
      ownerConfig.owner
    )}/${encodeURIComponent(ownerConfig.repo)}`;
    const headers = {
      Authorization: `Bearer ${ownerConfig.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };

    const uploadedBlobs: Array<{ idx: number; path: string; sha: string }> = [];

    // 1. Upload each file as a Git Blob (supports up to ~95 MB)
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setQueue((prev) =>
        prev.map((item, idx) =>
          idx === i ? { ...item, status: 'uploading', message: 'Uploading to GitHub…' } : item
        )
      );

      try {
        if (file.size > MAX_BROWSER_BYTES) {
          throw new Error('Exceeds 95 MB limit (GitHub max per file is 100 MB).');
        }

        const base64 = await fileToBase64(file);
        const blobRes = await fetch(`${apiBase}/git/blobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content: base64,
            encoding: 'base64',
          }),
        });

        if (!blobRes.ok) {
          const errBody = await blobRes.json().catch(() => ({}));
          throw new Error(errBody.message || `Blob upload failed (HTTP ${blobRes.status})`);
        }

        const blobData = await blobRes.json();
        const safeName = file.name.replace(/[/\\]/g, '_');
        uploadedBlobs.push({
          idx: i,
          path: `inbox/${safeName}`,
          sha: blobData.sha,
        });

        setQueue((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'uploading', message: 'Uploaded — waiting to commit…' } : item
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

    // 2. Commit all uploaded blobs in one single commit
    if (uploadedBlobs.length > 0) {
      setCommitStatus(`Committing ${uploadedBlobs.length} file(s) to inbox/…`);
      try {
        const refRes = await fetch(
          `${apiBase}/git/ref/heads/${encodeURIComponent(ownerConfig.branch)}`,
          { headers }
        );
        if (!refRes.ok) throw new Error(`Could not read branch "${ownerConfig.branch}"`);
        const refData = await refRes.json();
        const latestCommitSha: string = refData.object.sha;

        const commitRes = await fetch(`${apiBase}/git/commits/${latestCommitSha}`, { headers });
        if (!commitRes.ok) throw new Error('Could not read latest commit');
        const commitData = await commitRes.json();
        const baseTreeSha: string = commitData.tree.sha;

        const treeRes = await fetch(`${apiBase}/git/trees`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: uploadedBlobs.map((b) => ({
              path: b.path,
              mode: '100644',
              type: 'blob',
              sha: b.sha,
            })),
          }),
        });
        if (!treeRes.ok) throw new Error('Failed to create Git tree');
        const treeData = await treeRes.json();

        const newCommitRes = await fetch(`${apiBase}/git/commits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: `inbox: add ${uploadedBlobs.length} document(s) via Steno`,
            tree: treeData.sha,
            parents: [latestCommitSha],
          }),
        });
        if (!newCommitRes.ok) throw new Error('Failed to create Git commit');
        const newCommitData = await newCommitRes.json();

        const updateRefRes = await fetch(
          `${apiBase}/git/refs/heads/${encodeURIComponent(ownerConfig.branch)}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ sha: newCommitData.sha }),
          }
        );
        if (!updateRefRes.ok) {
          throw new Error('Branch updated while uploading—please retry once.');
        }

        const successIndexes = new Set(uploadedBlobs.map((b) => b.idx));
        setQueue((prev) =>
          prev.map((item, idx) =>
            successIndexes.has(idx)
              ? { ...item, status: 'done', message: 'Sent to inbox/ for Gemini sorting' }
              : item
          )
        );
        setCommitStatus(
          `Committed ${uploadedBlobs.length} file(s)! Open the Agents room to watch Gemini sort them live.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Commit failed';
        setCommitError(msg);
        setCommitStatus('');
        const failedIndexes = new Set(uploadedBlobs.map((b) => b.idx));
        setQueue((prev) =>
          prev.map((item, idx) =>
            failedIndexes.has(idx) ? { ...item, status: 'error', message: msg } : item
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
                  PDFs, images, Markdown, Word, PowerPoint, code, or zips (up to 95 MB each)
                </p>
              </div>

              {queue.length > 0 && (
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {queue.map((item, idx) => (
                    <div
                      key={`${item.name}-${idx}`}
                      className="flex items-center justify-between gap-3 bg-ivory border border-rule rounded-lg px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-ink truncate">
                          {item.name}{' '}
                          <span className="font-mono text-[11px] text-ink-muted font-normal">
                            ({formatBytes(item.size)})
                          </span>
                        </p>
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
                </div>
              )}

              {commitStatus && (
                <p className="text-[11px] font-mono text-ink bg-mint-soft border border-mint/40 rounded-lg px-3 py-2">
                  {commitStatus}
                </p>
              )}

              {commitError && (
                <p className="text-[11px] font-mono text-terracotta bg-terracotta-soft border border-terracotta/30 rounded-lg px-3 py-2">
                  {commitError}
                </p>
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
                    setCommitStatus('');
                    setCommitError('');
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