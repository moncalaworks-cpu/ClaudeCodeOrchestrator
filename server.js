require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const githubHandler = require('./webhooks/github');
const reactionsHandler = require('./handlers/reactions');

const app = express();

// Slack request verification middleware
function verifySlackRequest(req, res, buf) {
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  if (!slackSigningSecret) {
    console.warn('[Slack] SLACK_SIGNING_SECRET not set, skipping verification');
    return;
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSignature = req.headers['x-slack-signature'];

  if (!timestamp || !slackSignature) {
    console.error('[Slack] Missing timestamp or signature headers');
    return;
  }

  // Prevent replay attacks - request must be within 5 minutes
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp)) > 300) {
    console.error('[Slack] Request timestamp too old, possible replay attack');
    return;
  }

  const baseString = `v0:${timestamp}:${buf.toString('utf8')}`;
  const mySignature = 'v0=' + crypto.createHmac('sha256', slackSigningSecret).update(baseString).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(slackSignature))) {
    console.error('[Slack] Request signature verification failed');
    return;
  }

  console.log('[Slack] Request signature verified');
}

// Parse JSON with verification for Slack events
app.use(express.json({ verify: verifySlackRequest }));

// Register GitHub webhook endpoint
app.use('/webhooks', githubHandler);

// Slack events endpoint
app.post('/slack/events', async (req, res) => {
  try {
    const { type, event, challenge } = req.body;

    // Handle Slack URL verification challenge
    if (type === 'url_verification') {
      console.log('[Slack] Handling URL verification challenge');
      return res.status(200).send(challenge);
    }

    // Always respond 200 to Slack immediately
    res.status(200).json({ ok: true });

    // Handle events asynchronously
    if (type === 'event_callback') {
      if (event.type === 'reaction_added') {
        console.log('[Slack] Processing reaction_added event');
        await reactionsHandler.handleReactionAdded(event);
      } else {
        console.log(`[Slack] Ignoring event type: ${event.type}`);
      }
    }
  } catch (error) {
    console.error(`[Slack] Error handling event: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Orchestrator webhook server listening on port ${PORT}`);
});
