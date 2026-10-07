export function projectScope(user) {
  if (user.role === 'ADMIN') return {sql:'TRUE',values:[]};
  if (user.role === 'MANAGER') return {sql:'p.manager_id=$1',values:[user.id]};
  return {sql:'EXISTS (SELECT 1 FROM tasks a WHERE a.project_id=p.id AND a.assignee_id=$1)',values:[user.id]};
}
