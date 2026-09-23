import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { annotationPageTimes } from './page-times.js';
import { createAnnotationStore } from './annotation-store.js';
import { addRegistryEntry, updateRegistryEntry } from './registry-store.js';
import { loadRegistry } from './registry.js';
import { activityRows, sortPages } from '../../workbench/lib/page-sort.js';

test('annotation times are per page, survive deletion/restart, ignore no-op and rejected writes', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'page-times-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let at=1000;const store=createAnnotationStore({dataDir:dir,now:()=>new Date(at)});
 let result=store.save({page:'index',baseRevision:0,annotations:[{id:'a',pageId:'a',comment:'one'},{id:'b',pageId:'b',comment:'two'}]});
 at=2000;result=store.save({page:'index',baseRevision:1,annotations:result.doc.annotations.filter(a=>a.id==='b')});
 assert.deepEqual(annotationPageTimes(dir),{a:2000,b:1000});
 at=3000;store.save({page:'index',baseRevision:2,annotations:result.doc.annotations});
 store.save({page:'index',baseRevision:0,annotations:[]});
 assert.deepEqual(annotationPageTimes(dir),{a:2000,b:1000});
});

test('new registration records addition once and move preserves it; legacy is unknown', t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'page-added-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'registry.json');const start=Date.now();
 const entry=addRegistryEntry(file,{id:'site',kind:'url',url:'https://example.com'});
 assert.ok(entry.addedAt>=start);
 const moved=updateRegistryEntry(file,{id:entry.id,kind:'url',url:'https://example.org'});
 assert.equal(moved.addedAt,entry.addedAt);
 const r=loadRegistry({root:dir,path:file,log:()=>{}});
 assert.equal(r.entries[0].addedAt,entry.addedAt);
});

test('recent uses latest of three times and time sorts keep unknown at the bottom',()=>{
 const pages=[{id:'a',addedAt:300},{id:'b',mtime:200},{id:'c',annotatedAt:400},{id:'unknown'}];
 assert.deepEqual(activityRows(pages).map(r=>r.page.id),['c','a','b']);
 assert.equal(sortPages(pages,'added')[0].id,'a');
 assert.equal(sortPages(pages,'updated')[0].id,'b');
 assert.equal(sortPages(pages,'annotated')[0].id,'c');
});
