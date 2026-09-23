CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id
  ON conversation_messages(conversation_id, id DESC);
