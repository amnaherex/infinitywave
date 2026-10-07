import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
test('frontend and supplied transcript are served without authentication',async()=>{
 const app=createApp({query:async()=>({rows:[]})});
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const base=`http://localhost:${server.address().port}`;
 try{for(const path of ['/','/app.js','/styles.css','/meeting.txt']){const response=await fetch(base+path);assert.equal(response.status,200);assert.ok((await response.text()).length>100);}
 const protectedResponse=await fetch(base+'/api/projects');assert.equal(protectedResponse.status,401);
 }finally{await new Promise(r=>server.close(r));}
});
