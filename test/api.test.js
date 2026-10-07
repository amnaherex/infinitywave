import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
const directory=[{id:'PM01',name:'Manager',role:'MANAGER',skills:[]},{id:'DEV01',name:'Agent',role:'AGENT',skills:[]}];
const draft={projects:[{name:'Demo',clientName:'Client',description:'Demo',managerId:'PM01',deadline:'2026-10-20',tasks:[{title:'UI',description:'UI work',assigneeId:'DEV01',deadline:'2026-10-12',estimatedHours:12}]}]};
async function harness(role,ai,{failTask=false}={}) {
 const commands=[];
 const client={query:async sql=>{commands.push(sql);if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};if(sql.includes('FROM creation_requests'))return {rows:[]};if(sql.includes('SELECT id,name,role,skills'))return {rows:directory};if(sql.startsWith('INSERT INTO tasks')&&failTask)throw Object.assign(new Error('insert failed'),{code:'23503'});return {rows:[]};},release(){}};
 const pool={connect:async()=>client,query:async sql=>{if(sql.includes('FROM sessions'))return {rows:[{id:'test',role}]};return {rows:[]};}};
 const server=createApp(pool,ai).listen(0);await new Promise(r=>server.once('listening',r));
 return {commands,call:async()=> {const r=await fetch(`http://localhost:${server.address().port}/api/transcript-conversions`,{method:'POST',headers:{Cookie:'session=test','Content-Type':'application/json','Idempotency-Key':'test-key'},body:JSON.stringify({transcript:'meeting'})});return {status:r.status,body:await r.json()};},close:()=>new Promise(r=>server.close(r))};
}
test('non-admin cannot invoke AI or write records',async()=>{let called=false;const h=await harness('AGENT',async()=>{called=true;return draft;});try{assert.equal((await h.call()).status,403);assert.equal(called,false);assert.equal(h.commands.length,0);}finally{await h.close();}});
test('invalid AI output writes no projects',async()=>{const h=await harness('ADMIN',async()=>({projects:[]}));try{const r=await h.call();assert.equal(r.status,422);assert.ok(r.body.error.details.issues);assert.equal(h.commands.some(s=>s.startsWith('INSERT')),false);}finally{await h.close();}});
test('mid-batch insert failure rolls back and never commits',async()=>{const h=await harness('ADMIN',async()=>draft,{failTask:true});try{assert.equal((await h.call()).status,500);assert.ok(h.commands.includes('BEGIN'));assert.ok(h.commands.includes('ROLLBACK'));assert.equal(h.commands.includes('COMMIT'),false);}finally{await h.close();}});
test('successful conversion commits both records and idempotency result',async()=>{const h=await harness('ADMIN',async()=>draft);try{const r=await h.call();assert.equal(r.status,201);assert.equal(r.body.data.taskCount,1);assert.ok(h.commands.includes('COMMIT'));assert.ok(h.commands.some(s=>s.startsWith('INSERT INTO creation_requests')));}finally{await h.close();}});
