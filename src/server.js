import {pool} from './db.js';
import {createApp} from './app.js';
if(!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env before starting.');
const server=createApp(pool).listen(Number(process.env.PORT||4000),()=>console.log('InfinityWave backend listening on port '+(process.env.PORT||4000)));
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0);}));
