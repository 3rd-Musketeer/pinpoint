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

export function createFrameNoteStore(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const previewsRoot = path.join(root, 'previews');

  function boardFile(pageId) {
    validateId(pageId, 'pageId');
    const file = path.join(previewsRoot, pageId, 'board.json');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new FrameNoteError('page_not_found', `preview page "${pageId}" was not found`, 404);
    }
    return file;
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
    const note = typeof frame.entry === 'object' && typeof frame.entry.note === 'string'
      ? frame.entry.note
      : '';
    return { pageId, screenId, note, revision: state.revision };
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
      const currentNote = typeof frame.entry === 'object' && typeof frame.entry.note === 'string'
        ? frame.entry.note
        : '';
      throw new FrameNoteError('revision_conflict', 'board.json changed while this note was being edited', 409, {
        note: currentNote,
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

    const nextSource = `${JSON.stringify(state.board, null, 2)}\n`;
    const tempFile = `${state.file}.frame-note-${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempFile, nextSource, 'utf8');
      fs.renameSync(tempFile, state.file);
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }

    return { pageId, screenId, note, revision: revisionFor(nextSource) };
  }

  return { get, update };
}

