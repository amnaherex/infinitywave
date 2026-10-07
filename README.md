# InfinityWave — AI Project Manager backend

Backend for the Infinity Hack 2026 NovaWorks challenge. Admin submits meeting text; Gemini extracts projects/tasks; validated records are saved atomically in PostgreSQL. Managers see their own projects; agents see only their tasks and related project details.

## Stack
Node.js 22+, Express 5, PostgreSQL (`pg`), Zod, bcryptjs, Gemini REST API. Database-backed HttpOnly cookie sessions and server-side role filtering. No frontend, registration, cost calculation or progress monitoring.

## Local setup — PowerShell
Install Node.js 22+ and PostgreSQL, or run Docker Desktop with its Linux engine.
```powershell
npm.cmd ci
Copy-Item .env.example .env
docker compose up -d
npm.cmd run db:setup
npm.cmd start
```
For an existing PostgreSQL server, skip Docker, create an empty `infinitywave` database and configure `DATABASE_URL`. Edit `.env` before setup/start. `db:setup` creates tables and upserts ten demo accounts without duplicates; rerunning resets their passwords.

| Variable | Meaning |
| --- | --- |
| DATABASE_URL | PostgreSQL URL; URL-encode special characters in credentials |
| GEMINI_API_KEY | Your key, stored only on the backend |
| GEMINI_MODEL | Model supporting structured JSON; default gemini-3.8-flash |
| FRONTEND_ORIGIN | Exact frontend origin; default http://localhost:5173 |
| PORT | Default 4000 |
| NODE_ENV | development locally; production for secure HTTPS cookies |

No live key is included. Never commit `.env`. Production requires same-site HTTPS frontend/backend routing and the database provider's required TLS settings. Browser requests must use `credentials: 'include'`. Permissions run in backend queries; database access must be restricted to the backend.

## Demo users
Every account uses **Demo123!**. Passwords are stored as bcrypt hashes.

| Email | Role | Name |
| --- | --- | --- |
| admin@novaworks.example | ADMIN | Admin |
| ayesha@novaworks.example | MANAGER | Ayesha Khan |
| bilal@novaworks.example | MANAGER | Bilal Ahmed |
| hina@novaworks.example | MANAGER | Hina Malik |
| ali@novaworks.example | AGENT | Ali Raza |
| hamza@novaworks.example | AGENT | Hamza Shah |
| sara@novaworks.example | AGENT | Sara Noor |
| usman@novaworks.example | AGENT | Usman Tariq |
| zain@novaworks.example | AGENT | Zain Abbas |
| maryam@novaworks.example | AGENT | Maryam Asif |

## API
Responses: `{data: ...}`; errors: `{error: {code, message, details?}}`. Lists accept `page` (1) and `pageSize` (20, max 100), and return `pagination.totalItems`. Authentication uses the login cookie, never caller-supplied roles. Missing session 401; forbidden creation 403; missing or inaccessible resource 404; invalid AI draft 422; conflicting creation 409.

| Method / endpoint | Input / response |
| --- | --- |
| GET /health | Database health |
| POST /api/auth/login | `{email,password}` → safe user and cookie |
| GET /api/auth/me | Current user |
| POST /api/auth/logout | Revokes session; 204 |
| GET /api/team | Safe team directory |
| GET /api/projects | Permitted projects |
| GET /api/projects/:id | Permitted project and tasks |
| GET /api/tasks | Permitted tasks; optional projectId |
| GET /api/tasks/:id | Permitted task |
| POST /api/transcript-conversions | Admin: `{transcript}` → saved projects and counts |
| POST /api/project-batches | Admin: corrected `{projects:[...]}` → saved batch |

Both creation endpoints require `Idempotency-Key`, a stable UUID for one intended submission. Retrying the same key/body returns the saved result without duplicates. Changed body with an old key returns 409. A PostgreSQL advisory lock blocks simultaneous conversions by the same admin, including different keys. Successful keys persist without automatic expiry. A new key represents a new batch and can create duplicate content intentionally.

AI gets only IDs, names, roles and skills. Required fields, real dates, positive hours, existing correct-role assignments, and task deadlines within project deadlines are validated. Invalid AI output returns `error.details.issues` and `error.details.draft` and saves nothing. Correct the draft and submit to `/api/project-batches` with a new key, or correct/reconvert the transcript.

Project shape: `{name,clientName,description,managerId,deadline,tasks}`. Task shape: `{title,description,assigneeId,deadline,estimatedHours}`. Dates are YYYY-MM-DD. Application generates IDs and relationships. Database tables: users, sessions, projects, tasks, creation_requests.

### Frontend example
```javascript
const API = 'http://localhost:4000';
await fetch(`${API}/api/auth/login`, {
 method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
 body:JSON.stringify({email:'admin@novaworks.example',password:'Demo123!'})
});
const key = crypto.randomUUID(); // retain this key when retrying this submission
const response = await fetch(`${API}/api/transcript-conversions`, {
 method:'POST', credentials:'include',
 headers:{'Content-Type':'application/json','Idempotency-Key':key},
 body:JSON.stringify({transcript:meetingText})
});
const result = await response.json();
```
Disable the creation button while processing. Display loading, validation issues, and returned project/task counts. `examples/demo.ps1` provides a command-line demo.

## Verification
```powershell
npm.cmd test
# Use a dedicated, seeded TEST database for integration checks:
npm.cmd run test:integration
```
Unit tests check dates, roles, assignments and access scopes. Integration tests use real PostgreSQL with injected AI fixtures, not live Gemini. Real AI extraction must be checked separately using `examples/meeting.txt`, which contains the full supplied meeting and no answer key.

Expect UrbanCart/Ayesha/2026-10-20, QuickServe/Bilal/2026-10-24, HelpDeskPro/Hina/2026-10-22: four tasks each, 12 tasks total, hours 40/46/38. Check revised UrbanCart integration date 19 October, QuickServe integration 10 hours, HelpDeskPro testing owner Maryam, no rejected features or Kamran assignments. Ayesha sees only UrbanCart; Ali only his three tasks; Hamza his two tasks across two projects. Test direct unauthorized IDs, refresh/restart persistence, and a modified final QuickServe integration estimate of 12 hours/deadline 23 October with a new key.

## Deployment and submission
No live deployment/video is included. Deploy to a Node-compatible host with hosted PostgreSQL. Configure environment variables, run `npm ci`, `npm run db:setup` once, then `npm start`. Configure HTTPS, same-site routing, CORS and database TLS. Docker credentials are local demo values. Before judging add actual team name, live/demo-video links, deployment provider and deployment steps. Local submissions require a recorded demo plus setup instructions.

## Limitations
Backend only; frontend remains to be built. Gemini needs internet/quota and output accuracy requires rehearsal. Optional editing is limited to correcting unsaved drafts. Rate limiting is per process; creation locking works across backend instances. Expired sessions are rejected but not automatically pruned. Schema setup is an initial idempotent script, not a migration framework. Failed conversion may call Gemini again on retry, but cannot leave partial project records.
