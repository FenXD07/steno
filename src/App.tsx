import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Lock, Menu, Search, Unlock, Upload, X } from 'lucide-react';
import type { FolderNode, OwnerConfig, StenoDocument, StenoManifest } from './types';
import { Sidebar } from './components/Sidebar';
import { DocumentList } from './components/DocumentList';
import { DocumentViewer } from './components/DocumentViewer';
import { OwnerModal } from './components/OwnerModal';
import { AgentRoomModal } from './components/AgentRoomModal';

const OWNER_STORAGE_KEY = 'steno_owner_config_v1';

function buildFolderTree(docs: StenoDocument[]): FolderNode[] {
  const root: FolderNode[] = [];

  for (const doc of docs) {
    const parts = doc.folder.split('/').filter(Boolean);
    let currentLevel = root;
    let builtPath = '';

    for (const part of parts) {
      builtPath = builtPath ? `${builtPath}/${part}` : part;
      let existing = currentLevel.find((n) => n.name === part);
      if (!existing) {
        existing = { name: part, fullPath: builtPath, count: 0, children: [] };
        currentLevel.push(existing);
      }
      existing.count += 1;
      currentLevel = existing.children;
    }
  }

  const sortTree = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(root);
  return root;
}

export default function App() {
  const [manifest, setManifest] = useState<StenoManifest>({ generatedAt: '', documents: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [activeDoc, setActiveDoc] = useState<StenoDocument | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [ownerConfig, setOwnerConfig] = useState<OwnerConfig | null>(() => {
    try {
      const saved = localStorage.getItem(OWNER_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [agentRoomOpen, setAgentRoomOpen] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ seq: number; files: string[] } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('./manifest.json')
      .then((res) => res.json())
      .then((data: StenoManifest) => setManifest(data))
      .catch(() => setManifest({ generatedAt: '', documents: [] }))
      .finally(() => setLoading(false));
  }, []);

  // Press '/' to jump to search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const folderTree = useMemo(() => buildFolderTree(manifest.documents), [manifest.documents]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of manifest.documents) {
      for (const tag of doc.tags) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [manifest.documents]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return manifest.documents.filter((doc) => {
      if (selectedFolder) {
        const matchesFolder =
          doc.folder === selectedFolder || doc.folder.startsWith(`${selectedFolder}/`);
        if (!matchesFolder) return false;
      }
      if (selectedTags.length > 0) {
        const hasAll = selectedTags.every((t) => doc.tags.includes(t));
        if (!hasAll) return false;
      }
      if (q) {
        const haystack = [
          doc.title,
          doc.filename,
          doc.folder,
          doc.summary,
          ...doc.tags,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [manifest.documents, search, selectedFolder, selectedTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const clearFilters = () => {
    setSelectedFolder(null);
    setSelectedTags([]);
    setSearch('');
  };

  const handleSaveOwnerConfig = (cfg: OwnerConfig | null) => {
    setOwnerConfig(cfg);
    if (cfg) {
      localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(cfg));
    } else {
      localStorage.removeItem(OWNER_STORAGE_KEY);
    }
  };

  return (
    <div className="min-h-screen flex">
      <Sidebar
        totalCount={manifest.documents.length}
        folderTree={folderTree}
        allTags={allTags}
        selectedFolder={selectedFolder}
        selectedTags={selectedTags}
        onSelectFolder={setSelectedFolder}
        onToggleTag={toggleTag}
        onClearFilters={clearFilters}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top Search & Owner Bar */}
        <header className="sticky top-0 z-30 bg-ivory/85 backdrop-blur-md border-b border-rule px-4 sm:px-8 py-3.5">
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-paper border border-rule text-ink"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes, courses, tags, summaries…"
                className="w-full bg-paper border border-rule rounded-lg pl-10 pr-16 py-2 text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:border-mint transition-colors"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <kbd className="hidden sm:inline-block absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-ink-muted/70 bg-ivory border border-rule px-1.5 py-0.5 rounded">
                  /
                </kbd>
              )}
            </div>

            <button
              type="button"
              onClick={() => setAgentRoomOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-rule bg-paper text-ink-muted hover:text-ink hover:bg-paper-warm transition-colors shrink-0"
              title="Open Steno Agent Room"
            >
              <Bot className="w-3.5 h-3.5 text-mint" />
              <span className="hidden sm:inline">Agents</span>
            </button>

            <button
              type="button"
              onClick={() => setOwnerModalOpen(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                ownerConfig
                  ? 'bg-mint-soft border-mint/50 text-ink hover:bg-mint/20'
                  : 'bg-paper border-rule text-ink-muted hover:text-ink hover:bg-paper-warm'
              }`}
              title={ownerConfig ? 'Upload to Steno (Owner Mode)' : 'Owner Upload Sign-In'}
            >
              {ownerConfig ? (
                <>
                  <Upload className="w-3.5 h-3.5 text-ink" />
                  <span className="hidden sm:inline">Add Docs</span>
                  <Unlock className="w-3 h-3 text-mint hidden sm:inline" />
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Owner</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 px-4 sm:px-8 py-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="font-serif text-3xl text-ink">
                  {selectedFolder ? selectedFolder : 'All Study Materials'}
                </h2>
                <p className="text-xs font-mono text-ink-muted mt-0.5">
                  Showing {filteredDocs.length} of {manifest.documents.length} document
                  {manifest.documents.length === 1 ? '' : 's'}
                  {selectedTags.length > 0 && ` • tags: ${selectedTags.map((t) => `#${t}`).join(', ')}`}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="bg-paper border border-rule rounded-xl p-10 text-center text-sm text-ink-muted">
                Opening archive…
              </div>
            ) : (
              <DocumentList
                documents={filteredDocs}
                onOpenDoc={setActiveDoc}
                onSelectTag={toggleTag}
                selectedTags={selectedTags}
              />
            )}
          </div>
        </div>
      </main>

      <DocumentViewer doc={activeDoc} onClose={() => setActiveDoc(null)} />

      <OwnerModal
        open={ownerModalOpen}
        onClose={() => setOwnerModalOpen(false)}
        ownerConfig={ownerConfig}
        onSaveConfig={handleSaveOwnerConfig}
        onUploaded={(files) => setPendingDrop((prev) => ({ seq: (prev?.seq || 0) + 1, files }))}
        onOpenAgents={() => setAgentRoomOpen(true)}
      />
      <AgentRoomModal
        open={agentRoomOpen}
        onClose={() => setAgentRoomOpen(false)}
        ownerConfig={ownerConfig}
        documents={manifest.documents}
        pendingDrop={pendingDrop}
      />
    </div>
  );
}
