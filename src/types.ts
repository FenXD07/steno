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