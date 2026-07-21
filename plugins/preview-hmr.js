export default function previewHmr() {
  return {
    name: 'preview-hmr',
    handleHotUpdate({ file, server }) {
      const rel = file.replace(/\\/g, '/');
      if (/\/previews\/_index(?:\.local)?\.json$/.test(rel)) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
      const preview = rel.match(/\/previews\/([^/]+)\/(?:board\.json|[^/]+\.(?:html|js))$/);
      if (preview) {
        server.ws.send({ type: 'custom', event: 'preview:update', data: { id: preview[1] } });
        return [];
      }
      // Component source or meta — refresh Component Library + any open flow that may include it
      if (/\/components\//.test(rel) && (/\.html$/.test(rel) || /meta\.json$/.test(rel) || /_index\.json$/.test(rel))) {
        server.ws.send({ type: 'custom', event: 'preview:update', data: { id: 'components', alsoActive: true } });
        return [];
      }
    },
  };
}
