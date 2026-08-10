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
