ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS runtime_config JSONB NOT NULL DEFAULT '{}';

UPDATE workflow_definitions
SET runtime_config = jsonb_build_object(
  'agent_mode', 'custom_nodes',
  'generation_type', category
)
WHERE runtime_config = '{}'::jsonb;
