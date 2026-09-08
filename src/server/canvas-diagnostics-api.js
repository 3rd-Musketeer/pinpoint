import fs from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from './lib/annotate-data-dir.js';

// Fixed filenames, one serialized writer and five bounded files per service data root.
export function createDiagnosticsWriter(dir, maxBytes = 10 * 1024 * 1024) {
  let queue = Promise.resolve(), pending = 0;
  return async record => {
    if (pending >= 32) throw new Error('busy');
    const line = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(line) > maxBytes) throw new Error('size');
    pending++;
    const job = queue.then(async () => {
      await fs.mkdir(dir, {recursive:true, mode:0o700});
      const file = path.join(dir,'canvas.ndjson');
      const size = await fs.stat(file).then(s=>s.size, e=>{if(e.code==='ENOENT')return 0;throw e;});
      if (size + Buffer.byteLength(line) > maxBytes) {
        await fs.rm(file+'.4', {force:true});
        for (let i = 3; i >= 0; i--) {
          const from = i === 0 ? file : file+'.'+i;
          const to = file+'.'+(i+1);
          await fs.rename(from,to).catch(e=>{if(e.code!=='ENOENT')throw e;});
        }
      }
      await fs.appendFile(file,line,{mode:0o600});
    });
    queue = job.catch(()=>{});
    try { await job; } finally { pending--; }
  };
}
function pick(source, fields) {
  const out = {};
  for (const key of fields) {
    const v = source?.[key];
    if (typeof v==='number' && Number.isFinite(v) || typeof v==='boolean') out[key]=v;
    else if(typeof v==='string')out[key]=v.slice(0,240);
    else if(Array.isArray(v)&&v.length<=4&&v.every(Number.isFinite))out[key]=v;
  }
  return out;
}
export function cleanDiagnostics(body) {
  if(!/^[a-zA-Z0-9-]{1,64}$/.test(body?.session||'') || !Array.isArray(body.events) || body.events.length>32) throw new Error('invalid');
  const events=body.events.map(event=>{
    const row=pick(event,['at','ms','type','page','input','scroll','extent','viewport','dpr','maxFrameGap','hidden','name','line','column']);
    for(const key of ['wrap','panel'])if(event[key])row[key]=pick(event[key],['rect','display','visibility','opacity','transform','contentVisibility','contain']);
    return row;
  });
  return {received:new Date().toISOString(),session:body.session,started:String(body.started||'').slice(0,40),events};
}
export default function canvasDiagnosticsApi({dir=path.join(dataRoot(),'diagnostics')}={}) {
  const write=createDiagnosticsWriter(dir);
  return {name:'canvas-diagnostics-api',configureServer(server){
    server.middlewares.use(async(req,res,next)=>{
      if(req.url?.split('?')[0]!=='/api/canvas-diagnostics')return next();
      const reply=(status)=>{res.statusCode=status;res.end();};
      if(req.method!=='POST')return reply(405);
      // This endpoint belongs to the local workbench, not arbitrary injected sites.
      const origin=req.headers.origin;
      try {if(origin&&new URL(origin).host!==req.headers.host)return reply(403);}catch{return reply(403);}
      if(!req.headers['content-type']?.startsWith('application/json'))return reply(415);
      try {
        let size=0;const chunks=[];
        for await(const chunk of req){size+=chunk.length;if(size<=65536)chunks.push(chunk);}
        if(size>65536)return reply(413);
        let body;
        try {body=cleanDiagnostics(JSON.parse(Buffer.concat(chunks).toString()));}catch{return reply(400);}
        await write(body);reply(204);
      }catch(error){reply(error.message==='busy'?429:500);}
    });
  }};
}
