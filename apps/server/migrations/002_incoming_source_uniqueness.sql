CREATE UNIQUE INDEX messages_incoming_source
ON messages(source_message_id)
WHERE direction = 'incoming' AND source_message_id IS NOT NULL;
