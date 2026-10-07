import {readFile} from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import {pool} from '../src/db.js';
import {accounts} from './accounts.js';
const client=await pool.connect();
try {
 await client.query('BEGIN');
 await client.query(await readFile(new URL('../sql/schema.sql',import.meta.url),'utf8'));
 const hash=await bcrypt.hash('Demo123!',12);
 for(const [id,name,email,role,specialization,skills] of accounts) await client.query('INSERT INTO users(id,name,email,password_hash,role,specialization,skills) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,specialization=EXCLUDED.specialization,skills=EXCLUDED.skills',[id,name,email+'@novaworks.example',hash,role,specialization,skills]);
 await client.query('COMMIT'); console.log('Database ready; 10 demo users seeded without duplicates.');
} catch(e) {await client.query('ROLLBACK'); throw e;} finally {client.release();await pool.end();}
