CREATE TABLE creative_agent_workflow_feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_public_id VARCHAR(32) NOT NULL,
  workflow_code VARCHAR(64) NOT NULL,
  target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('project','plan')),
  target_ref VARCHAR(96) NOT NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('explicit','route_change','retry')),
  rating SMALLINT NOT NULL CHECK (rating IN (-1,1)),
  weight NUMERIC(4,2) NOT NULL CHECK (weight > 0 AND weight <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_ref, source)
);

CREATE INDEX idx_creative_agent_workflow_feedback_stats
  ON creative_agent_workflow_feedback(workflow_code, updated_at DESC);
