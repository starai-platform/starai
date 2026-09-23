CREATE INDEX IF NOT EXISTS idx_workflow_projects_agent_outcomes
  ON workflow_projects(workflow_id, created_at DESC)
  WHERE inputs ? '_agent_confirmation';
