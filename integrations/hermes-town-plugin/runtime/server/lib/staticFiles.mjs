// Static delivery of the built app.
//
// The only thing worth being careful about here is that a request path is a
// string from the network, not a file path. Every request is resolved against
// the document root and refused unless the resolved path is still inside it,
// so `..`, an encoded `..`, a symlinked escape, or an absolute path cannot
// reach a file the server was never asked to publish.

import fs from 'node:fs';
import path from 'node:path';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
});

export function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve one request path inside `root`.
 *
 * @returns {{ ok: true, file: string } | { ok: false, reason: 'traversal' | 'missing' }}
 */
export function resolveStatic(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return { ok: false, reason: 'traversal' };
  }
  if (decoded.includes('\0')) return { ok: false, reason: 'traversal' };
  const relative = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative === '' ? 'index.html' : relative);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    return { ok: false, reason: 'traversal' };
  }
  let stats;
  try {
    // Real path first: a symlink pointing out of the document root is an
    // escape even though the literal path looked contained.
    const real = fs.realpathSync(candidate);
    if (real !== root && !real.startsWith(rootWithSep)) return { ok: false, reason: 'traversal' };
    stats = fs.statSync(real);
    if (stats.isDirectory()) {
      const index = path.join(real, 'index.html');
      if (!fs.existsSync(index)) return { ok: false, reason: 'missing' };
      return { ok: true, file: index };
    }
    return { ok: true, file: real };
  } catch {
    return { ok: false, reason: 'missing' };
  }
}
