import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createFrameNoteStore, FrameNoteError } from './lib/frame-note-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ROUTE = /^\/api\/frame-notes\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/;
// 2026-08-17：section 级 note 与 frame note 同构（GET/PUT + baseRevision），
// 独立路由 /api/section-notes/<pageId>/<sectionId>。
const ROUTE_SECTION = /^\/api\/section-notes\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createFrameNotesHandler(options = {}) {
  const store = options.store || createFrameNoteStore({ root: options.root || ROOT });

  return async function handleFrameNotes(req, res, urlPath) {
    if (req.method !== 'GET' && req.method !== 'PUT') return false;
    const frameMatch = urlPath.match(ROUTE);
    const sectionMatch = !frameMatch && urlPath.match(ROUTE_SECTION);
    if (!frameMatch && !sectionMatch) return false;
    const pageId = (frameMatch || sectionMatch)[1];
    const targetId = (frameMatch || sectionMatch)[2];

    try {
      if (req.method === 'GET') {
        sendJson(res, 200, frameMatch
          ? store.get(pageId, targetId)
          : store.getSection(pageId, targetId));
        return true;
      }

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: 'bad_json' });
        return true;
      }
      const input = { pageId, note: body.note, baseRevision: body.baseRevision };
      sendJson(res, 200, frameMatch
        ? store.update({ ...input, screenId: targetId })
        : store.updateSection({ ...input, sectionId: targetId }));
      return true;
    } catch (error) {
      if (error instanceof FrameNoteError) {
        sendJson(res, error.status, { error: error.code, message: error.message, ...error.details });
      } else {
        sendJson(res, 500, { error: 'internal_error', message: String(error && error.message || error) });
      }
      return true;
    }
  };
}

export default function frameNotesApi(options = {}) {
  const handleFrameNotes = createFrameNotesHandler(options);
  return {
    name: 'frame-notes-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];
        if (await handleFrameNotes(req, res, urlPath)) return;
        next();
      });
    },
  };
}

