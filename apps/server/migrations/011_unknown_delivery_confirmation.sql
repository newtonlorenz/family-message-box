UPDATE messages
SET
  delivery_state = 'confirmation_unknown',
  transport_mode = COALESCE(transport_mode, 'voice-media')
WHERE direction = 'outgoing'
  AND delivery_state = 'failed'
  AND error IN (
    'WhatsApp did not return a sent-message confirmation.',
    'WhatsApp returned an invalid sent-message confirmation.'
  );
