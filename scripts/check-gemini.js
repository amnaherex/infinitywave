import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {extract} from '../src/ai.js';
import {validateDraft} from '../src/validation.js';
import {accounts} from './accounts.js';
const directory=accounts.map(([id,name,email,role,specialization,skills])=>({id,name,role,skills}));
const transcript=await readFile(new URL('../examples/meeting.txt',import.meta.url),'utf8');
try {
 const draft=validateDraft(await extract(transcript,directory),directory);
 console.log(JSON.stringify(draft.projects.map(p=>({name:p.name,manager:p.managerId,deadline:p.deadline,tasks:p.tasks.length,hours:p.tasks.reduce((n,t)=>n+t.estimatedHours,0)})),null,2));
}catch(e){console.error(e.code||e.name,e.message);process.exitCode=1;}
