/** Page id of the built-in Component Library board. */
export var COMPONENTS_ID = 'components';
export var LIB_ID = 'library';
export var WEB_LIB_ID = 'web-library';
export var DOC_LIB_ID = 'doc-library';
export var SYSTEM_PAGES = { components: true };

/** Manifest entry for a page (registry-sourced "site" pages carry site:true). */
export function pageEntry(manifest, pageId) {
  if (!manifest || !manifest.pages) return null;
  for (var i = 0; i < manifest.pages.length; i++) {
    if (manifest.pages[i].id === pageId) return manifest.pages[i];
  }
  return null;
}

/** Board/screen base URL for a page: registry dir entries are served read-only
    under /sites/<id>/; template pages live in previews/. */
export function pageBaseUrl(manifest, pageId) {
  var page = pageEntry(manifest, pageId);
  if (page && page.site) return '/sites/' + pageId + '/';
  return '/previews/' + pageId + '/';
}

export function modeForPage(manifest, pageId) {
  if (pageId === COMPONENTS_ID) return 'ios';
  var page = pageEntry(manifest, pageId);
  return (page && page.mode) || 'ios';
}

export function defaultShellForPage(manifest, pageId) {
  var mode = modeForPage(manifest, pageId);
  if (mode === 'web') return 'web';
  if (mode === 'html') return 'doc';
  return 'app';
}
