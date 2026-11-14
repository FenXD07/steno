import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function serveLocalDocuments(): Plugin {
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };

  return {
    name: 'serve-local-documents',
    configureServer(server) {
      server.middlewares.use('/documents', (req, res, next) => {
        const cleanUrl = (req.url || '').split('?')[0];
        const decoded = decodeURIComponent(cleanUrl).replace(/^\/+/, '');
        const docsRoot = path.resolve(process.cwd(), 'documents');
        const target = path.resolve(docsRoot, decoded);

        if (!target.startsWith(docsRoot) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
          return next();
        }
        const ext = path.extname(target).toLowerCase();
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        fs.createReadStream(target).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveLocalDocuments()],
  base: './',
});