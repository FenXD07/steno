export interface StenoDocument {
  id: string;
  path: string;
  filename: string;
  folder: string;
  title: string;
  tags: string[];
  summary: string;
  ext: string;
  size: number;
  addedAt: string;
}

export interface StenoManifest {
  generatedAt: string;
  documents: StenoDocument[];
}

export interface FolderNode {
  name: string;
  fullPath: string;
  count: number;
  children: FolderNode[];
}

export interface OwnerConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface AgentEvent {
  file: string;
  title: string;
  source: 'inbox' | 'manual';
  folder: string;
  tags: string[];
  reason: string;
  durationMs: number;
  at: string;
}

export interface AgentLog {
  runAt: string;
  durationMs: number;
  processedCount: number;
  events: AgentEvent[];
}
