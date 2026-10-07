CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('ADMIN','MANAGER','AGENT')),
 specialization text NOT NULL, skills text[] NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
 id uuid PRIMARY KEY, name text NOT NULL, client_name text NOT NULL, description text NOT NULL,
 manager_id text NOT NULL REFERENCES users(id), deadline date NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 title text NOT NULL, description text NOT NULL, assignee_id text NOT NULL REFERENCES users(id),
 deadline date NOT NULL, estimated_hours numeric NOT NULL CHECK(estimated_hours > 0)
);
CREATE INDEX IF NOT EXISTS projects_manager ON projects(manager_id);
CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE TABLE IF NOT EXISTS creation_requests (
 user_id text NOT NULL REFERENCES users(id), request_key text NOT NULL, body_hash text NOT NULL,
 result jsonb NOT NULL, PRIMARY KEY(user_id,request_key)
);
