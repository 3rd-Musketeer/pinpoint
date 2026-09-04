// PREVIEW_TEMPLATE_ONLY=1 hides instance-local content (previews/_index.local.json,
// components outside kits/ios/components/_index.json) so checks see the same board set on
// every machine — e2e and release verification run against pure template state.
export function templateOnly() {
  return !!process.env.PREVIEW_TEMPLATE_ONLY;
}

export default function templateOnlyPlugin() {
  return {
    name: 'template-only',
    configureServer(server) {
      if (!templateOnly()) return;
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url === '/previews/_index.local.json') {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('template-only mode: instance-local manifest hidden');
          return;
        }
        next();
      });
    },
  };
}
