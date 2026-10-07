import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {ApiError} from './errors.js';
import {parse,loginSchema,transcriptSchema,validateDraft} from './validation.js';
import {projectScope} from './permissions.js';
import {extract} from './ai.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const userFields='id,name,email,role,specialization,skills';
const projectFields='p.id,p.name,p.client_name AS "clientName",p.description,p.manager_id AS "managerId",u.name AS "managerName",to_char(p.deadline,\'YYYY-MM-DD\') AS deadline';
const taskFields='t.id,t.project_id AS "projectId",p.name AS "projectName",t.title,t.description,t.assignee_id AS "assigneeId",a.name AS "assigneeName",to_char(t.deadline,\'YYYY-MM-DD\') AS deadline,t.estimated_hours::float AS "estimatedHours"';
function paging(req) {
 const page=Number(req.query.page??1),pageSize=Number(req.query.pageSize??20);
 if(!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100) throw new ApiError(400,'INVALID_PAGINATION','page must be positive and pageSize must be 1–100.');
 return {page,pageSize,offset:(page-1)*pageSize};
}
function uuid(value) {if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(404,'NOT_FOUND','Record not found.');return value;}
export function createApp(pool, ai=extract) {
 const app=express();app.disable('x-powered-by');app.use(helmet());
 app.use(cors({origin:process.env.FRONTEND_ORIGIN||'http://localhost:5173',credentials:true,allowedHeaders:['Content-Type','Idempotency-Key']}));
 app.use(express.json({limit:'512kb'}));
 const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'};
 app.use('/api',(req,res,next)=> {
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin!==(process.env.FRONTEND_ORIGIN||'http://localhost:5173')) return next(new ApiError(403,'ORIGIN_DENIED','Request origin is not permitted.'));
  res.set('Cache-Control','no-store');next();
 });
 app.get('/health',async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok'});});
 app.post('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,handler:(req,res)=>res.status(429).json({error:{code:'LOGIN_LIMIT',message:'Too many login attempts. Try later.'}})}),async(req,res)=>{
  const {email,password}=parse(loginSchema,req.body);
  const {rows}=await pool.query(`SELECT ${userFields},password_hash FROM users WHERE email=$1`,[email]);
  const user=rows[0];
  if(!user||!await bcrypt.compare(password,user.password_hash)) throw new ApiError(401,'INVALID_CREDENTIALS','Invalid email or password.');
  const existing=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);
  if(existing) await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(existing)]);
  const token=randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'12 hours\')',[hash(token),user.id]);
  delete user.password_hash;res.cookie('session',token,{...cookieOptions,maxAge:12*60*60*1000});res.json({data:user});
 });
 app.use('/api',async(req,res,next)=>{
  const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);
  if(!token) throw new ApiError(401,'UNAUTHENTICATED','Log in to continue.');
  const {rows}=await pool.query(`SELECT ${userFields.split(',').map(f=>'u.'+f).join(',')} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,[hash(token)]);
  if(!rows[0]) throw new ApiError(401,'UNAUTHENTICATED','Session expired. Log in again.');
  req.user=rows[0];req.sessionHash=hash(token);next();
 });
 app.get('/api/auth/me',(req,res)=>res.json({data:req.user}));
 app.post('/api/auth/logout',async(req,res)=>{await pool.query('DELETE FROM sessions WHERE token_hash=$1',[req.sessionHash]);res.clearCookie('session',cookieOptions);res.status(204).end();});
 app.get('/api/team',async(req,res)=>{const {rows}=await pool.query('SELECT id,name,role,specialization,skills FROM users ORDER BY id');res.json({data:rows});});
 app.get('/api/projects',async(req,res)=>{
  const scope=projectScope(req.user), pg=paging(req),n=scope.values.length;
  const count=await pool.query(`SELECT count(*)::int AS total FROM projects p WHERE ${scope.sql}`,scope.values);
  const {rows}=await pool.query(`SELECT ${projectFields} FROM projects p JOIN users u ON u.id=p.manager_id WHERE ${scope.sql} ORDER BY p.created_at,p.id LIMIT $${n+1} OFFSET $${n+2}`,[...scope.values,pg.pageSize,pg.offset]);
  res.json({data:rows,pagination:{page:pg.page,pageSize:pg.pageSize,totalItems:count.rows[0].total}});
 });
 async function project(user,id) {
  const scope=projectScope(user),n=scope.values.length;
  const {rows}=await pool.query(`SELECT ${projectFields} FROM projects p JOIN users u ON u.id=p.manager_id WHERE ${scope.sql} AND p.id=$${n+1}`,[...scope.values,uuid(id)]);
  if(!rows[0]) throw new ApiError(404,'NOT_FOUND','Project not found.');return rows[0];
 }
 async function tasks(user,projectId) {
  const scope=projectScope(user);let clause=scope.sql;const values=[...scope.values];
  if(user.role==='AGENT') clause+=' AND t.assignee_id=$1';
  if(projectId) {values.push(projectId);clause+=` AND p.id=$${values.length}`;}
  return {clause,values};
 }
 app.get('/api/projects/:id',async(req,res)=>{
  const p=await project(req.user,req.params.id),{clause,values}=await tasks(req.user,p.id);
  const {rows}=await pool.query(`SELECT ${taskFields} FROM tasks t JOIN projects p ON p.id=t.project_id JOIN users a ON a.id=t.assignee_id WHERE ${clause} ORDER BY t.deadline,t.id`,values);
  res.json({data:{...p,tasks:rows}});
 });
 app.get('/api/tasks',async(req,res)=>{
  const projectId=req.query.projectId;
  if(projectId) await project(req.user,projectId);
  const {clause,values}=await tasks(req.user,projectId),pg=paging(req),n=values.length;
  const count=await pool.query(`SELECT count(*)::int AS total FROM tasks t JOIN projects p ON p.id=t.project_id WHERE ${clause}`,values);
  const {rows}=await pool.query(`SELECT ${taskFields} FROM tasks t JOIN projects p ON p.id=t.project_id JOIN users a ON a.id=t.assignee_id WHERE ${clause} ORDER BY t.deadline,t.id LIMIT $${n+1} OFFSET $${n+2}`,[...values,pg.pageSize,pg.offset]);
  res.json({data:rows,pagination:{page:pg.page,pageSize:pg.pageSize,totalItems:count.rows[0].total}});
 });
 app.get('/api/tasks/:id',async(req,res)=>{
  const {clause,values}=await tasks(req.user);values.push(uuid(req.params.id));
  const {rows}=await pool.query(`SELECT ${taskFields} FROM tasks t JOIN projects p ON p.id=t.project_id JOIN users a ON a.id=t.assignee_id WHERE ${clause} AND t.id=$${values.length}`,values);
  if(!rows[0]) throw new ApiError(404,'NOT_FOUND','Task not found.');res.json({data:rows[0]});
 });
 const admin=(req,res,next)=>{if(req.user.role!=='ADMIN') throw new ApiError(403,'FORBIDDEN','Only the administrator may create projects.');next();};
 app.post('/api/transcript-conversions',admin,async(req,res)=> {
  const {transcript}=parse(transcriptSchema,req.body);
  await save(req,res,async directory=> {
   const draft=await ai(transcript,directory);
   try{return validateDraft(draft,directory);}catch(e){if(e instanceof ApiError) e.details={issues:e.details,draft};throw e;}
  });
 });
 app.post('/api/project-batches',admin,async(req,res)=>save(req,res,async directory=>validateDraft(req.body,directory)));
 async function save(req,res,generate) {
  const key=req.get('Idempotency-Key');
  if(!key||key.length>200||!/^[\w.-]+$/.test(key)) throw new ApiError(400,'IDEMPOTENCY_KEY_REQUIRED','Send a stable Idempotency-Key (UUID recommended) for this creation attempt.');
  const bodyHash=hash(JSON.stringify({path:req.path,body:req.body}));const client=await pool.connect();
  try {
   // A PostgreSQL session advisory lock prevents concurrent conversions for this admin,
   // including attempts using different keys. It is released in finally.
   const lock=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',['creation:'+req.user.id]);
   if(!lock.rows[0].acquired) throw new ApiError(409,'CREATION_IN_PROGRESS','A conversion is already processing. Wait, then retry with the same key.');
   const prior=await client.query('SELECT body_hash,result FROM creation_requests WHERE user_id=$1 AND request_key=$2',[req.user.id,key]);
   if(prior.rows[0]) {
    if(prior.rows[0].body_hash!==bodyHash) throw new ApiError(409,'KEY_REUSED','Use a new key for changed input.');
    return res.json(prior.rows[0].result);
   }
   const {rows:directory}=await client.query('SELECT id,name,role,skills FROM users ORDER BY id');
   const draft=await generate(directory);
   await client.query('BEGIN');
   const projects=[];
   for(const p of draft.projects) {
    const id=randomUUID();await client.query('INSERT INTO projects(id,name,client_name,description,manager_id,deadline) VALUES($1,$2,$3,$4,$5,$6)',[id,p.name,p.clientName,p.description,p.managerId,p.deadline]);
    const savedTasks=[];
    for(const t of p.tasks) {const taskId=randomUUID();await client.query('INSERT INTO tasks(id,project_id,title,description,assignee_id,deadline,estimated_hours) VALUES($1,$2,$3,$4,$5,$6,$7)',[taskId,id,t.title,t.description,t.assigneeId,t.deadline,t.estimatedHours]);savedTasks.push({id:taskId,projectId:id,...t});}
    projects.push({...p,id,tasks:savedTasks});
   }
   const result={data:{projects,projectCount:projects.length,taskCount:projects.reduce((sum,p)=>sum+p.tasks.length,0)}};
   await client.query('INSERT INTO creation_requests(user_id,request_key,body_hash,result) VALUES($1,$2,$3,$4)',[req.user.id,key,bodyHash,result]);
   await client.query('COMMIT');res.status(201).json(result);
  }catch(e){await client.query('ROLLBACK');throw e;}
  finally{await client.query('SELECT pg_advisory_unlock(hashtext($1))',['creation:'+req.user.id]);client.release();}
 }
 app.use((req,res,next)=>next(new ApiError(404,'NOT_FOUND','Endpoint not found.')));
 app.use((err,req,res,next)=>{
  if(err.type==='entity.parse.failed') err=new ApiError(400,'INVALID_JSON','Request body must be valid JSON.');
  if(err.type==='entity.too.large') err=new ApiError(413,'INPUT_TOO_LARGE','Request body exceeds 512 KB.');
  if(!(err instanceof ApiError)){console.error('Backend error:',err.code||err.name);err=new ApiError(500,'INTERNAL_ERROR','The operation failed. Try again.');}
  res.status(err.status).json({error:{code:err.code,message:err.message,...(err.details?{details:err.details}:{})}});
 });return app;
}
