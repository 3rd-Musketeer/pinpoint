import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_NOTE_LENGTH = 12000;

export class FrameNoteError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'FrameNoteError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function validateId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new FrameNoteError('invalid_id', `${label} must match ${ID_PATTERN}`, 400);
  }
  return value;
}

function revisionFor(source) {
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
}

function normalizeNote(value) {
  if (typeof value !== 'string') {
    throw new FrameNoteError('invalid_note', 'note must be a string', 400);
  }
  const note = value.replace(/\r\n?/g, '\n').trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new FrameNoteError('note_too_long', `note exceeds ${MAX_NOTE_LENGTH} characters`, 400);
  }
  return note;
}

function findFrame(board, screenId) {
  for (const section of board.sections || []) {
    if (!Array.isArray(section.screens)) continue;
    const index = section.screens.findIndex((entry) => (
      (typeof entry === 'string' ? entry : entry && entry.id) === screenId
    ));
    if (index >= 0) return { section, index, entry: section.screens[index] };
  }
  return null;
}

// 2026-08-17：note 寻址扩到 section —— 整组共用说明（图例/对比结论）挂在
// sections[].note 上，与 screen note 同一份 board.json、同一个 revision。
function findSection(board, sectionId) {
  const section = (board.sections || []).find((entry) => entry && entry.id === sectionId);
  return section ? { section } : null;
}

function noteOf(entry) {
  return entry && typeof entry === 'object' && typeof entry.note === 'string' ? entry.note : '';
}

export function createFrameNoteStore(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const registry = options.registry || null;
  const previewsRoot = path.join(root, 'previews');

  function boardFile(pageId) {
    validateId(pageId, 'pageId');
    const local = path.join(previewsRoot, pageId, 'board.json');
    if (fs.existsSync(local) && fs.statSync(local).isFile()) return local;
    // 2026-08-17e：registry dir 条目的 board.json 同权读写（实例搬迁后页面
    // 住在 owning topic 的 playground，note SSOT 跟着页面走）。
    const entry = registry && typeof registry.resolve === 'function'
      ? registry.resolve(pageId)
      : null;
    if (entry && entry.kind === 'dir' && typeof entry.path === 'string') {
      const file = path.join(entry.path, 'board.json');
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
    throw new FrameNoteError('page_not_found', `preview page "${pageId}" was not found`, 404);
  }

  function readBoard(pageId) {
    const file = boardFile(pageId);
    const source = fs.readFileSync(file, 'utf8');
    let board;
    try {
      board = JSON.parse(source);
    } catch (error) {
      throw new FrameNoteError('invalid_board', `board.json is invalid: ${error.message}`, 500);
    }
    return { file, source, board, revision: revisionFor(source) };
  }

  function get(pageId, screenId) {
    validateId(screenId, 'screenId');
    const state = readBoard(pageId);
    const frame = findFrame(state.board, screenId);
    if (!frame) {
      throw new FrameNoteError('frame_not_found', `frame "${screenId}" was not found`, 404);
    }
    return { pageId, screenId, note: noteOf(frame.entry), revision: state.revision };
  }

  function getSection(pageId, sectionId) {
    validateId(sectionId, 'sectionId');
    const state = readBoard(pageId);
    const found = findSection(state.board, sectionId);
    if (!found) {
      throw new FrameNoteError('section_not_found', `section "${sectionId}" was not found`, 404);
    }
    return { pageId, sectionId, note: noteOf(found.section), revision: state.revision };
  }

  function writeBoard(state) {
    const nextSource = `${JSON.stringify(state.board, null, 2)}\n`;
    const tempFile = `${state.file}.frame-note-${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempFile, nextSource, 'utf8');
      fs.renameSync(tempFile, state.file);
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
    return revisionFor(nextSource);
  }

  function update(input) {
    const pageId = validateId(input.pageId, 'pageId');
    const screenId = validateId(input.screenId, 'screenId');
    const note = normalizeNote(input.note);
    if (typeof input.baseRevision !== 'string' || !input.baseRevision) {
      throw new FrameNoteError('missing_revision', 'baseRevision is required', 400);
    }

    const state = readBoard(pageId);
    const frame = findFrame(state.board, screenId);
    if (!frame) {
      throw new FrameNoteError('frame_not_found', `frame "${screenId}" was not found`, 404);
    }
    if (input.baseRevision !== state.revision) {
      throw new FrameNoteError('revision_conflict', 'board.json changed while this note was being edited', 409, {
        note: noteOf(frame.entry),
        revision: state.revision,
      });
    }

    let entry = frame.entry;
    if (typeof entry === 'string') {
      entry = { id: entry };
      frame.section.screens[frame.index] = entry;
    }
    if (note) entry.note = note;
    else delete entry.note;

    return { pageId, screenId, note, revision: writeBoard(state) };
  }

  function updateSection(input) {
    const pageId = validateId(input.pageId, 'pageId');
    const sectionId = validateId(input.sectionId, 'sectionId');
    const note = normalizeNote(input.note);
    if (typeof input.baseRevision !== 'string' || !input.baseRevision) {
      throw new FrameNoteError('missing_revision', 'baseRevision is required', 400);
    }

    const state = readBoard(pageId);
    const found = findSection(state.board, sectionId);
    if (!found) {
      throw new FrameNoteError('section_not_found', `section "${sectionId}" was not found`, 404);
    }
    if (input.baseRevision !== state.revision) {
      throw new FrameNoteError('revision_conflict', 'board.json changed while this note was being edited', 409, {
        note: noteOf(found.section),
        revision: state.revision,
      });
    }

    if (note) found.section.note = note;
    else delete found.section.note;

    return { pageId, sectionId, note, revision: writeBoard(state) };
  }

  return { get, getSection, update, updateSection };
}

