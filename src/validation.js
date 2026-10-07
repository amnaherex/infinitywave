import { z } from 'zod';
import { ApiError } from './errors.js';
const text = z.string().trim().min(1).max(1000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const parsed = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === v;
}, 'Use a real calendar date');
export const draftSchema = z.object({ projects: z.array(z.object({
  name: text, clientName: text, description: z.string().trim().min(1).max(10000), managerId: text, deadline: date,
  tasks: z.array(z.object({title: text, description: z.string().trim().min(1).max(10000), assigneeId: text, deadline: date, estimatedHours: z.number().positive().max(100000)}).strict()).min(1).max(200)
}).strict()).min(1).max(50)}).strict();
export function validateDraft(input, directory) {
  const result = draftSchema.safeParse(input);
  if (!result.success) throw new ApiError(422, 'INVALID_DRAFT', 'Correct the unresolved project/task fields and resubmit.', result.error.issues.map(i=>({field:i.path.join('.'), message:i.message})));
  const issues = [];
  result.data.projects.forEach((p,i)=> {
    if (!directory.some(u=>u.id===p.managerId && u.role==='MANAGER')) issues.push({field:`projects.${i}.managerId`,message:'Select an existing manager'});
    p.tasks.forEach((t,j)=> {
      if (!directory.some(u=>u.id===t.assigneeId && u.role==='AGENT')) issues.push({field:`projects.${i}.tasks.${j}.assigneeId`,message:'Select an existing agent'});
      if (t.deadline > p.deadline) issues.push({field:`projects.${i}.tasks.${j}.deadline`,message:'Task deadline exceeds project deadline'});
    });
  });
  if (issues.length) throw new ApiError(422,'INVALID_DRAFT','Correct the unresolved assignments or dates and resubmit.',issues);
  return result.data;
}
export function parse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) throw new ApiError(400,'INVALID_INPUT','Invalid request.',r.error.issues.map(i=>({field:i.path.join('.'),message:i.message})));
  return r.data;
}
export const transcriptSchema = z.object({transcript:z.string().trim().min(1).max(100000)}).strict();
export const loginSchema = z.object({email:z.email().transform(v=>v.toLowerCase()), password:z.string().min(1).max(200)}).strict();
// Gemini's portable schema subset controls shape; full constraints run locally.
// Leave unresolved values representable so the backend can ask for correction.
function shapeOnly(schema) {
  const result={type:schema.type};
  if(schema.properties) result.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,shapeOnly(value)]));
  if(schema.required) result.required=schema.required;
  if(schema.items) result.items=shapeOnly(schema.items);
  return result;
}
export const jsonSchema = shapeOnly(z.toJSONSchema(draftSchema));
