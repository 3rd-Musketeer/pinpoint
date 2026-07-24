import test from 'node:test';
import assert from 'node:assert/strict';

import { ExportContractError, exportFilename, validateExportRequest } from './export-contract.js';

test('export request defaults to a 2x WebP canvas frame', () => {
  const request = validateExportRequest({
    kind: 'frame', pageId: 'library', sectionId: 'brew-flow', screenId: 'timer', html: '<div>frame</div>',
  });
  assert.equal(request.format, 'webp');
  assert.equal(request.scale, 2);
  assert.equal(request.background, 'canvas');
  assert.equal(exportFilename(request), 'library__brew-flow__timer@2x.webp');
});

test('section export does not require a screen id', () => {
  const request = validateExportRequest({
    kind: 'section', pageId: 'library', sectionId: 'home', format: 'png', background: 'transparent', html: '<article>section</article>',
  });
  assert.equal(request.screenId, '');
  assert.equal(exportFilename(request), 'library__home@2x.png');
});

test('transparent WebP and invalid scale are rejected', () => {
  assert.throws(() => validateExportRequest({
    kind: 'frame', pageId: 'p', sectionId: 's', screenId: 'f', background: 'transparent', html: '<div>x</div>',
  }), ExportContractError);
  assert.throws(() => validateExportRequest({
    kind: 'section', pageId: 'p', sectionId: 's', scale: 3, html: '<div>x</div>',
  }), /scale/);
});
