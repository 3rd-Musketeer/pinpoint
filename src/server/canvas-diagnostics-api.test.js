import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import api, { createDiagnosticsWriter, cleanDiagnostics } from './canvas-diagnostics-api.js';

test('diagnostics serialize writes and rotate oldest records within a byte bound', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const write = createDiagnosticsWriter(dir, 40);
  await Promise.all(Array.from({ length: 30 }, (_, i) => write({ i })));
  const names = (await fs.readdir(dir)).sort();
  assert.deepEqual(names, ['canvas.ndjson', 'canvas.ndjson.1', 'canvas.ndjson.2', 'canvas.ndjson.3', 'canvas.ndjson.4']);
  const rows = [];
  for (const name of names.reverse()) {
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    assert.ok(Buffer.byteLength(text) <= 40);
    rows.push(...text.trim().split('\n').map(JSON.parse));
  }
  assert.equal(rows.at(-1).i, 29);
  assert.ok(rows[0].i > 0);
  assert.deepEqual(rows.map(r => r.i), Array.from({length:rows.length}, (_, i) => rows[0].i + i));
});

test('diagnostics accept only bounded metadata', () => {
  const result = cleanDiagnostics({session:'abc-123', events:[{type:'viewport', html:'secret', wrap:{rect:[1,2,3,4], text:'secret'}}]});
  assert.deepEqual(result.events, [{type:'viewport', wrap:{rect:[1,2,3,4]}}]);
  assert.throws(() => cleanDiagnostics({session:'../bad', events:[]}));
  assert.throws(() => cleanDiagnostics({session:'abc', events:Array(33).fill({})}));
});

test('local diagnostics endpoint persists valid batches and rejects foreign or oversized requests', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostics-api-'));
  let middleware;
  api({dir}).configureServer({middlewares:{use(fn){middleware=fn;}}});
  const server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const send=(body, source=origin)=>fetch(origin+'/api/canvas-diagnostics',{method:'POST',headers:{origin:source,'content-type':'application/json'},body});
  const body=JSON.stringify({session:'test',events:[{type:'start'}]});
  assert.equal((await send(body)).status,204);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'canvas.ndjson'),'utf8')).session,'test');
  assert.equal((await send(body,'https://foreign.example')).status,403);
  assert.equal((await send('x'.repeat(65537))).status,413);
  assert.equal((await send('{}')).status,400);
});
