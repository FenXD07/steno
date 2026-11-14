import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = process.cwd();
const INBOX_DIR = path.join(ROOT, 'inbox');
const DOCS_DIR = path.join(ROOT, 'documents');
const MANIFEST_PATH = path.join(ROOT, 'public', 'manifest.json');
const AGENT_LOG_PATH = path.join(ROOT, 'public', 'agent-log.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.js', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.c', '.cpp', '.h', '.html', '.css', '.sql', '.tex', '.yaml', '.yml',
]);

const MULTIMODAL_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif']);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function walkFiles(dir, baseDir = dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push({
        fullPath,
        relPath: path.relative(baseDir, fullPath).split(path.sep).join('/'),
      });
    }
  }
  return results;
}

function listFolders(dir, baseDir = dir) {
  if (!fs.existsSync(dir)) return [];
  const folders = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(baseDir, fullPath).split(path.sep).join('/');
    folders.push(rel);
    folders.push(...listFolders(fullPath, baseDir));
  }
  return folders;
}

function sanitizeFolder(folder) {
  if (!folder || typeof folder !== 'string') return 'Unsorted';
  const cleaned = folder
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.replace(/[<>:"|?*\x00-\x1f]/g, '').trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .slice(0, 4)
    .join('/');
  return cleaned || 'Unsorted';
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .map((t) => String(t).toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''))
      .filter(Boolean)
  )].slice(0, 5);
}

function fallbackTitle(filename) {
  return path.parse(filename).name.replace(/[-_]+/g, ' ').trim() || filename;
}

async function extractOfficeText(filePath, ext) {
  try {
    const buffer = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buffer);
    let xmlTexts = [];

    if (ext === '.docx' && zip.file('word/document.xml')) {
      xmlTexts.push(await zip.file('word/document.xml').async('string'));
    } else if (ext === '.pptx') {
      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort()
        .slice(0, 20);
      for (const sf of slideFiles) {
        xmlTexts.push(await zip.file(sf).async('string'));
      }
    }

    const plain = xmlTexts
      .join('\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.slice(0, 12000);
  } catch {
    return '';
  }
}

async function askGemini(filePath, filename, existingFolders, existingTags, lockedFolder = null) {
  if (!GEMINI_API_KEY) return null;

  const ext = path.extname(filename).toLowerCase();
  const stat = fs.statSync(filePath);
  const parts = [];

  const folderInstruction = lockedFolder
    ? `The user already placed this file in the folder "${lockedFolder}". Keep "folder" as "${lockedFolder}".`
    : `Choose the cleanest folder path (1 to 2 levels deep, e.g. "Biology 101" or "Fall 2026/Biology 101"). Reuse one of the existing folders if it clearly matches; otherwise create a concise, sensible course/topic folder.`;

  const prompt = `You are Steno's quiet, meticulous college study archivist.
Analyze this study document and organize it cleanly.

Filename: "${filename}"
Existing folders: ${existingFolders.length ? JSON.stringify(existingFolders) : '[] (none yet)'}
Existing tags: ${existingTags.length ? JSON.stringify(existingTags) : '[] (none yet)'}

Instructions:
1. ${folderInstruction}
2. Provide a clean, human-readable "title" (no file extension).
3. Provide 1 to 4 lowercase hyphenated "tags" (e.g. "lecture-notes", "syllabus", "exam-prep", "lab", "slides", "reading"). Prefer reusing existing tags when relevant.
4. Provide a concise 1-sentence "summary" describing what the document contains.
5. Provide a short 1-sentence "reason" explaining why you chose that folder/tags.

Return ONLY valid JSON matching:
{
  "folder": "string",
  "title": "string",
  "tags": ["string"],
  "summary": "string",
  "reason": "string"
}`;

  parts.push({ text: prompt });

  if (MULTIMODAL_EXTS.has(ext) && stat.size <= 18 * 1024 * 1024) {
    const base64 = fs.readFileSync(filePath).toString('base64');
    parts.push({
      inline_data: {
        mime_type: MIME_MAP[ext] || 'application/octet-stream',
        data: base64,
      },
    });
  } else if (TEXT_EXTS.has(ext)) {
    const text = fs.readFileSync(filePath, 'utf8').slice(0, 12000);
    parts.push({ text: `\nDocument text excerpt:\n${text}` });
  } else if (ext === '.docx' || ext === '.pptx') {
    const officeText = await extractOfficeText(filePath, ext);
    if (officeText) {
      parts.push({ text: `\nExtracted document text:\n${officeText}` });
    }
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`Gemini API error (${res.status}) for ${filename}: ${errText}`);
      return null;
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;

    const parsed = JSON.parse(rawText);
    return {
      folder: lockedFolder || sanitizeFolder(parsed.folder),
      title: String(parsed.title || fallbackTitle(filename)).trim(),
      tags: sanitizeTags(parsed.tags),
      summary: String(parsed.summary || '').trim(),
      reason: String(parsed.reason || '').trim(),
    };
  } catch (err) {
    console.warn(`Gemini parsing failed for ${filename}:`, err.message);
    return null;
  }
}

function getUniqueDestPath(destDir, filename) {
  ensureDir(destDir);
  const parsed = path.parse(filename);
  let candidate = path.join(destDir, filename);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${parsed.name}-${counter}${parsed.ext}`);
    counter++;
  }
  return candidate;
}

function removeEmptyDirs(dir, stopAt) {
  if (!fs.existsSync(dir) || dir === stopAt) return;
  const entries = fs.readdirSync(dir);
  if (entries.length === 0) {
    fs.rmdirSync(dir);
    removeEmptyDirs(path.dirname(dir), stopAt);
  }
}

async function main() {
  const runStart = Date.now();
  ensureDir(INBOX_DIR);
  ensureDir(DOCS_DIR);
  ensureDir(path.dirname(MANIFEST_PATH));

  let existingManifest = { documents: [] };
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      existingManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch {
      existingManifest = { documents: [] };
    }
  }

  const prevByPath = new Map(
    (existingManifest.documents || []).map((doc) => [doc.path, doc])
  );

  // Retry prior fallback documents now that Gemini has a supported model.
  const fallbackMetaPaths = new Set(
    (existingManifest.documents || [])
      .filter((doc) =>
        doc.folder === 'Unsorted' &&
        !(doc.tags || []).length &&
        !String(doc.summary || '').trim()
      )
      .map((doc) => doc.path)
  );

  const existingFolders = listFolders(DOCS_DIR);
  const existingTagsSet = new Set();
  for (const doc of existingManifest.documents || []) {
    for (const t of doc.tags || []) existingTagsSet.add(t);
  }

  const runEvents = [];

  // 1. Process new files in inbox/
  // Requeue files that were previously indexed in Unsorted without AI metadata.
  const fallbackItems = walkFiles(DOCS_DIR).filter((item) =>
    fallbackMetaPaths.has(`documents/${item.relPath}`)
  );
  for (const item of fallbackItems) {
    const filename = path.basename(item.fullPath);
    const retryPath = getUniqueDestPath(INBOX_DIR, filename);
    fs.renameSync(item.fullPath, retryPath);
    removeEmptyDirs(path.dirname(item.fullPath), DOCS_DIR);
    console.log(`Requeued previous fallback file: ${filename}`);
  }

  const inboxFiles = walkFiles(INBOX_DIR);
  const newlySortedMeta = new Map();

  for (const item of inboxFiles) {
    const filename = path.basename(item.fullPath);
    const fileStart = Date.now();
    console.log(`Sorting inbox file: ${item.relPath}`);

    const ai = await askGemini(
      item.fullPath,
      filename,
      existingFolders,
      [...existingTagsSet]
    );

    const targetFolder = ai?.folder || 'Unsorted';
    if (!existingFolders.includes(targetFolder)) existingFolders.push(targetFolder);
    for (const t of ai?.tags || []) existingTagsSet.add(t);

    const destDir = path.join(DOCS_DIR, targetFolder);
    const destPath = getUniqueDestPath(destDir, filename);
    fs.renameSync(item.fullPath, destPath);
    removeEmptyDirs(path.dirname(item.fullPath), INBOX_DIR);

    const relFromDocs = path.relative(DOCS_DIR, destPath).split(path.sep).join('/');
    const manifestRelPath = `documents/${relFromDocs}`;

    newlySortedMeta.set(manifestRelPath, {
      title: ai?.title || fallbackTitle(filename),
      tags: ai?.tags || [],
      summary: ai?.summary || '',
    });

    runEvents.push({
      file: filename,
      title: ai?.title || fallbackTitle(filename),
      source: 'inbox',
      folder: targetFolder,
      tags: ai?.tags || [],
      reason: ai?.reason || (ai ? 'Sorted by Gemini AI' : 'Fallback sort (no AI response)'),
      durationMs: Date.now() - fileStart,
      at: new Date().toISOString(),
    });

    console.log(` -> Moved to ${manifestRelPath}`);
  }

  // 2. Rebuild manifest from everything currently inside documents/
  const docFiles = walkFiles(DOCS_DIR);
  const documents = [];

  for (const item of docFiles) {
    const manifestRelPath = `documents/${item.relPath}`;
    const filename = path.basename(item.fullPath);
    const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
    const stat = fs.statSync(item.fullPath);
    const dirPart = path.dirname(item.relPath);
    const folder = dirPart === '.' ? 'General' : dirPart.split(path.sep).join('/');

    let meta = newlySortedMeta.get(manifestRelPath) || prevByPath.get(manifestRelPath);

    if (!meta) {
      const fileStart = Date.now();
      console.log(`Indexing manually added file: ${manifestRelPath}`);
      const ai = await askGemini(
        item.fullPath,
        filename,
        existingFolders,
        [...existingTagsSet],
        folder
      );
      meta = {
        title: ai?.title || fallbackTitle(filename),
        tags: ai?.tags || [],
        summary: ai?.summary || '',
      };
      for (const t of meta.tags) existingTagsSet.add(t);

      runEvents.push({
        file: filename,
        title: meta.title,
        source: 'manual',
        folder,
        tags: meta.tags,
        reason: ai?.reason || (ai ? 'Tagged & summarized by Gemini AI' : 'Indexed by filename'),
        durationMs: Date.now() - fileStart,
        at: new Date().toISOString(),
      });
    }

    documents.push({
      id: manifestRelPath,
      path: manifestRelPath,
      filename,
      folder,
      title: meta.title || fallbackTitle(filename),
      tags: meta.tags || [],
      summary: meta.summary || '',
      ext: ext || 'file',
      size: stat.size,
      addedAt: prevByPath.get(manifestRelPath)?.addedAt || stat.mtime.toISOString(),
    });
  }

  documents.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        documents,
      },
      null,
      2
    )
  );

  // Only overwrite agent-log.json if new files were processed (or if log doesn't exist yet)
  if (runEvents.length > 0 || !fs.existsSync(AGENT_LOG_PATH)) {
    fs.writeFileSync(
      AGENT_LOG_PATH,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          durationMs: Date.now() - runStart,
          processedCount: runEvents.length,
          events: runEvents.slice(0, 30),
        },
        null,
        2
      )
    );
  }

  console.log(`Indexed ${documents.length} total document(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
