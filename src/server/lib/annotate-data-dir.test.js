import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dataRoot } from './annotate-data-dir.js';

test('dataRoot defaults to ~/.pinpoint', () => {
  assert.equal(dataRoot({}), path.join(os.homedir(), '.pinpoint'));
});

test('PINPOINT_DATA_DIR overrides the default root', () => {
  assert.equal(dataRoot({ PINPOINT_DATA_DIR: '/tmp/pp' }), '/tmp/pp');
});

test('PINPOINT_DATA_DIR wins over the deprecated HTML_ANNOTATE_DATA_DIR', () => {
  assert.equal(
    dataRoot({ PINPOINT_DATA_DIR: '/tmp/pp', HTML_ANNOTATE_DATA_DIR: '/tmp/ha' }),
    '/tmp/pp',
  );
});

test('deprecated HTML_ANNOTATE_DATA_DIR still applies when PINPOINT_DATA_DIR is absent', () => {
  assert.equal(dataRoot({ HTML_ANNOTATE_DATA_DIR: '/tmp/ha' }), '/tmp/ha');
});
