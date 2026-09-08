// Keep retired endpoints explicit: a stale client must not receive app HTML as 200.
export default function retiredNotesApi() {
  return {
    name: 'retired-notes-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const route = (req.url || '').split('?')[0];
        if (!/^\/api\/(?:frame|section)-notes\//.test(route)) return next();
        res.statusCode = 410;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'board_notes_removed' }));
      });
    },
  };
}
