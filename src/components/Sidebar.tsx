import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Tag,
  X,
} from 'lucide-react';
import type { FolderNode } from '../types';

interface SidebarProps {
  totalCount: number;
  folderTree: FolderNode[];
  allTags: Array<{ name: string; count: number }>;
  selectedFolder: string | null;
  selectedTags: string[];
  onSelectFolder: (folder: string | null) => void;
  onToggleTag: (tag: string) => void;
  onClearFilters: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function FolderBranch({
  node,
  depth,
  selectedFolder,
  onSelectFolder,
}: {
  node: FolderNode;
  depth: number;
  selectedFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedFolder === node.fullPath;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer ${
          isSelected
            ? 'bg-mint-soft text-ink font-medium'
            : 'text-ink-muted hover:bg-paper-warm hover:text-ink'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onSelectFolder(isSelected ? null : node.fullPath)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="p-0.5 rounded hover:bg-rule/60 text-ink-muted"
              aria-label="Toggle folder"
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          {isSelected ? (
            <FolderOpen className="w-4 h-4 shrink-0 text-mint" />
          ) : (
            <Folder className="w-4 h-4 shrink-0 text-ink-muted/70 group-hover:text-mint" />
          )}
          <span className="truncate">{node.name}</span>
        </div>
        <span className="font-mono text-[11px] text-ink-muted/70 ml-2 shrink-0">
          {node.count}
        </span>
      </div>

      {hasChildren && expanded && (
        <div className="mt-0.5">
          {node.children.map((child) => (
            <FolderBranch
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  totalCount,
  folderTree,
  allTags,
  selectedFolder,
  selectedTags,
  onSelectFolder,
  onToggleTag,
  onClearFilters,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const hasActiveFilter = selectedFolder !== null || selectedTags.length > 0;

  const content = (
    <div className="flex flex-col h-full bg-paper border-r border-rule w-68 shrink-0">
      <div className="flex items-center justify-between px-5 py-4 border-b border-rule">
        <button
          type="button"
          onClick={() => {
            onClearFilters();
            onCloseMobile();
          }}
          className="flex items-center gap-2.5 text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-ink text-ivory flex items-center justify-center shadow-xs">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-serif text-2xl leading-none tracking-tight text-ink">
              Steno
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted mt-0.5">
              Study Archive
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-md text-ink-muted hover:bg-paper-warm"
          aria-label="Close sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* All Documents */}
        <div>
          <button
            type="button"
            onClick={() => {
              onSelectFolder(null);
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
              selectedFolder === null
                ? 'bg-mint-soft text-ink font-medium'
                : 'text-ink-muted hover:bg-paper-warm hover:text-ink'
            }`}
          >
            <span>All Documents</span>
            <span className="font-mono text-xs text-ink-muted">{totalCount}</span>
          </button>
        </div>

        {/* Folders */}
        <div>
          <div className="px-3 mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
              Notebooks & Courses
            </span>
          </div>
          {folderTree.length === 0 ? (
            <p className="px-3 text-xs text-ink-muted/70 italic">
              No folders yet
            </p>
          ) : (
            <div className="space-y-0.5">
              {folderTree.map((node) => (
                <FolderBranch
                  key={node.fullPath}
                  node={node}
                  depth={0}
                  selectedFolder={selectedFolder}
                  onSelectFolder={(f) => {
                    onSelectFolder(f);
                    onCloseMobile();
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <div className="px-3 mb-2 flex items-center gap-1.5">
            <Tag className="w-3 h-3 text-ink-muted" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
              Tags
            </span>
          </div>
          {allTags.length === 0 ? (
            <p className="px-3 text-xs text-ink-muted/70 italic">
              No tags yet
            </p>
          ) : (
            <div className="px-2 flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const active = selectedTags.includes(tag.name);
                return (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() => onToggleTag(tag.name)}
                    className={`font-mono text-[11px] px-2 py-1 rounded border transition-colors ${
                      active
                        ? 'bg-terracotta text-paper border-terracotta'
                        : 'bg-ivory text-ink-muted border-rule hover:border-mint hover:text-ink'
                    }`}
                  >
                    #{tag.name}
                    <span className={`ml-1 ${active ? 'opacity-80' : 'opacity-50'}`}>
                      {tag.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {hasActiveFilter && (
        <div className="p-3 border-t border-rule">
          <button
            type="button"
            onClick={onClearFilters}
            className="w-full text-xs font-mono text-terracotta hover:bg-terracotta-soft py-1.5 rounded-md transition-colors"
          >
            Clear active filters
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:block h-screen sticky top-0">{content}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-ink/30 backdrop-blur-[1px]"
            onClick={onCloseMobile}
          />
          <div className="relative z-50 h-full">{content}</div>
        </div>
      )}
    </>
  );
}