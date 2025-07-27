-- Initialize the database with proper indexes and constraints

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_businesses_ig_username ON businesses(ig_username);
CREATE INDEX IF NOT EXISTS idx_businesses_chatbot_id ON businesses(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_sessions_business_id ON sessions(business_id);
CREATE INDEX IF NOT EXISTS idx_messages_business_id ON messages(business_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_is_incoming ON messages(is_incoming);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_business_timestamp ON messages(business_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_timestamp ON messages(thread_id, timestamp DESC);

-- Add comments to tables
COMMENT ON TABLE businesses IS 'Stores business account information and chatbot configurations';
COMMENT ON TABLE sessions IS 'Stores serialized Instagram session data for each business';
COMMENT ON TABLE messages IS 'Stores Instagram messages for logging and debugging purposes';

-- Add column comments
COMMENT ON COLUMN businesses.ig_username IS 'Instagram username for the business account';
COMMENT ON COLUMN businesses.chatbot_id IS 'Identifier for the associated chatbot';
COMMENT ON COLUMN sessions.serialized_cookies IS 'Serialized Instagram session cookies and state';
COMMENT ON COLUMN messages.thread_id IS 'Instagram thread/conversation identifier';
COMMENT ON COLUMN messages.message_id IS 'Unique Instagram message identifier';
COMMENT ON COLUMN messages.is_incoming IS 'True if message is from Instagram user, false if from chatbot';
