/* pinpoint extension content script (isolated world, top frame only).
 *
 * On every matched local-dev page:
 *   1. Probe candidate service origins for a live /registry — the persistent
 *      pinpoint service first, then the page's own origin (a pinpoint-served
 *      page needs no proxy hop). First origin returning JSON wins; if none
 *      responds the service is down and we stay out of the page.
 *   2. Match location.origin against the registry's url entries (exact origin
 *      match). No match → the page is not a registered review target → exit.
 *   3. Hand the entry id to the page's MAIN world through the DOM:
 *      <html data-pinpoint-entry="...">. A content script cannot touch the
 *      main world's window, and an injected inline <script> is blocked
 *      whenever the page ships a strict CSP — the shared DOM attribute is
 *      the reliable bridge (annotate.js reads it before 'pinpoint' default).
 *      Then inject the annotate client itself. annotate.js guards on
 *      window.__htmlAnnotate, so repeat injection is a no-op.
 *
 * Script origin: since Chrome 130, scripts injected by a content script are
 * checked against the extension's own CSP, whose default whitelists only the
 * extension origin and http://localhost:* / http://127.0.0.1:* — a remote
 * https origin (e.g. https://pinpoint.localhost) is refused. The registry
 * payload therefore carries service.directOrigin (the API's actual loopback
 * bind, no TLS proxy); we load annotate.js from there and the client keeps
 * calling the same direct origin. Loopback http is a potentially trustworthy
 * origin, so an https page does not treat it as mixed content, and CORS
 * (Access-Control-Allow-Origin: *, no credentials) covers the cross-origin
 * calls. Older servers without service.directOrigin fall back to the winning
 * candidate origin.
 */
(function () {
  'use strict';

  var CANDIDATES = ['https://pinpoint.localhost', location.origin];

  function fetchRegistry(origin) {
    return fetch(origin + '/registry').then(function (res) {
      if (!res.ok) throw new Error('registry HTTP ' + res.status);
      return res.json();
    }).then(function (registry) {
      return { origin: origin, registry: registry };
    });
  }

  function matchingEntry(entries) {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry || entry.kind !== 'url' || typeof entry.url !== 'string') continue;
      try {
        if (new URL(entry.url).origin === location.origin) return entry;
      } catch (e) { /* unparseable entry url — skip */ }
    }
    return null;
  }

  function inject(scriptOrigin, entryId) {
    document.documentElement.setAttribute('data-pinpoint-entry', entryId);

    var client = document.createElement('script');
    client.src = scriptOrigin + '/annotate.js';
    client.setAttribute('data-pinpoint-extension', '');
    (document.head || document.documentElement).appendChild(client);
  }

  var tried = {};
  var chain = Promise.reject();
  CANDIDATES.forEach(function (origin) {
    if (tried[origin]) return;
    tried[origin] = true;
    chain = chain.catch(function () { return fetchRegistry(origin); });
  });

  chain.then(function (winner) {
    var entries = (winner.registry && winner.registry.entries) || [];
    var entry = matchingEntry(entries);
    if (!entry) return;
    var service = winner.registry && winner.registry.service;
    var scriptOrigin = (service && service.directOrigin) || winner.origin;
    inject(scriptOrigin, entry.id);
  }).catch(function () {
    /* no candidate served a registry — pinpoint is not running; stay quiet */
  });
})();
