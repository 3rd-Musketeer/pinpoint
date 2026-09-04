import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ExportDocContractError,
  exportDocFilename,
  normalizeDocSrc,
  stripDocumentCss,
  validateExportDocRequest,
} from './export-doc-contract.js';

test('doc export defaults to 2x PNG long image at 920px', () => {
  const request = validateExportDocRequest({
    mode: 'image',
    pageId: 'doc-library',
    screenId: 'sample-report',
    src: '/previews/doc-library/sample-report.html',
  });
  assert.equal(request.scale, 2);
  assert.equal(request.format, 'png');
  assert.equal(request.viewportWidth, 920);
  assert.equal(exportDocFilename(request), 'doc-library__sample-report@2x.png');
});

test('html modes produce stable filenames and strip only stylesheets', () => {
  const full = validateExportDocRequest({
    mode: 'html-full',
    pageId: 'eval-reports',
    screenId: '20260727-chat-quality-review-v2',
    src: 'previews/eval-reports/20260727-chat-quality-review-v2.html',
  });
  assert.equal(exportDocFilename(full), 'eval-reports__20260727-chat-quality-review-v2.html');

  const noCss = validateExportDocRequest({
    mode: 'html-no-css',
    pageId: 'eval-reports',
    screenId: 'v2',
    src: 'previews/eval-reports/v2.html',
  });
  assert.equal(exportDocFilename(noCss), 'eval-reports__v2.no-css.html');

  const html = '<!doctype html><html><head><style>.a{}</style>'
    + '<link rel="stylesheet" href="x.css">'
    + '</head><body><div style="width:50%">hi</div></body></html>';
  const stripped = stripDocumentCss(html);
  assert.equal(stripped.includes('<style'), false);
  assert.equal(stripped.includes('stylesheet'), false);
  assert.equal(stripped.includes('style="width:50%"'), true);
});

test('doc src must stay under previews/ and reject traversal', () => {
  assert.equal(normalizeDocSrc('/previews/doc-library/a.html'), 'previews/doc-library/a.html');
  assert.throws(() => normalizeDocSrc('../secrets.html'), ExportDocContractError);
  assert.throws(() => normalizeDocSrc('previews/../package.json'), ExportDocContractError);
  assert.throws(() => validateExportDocRequest({
    mode: 'html-full', pageId: 'p', screenId: 's', src: '/index.html',
  }), /previews/);
});

test('doc src also resolves under sites/<entry-id>/ with the same traversal guards', () => {
  assert.equal(normalizeDocSrc('/sites/e2e-dir/doc.html'), 'sites/e2e-dir/doc.html');
  assert.equal(normalizeDocSrc('sites/areta-chat-eval/v2.html'), 'sites/areta-chat-eval/v2.html');
  assert.throws(() => normalizeDocSrc('sites/../secret.html'), ExportDocContractError);
  assert.throws(() => normalizeDocSrc('sites/e2e-dir/../../etc/passwd'), ExportDocContractError);
  assert.throws(() => normalizeDocSrc('sites//doc.html'), ExportDocContractError);
  assert.throws(() => normalizeDocSrc('other/x.html'), ExportDocContractError);
  const ok = validateExportDocRequest({
    mode: 'html-full', pageId: 'e2e-dir', screenId: 'doc', src: 'sites/e2e-dir/doc.html',
  });
  assert.equal(ok.src, 'sites/e2e-dir/doc.html');
});
