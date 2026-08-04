import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  exportMarkCss,
  formatCommentsTextSection,
  injectCommentsExportHtml,
  prepareExportAnnotations,
} from './export-doc-bake.js';
import {
  ExportDocContractError,
  EXPORT_DOC_W,
  EXPORT_VIEWPORT_WITH_COMMENTS,
  exportDocFilename,
  validateExportDocRequest,
} from './export-doc-contract.js';

test('comments flag defaults off; image mode widens to 1184 when on', () => {
  const plain = validateExportDocRequest({
    mode: 'image',
    pageId: 'doc-library',
    screenId: 'sample-report',
    src: 'previews/doc-library/sample-report.html',
  });
  assert.equal(plain.comments, false);
  assert.equal(plain.viewportWidth, EXPORT_DOC_W);
  assert.equal(exportDocFilename(plain), 'doc-library__sample-report@2x.png');

  const withComments = validateExportDocRequest({
    mode: 'image',
    pageId: 'doc-library',
    screenId: 'sample-report',
    src: 'previews/doc-library/sample-report.html',
    comments: true,
  });
  assert.equal(withComments.comments, true);
  assert.equal(withComments.viewportWidth, EXPORT_VIEWPORT_WITH_COMMENTS);
  assert.equal(exportDocFilename(withComments), 'doc-library__sample-report@2x.comments.png');
});

test('html comment filenames get a .comments suffix', () => {
  const full = validateExportDocRequest({
    mode: 'html-full',
    pageId: 'p',
    screenId: 's',
    src: 'previews/p/s.html',
    comments: true,
  });
  assert.equal(exportDocFilename(full), 'p__s.comments.html');

  const noCss = validateExportDocRequest({
    mode: 'html-no-css',
    pageId: 'p',
    screenId: 's',
    src: 'previews/p/s.html',
    comments: true,
  });
  assert.equal(exportDocFilename(noCss), 'p__s.comments.no-css.html');
});

test('prepareExportAnnotations resolves target refs and mentions', () => {
  const prepared = prepareExportAnnotations([
    {
      n: 1,
      id: 'aaa',
      selector: 'h1',
      text: 'Title',
      targets: [{ ref: 'i1', selector: 'h1', text: 'Title' }],
      content: 'see [@t:i1] and [@a:bbb]',
    },
    { n: 2, id: 'bbb', selector: '#s2', content: 'other' },
  ]);
  assert.equal(prepared[0].content, 'see [indicator 1] and @2');
  assert.equal(prepared[1].content, 'other');
});

test('formatCommentsTextSection lists comments for AI feed', () => {
  const html = formatCommentsTextSection([
    { n: 3, text: 'Heading', content: 'Please fix' },
  ]);
  assert.ok(html.includes('id="comments"'));
  assert.ok(html.includes('#3'));
  assert.ok(html.includes('Heading'));
  assert.ok(html.includes('Please fix'));
});

test('exportMarkCss covers live mark box + badge + bubble rules', () => {
  const css = exportMarkCss();
  assert.ok(css.includes('.ann-target{'));
  assert.ok(css.includes('.ann-frame{'));
  assert.ok(css.includes('.ann-badge{'));
  assert.ok(css.includes('.ann-bubble{'));
});

test('injectCommentsExportHtml preserves adjacent inline scripts, strips only annotate bootstrap', () => {
  const source = '<!doctype html><html><head><title>t</title></head><body>'
    + '<div id="chart"></div>'
    + '<script>document.getElementById("chart").innerHTML = "<b>sankey</b>";</script>'
    + '<script>(function(){var s=document.createElement("script");s.src="/annotate.js";'
    + 'document.body.appendChild(s);})();</script>'
    + '</body></html>';
  const out = injectCommentsExportHtml(source, [
    { n: 1, selector: '#chart', text: 'Chart', content: 'check' },
  ]);
  // Sankey/chart script must survive; only the annotate bootstrap is stripped.
  assert.ok(out.includes('getElementById("chart")'), 'chart script should survive');
  assert.ok(out.includes('sankey'), 'chart content should survive');
  assert.equal(/src\s*=\s*["'][^"']*annotate\.js/i.test(out), false);
  assert.equal(/data-ios-annotate/i.test(out), false);
  // Placer script is present with bubbles enabled.
  assert.ok(out.includes('var defer = true'));
  assert.ok(out.includes('var bubbles = true'));
  assert.ok(out.includes('"selector":"#chart"'));
  // Bubble rendering libs are inlined.
  assert.ok(out.includes('bubbleInnerHtml'));
  assert.ok(out.includes('packGutter'));
});

test('validateExportDocRequest still rejects non-previews src', () => {
  assert.throws(() => validateExportDocRequest({
    mode: 'html-full', pageId: 'p', screenId: 's', src: '/index.html', comments: true,
  }), ExportDocContractError);
});
