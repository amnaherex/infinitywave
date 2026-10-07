// Dedicated seeded PostgreSQL test database required; generated fixtures are cleaned up.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.js';
import {createApp} from '../src/app.js';
const marker='integration-'+randomUUID();
const task=(assigneeId)=>({title:'Test task',description:'Test',assigneeId,deadline:'2026-10-12',estimatedHours:12});
const fixture={projects:[{name:marker+'-web',clientName:'Test',description:'Test',managerId:'PM01',deadline:'2026-10-20',tasks:[task('DEV01'),task('DEV02')]},{name:marker+'-mobile',clientName:'Test',description:'Test',managerId:'PM02',deadline:'2026-10-24',tasks:[task('DEV02')]}]};
let calls=0;
const server=createApp(pool,async text=>{calls++;if(text==='invalid')return {projects:[]};if(text==='failure')throw new Error('simulated');return fixture;}).listen(0);
await new Promise(r=>server.once('listening',r));
const base=`http://localhost:${server.address().port}`,cookies=[];
async function request(path,{cookie,body,key,method=body?'POST':'GET'}={}) {
 const r=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,json:r.status===204?null:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function login(name){const r=await request('/api/auth/login',{body:{email:name+'@novaworks.example',password:'Demo123!'}});assert.equal(r.status,200);cookies.push(r.cookie);return r.cookie;}
try {
 assert.equal((await request('/api/projects')).status,401);
 const admin=await login('admin'),manager=await login('ayesha'),agent=await login('ali'),hamza=await login('hamza');
 assert.equal((await request('/api/transcript-conversions',{cookie:agent,body:{transcript:'test'},key:marker})).status,403);
 const r=await request('/api/transcript-conversions',{cookie:admin,body:{transcript:'test'},key:marker});assert.equal(r.status,201);assert.equal(r.json.data.taskCount,3);
 const [web,mobile]=r.json.data.projects;
 const detail=await request('/api/projects/'+web.id,{cookie:agent});assert.equal(detail.json.data.tasks.length,1);assert.equal(detail.json.data.tasks[0].assigneeId,'DEV01');
 assert.equal((await request('/api/projects/'+mobile.id,{cookie:manager})).status,404);
 assert.equal((await request('/api/projects/'+mobile.id,{cookie:agent})).status,404);
 assert.equal((await request('/api/tasks/'+web.tasks[1].id,{cookie:agent})).status,404);
 assert.equal((await request('/api/projects/'+web.id,{cookie:manager})).json.data.tasks.length,2);
 assert.equal((await request('/api/tasks?projectId='+mobile.id,{cookie:hamza})).json.data.length,1);
 const replay=await request('/api/transcript-conversions',{cookie:admin,body:{transcript:'test'},key:marker});assert.equal(replay.json.data.projects[0].id,web.id);assert.equal(calls,1);
 assert.equal((await request('/api/transcript-conversions',{cookie:admin,body:{transcript:'changed'},key:marker})).status,409);
 assert.equal((await request('/api/transcript-conversions',{cookie:admin,body:{transcript:'invalid'},key:marker+'-invalid'})).status,422);
 assert.equal((await request('/api/transcript-conversions',{cookie:admin,body:{transcript:'failure'},key:marker+'-failure'})).status,500);
 assert.equal((await pool.query('SELECT count(*)::int AS total FROM projects WHERE name LIKE $1',[marker+'%'])).rows[0].total,2);
 await request('/api/auth/logout',{cookie:agent,method:'POST'});assert.equal((await request('/api/auth/me',{cookie:agent})).status,401);
 console.log('PASS: authentication, access restrictions, agent privacy, persistent records, idempotency, invalid draft, AI failure, logout.');
} finally {
 await pool.query('DELETE FROM projects WHERE name LIKE $1',[marker+'%']);
 await pool.query('DELETE FROM creation_requests WHERE request_key LIKE $1',[marker+'%']);
 for(const cookie of cookies)await request('/api/auth/logout',{cookie,method:'POST'});
 await new Promise(r=>server.close(r));await pool.end();
}
