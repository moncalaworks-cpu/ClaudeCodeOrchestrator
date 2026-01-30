# Phase 3B: Slack Reaction Handler - Setup Guide

## Overview

Phase 3B implements a custom Slack bot that listens for reactions (✅/❌) on deployment notification messages and processes approvals/rejections.

## What Was Built

### New Files
- `handlers/reactions.js` - Reaction event handler (200 lines)
  - `handleReactionAdded()` - Process reaction events
  - `approveDeployment()` - Handle approval reactions
  - `rejectDeployment()` - Handle rejection reactions
  - `validateApprover()` - Permission validation (stub)
  - `replyToThread()` - Post status updates to threads
  - `extractDeploymentId()` - Parse deployment IDs from messages

### Modified Files
- `server.js` - Added Slack event endpoint and signature verification
- `handlers/slack.js` - Store message_ts for reaction lookup

## Setup Instructions

### Step 1: Get Slack App Signing Secret

1. Go to https://api.slack.com/apps
2. Click "Claude Orchestrator"
3. Click "Basic Information"
4. Scroll down to "App Credentials"
5. Find "Signing Secret" and copy it

### Step 2: Set Heroku Environment Variable

```bash
heroku config:set SLACK_SIGNING_SECRET=YOUR_SIGNING_SECRET_HERE --app claude-code-orchestrator
```

Verify it was set:
```bash
heroku config --app claude-code-orchestrator | grep SLACK_SIGNING_SECRET
```

### Step 3: Configure Slack App Event Subscriptions

1. Go to https://api.slack.com/apps
2. Click "Claude Orchestrator"
3. In left menu, click "Event Subscriptions"
4. Turn on "Enable Events"
5. Set "Request URL" to: `https://claude-code-orchestrator-{id}.herokuapp.com/slack/events`
   - Replace `{id}` with your actual Heroku app ID
   - Full URL: `https://claude-code-orchestrator-d827a1ee0fec.herokuapp.com/slack/events`
6. Slack will verify the URL (should show "Verified ✓")
7. Scroll down to "Subscribe to bot events"
8. Click "Add Bot User Event"
9. Add `reaction_added`
10. (Optional) Add `reaction_removed` for cleanup
11. Click "Save Changes"

### Step 4: Deploy Updated Code

```bash
cd /home/ken/Repos/ClaudeCodeOrchestrator && git add handlers/reactions.js server.js handlers/slack.js && git commit -m "Phase 3B: Add Slack reaction handler for approval workflow" && git push origin main && git push heroku main
```

### Step 5: Verify Deployment

Check Heroku logs:
```bash
heroku logs --app claude-code-orchestrator --tail
```

You should see:
```
Orchestrator webhook server listening on port {dynamic_port}
```

## Testing the Workflow

### Test Flow

1. **Push to main branch**
   ```bash
   git commit --allow-empty -m "test phase 3b reactions"
   git push origin main
   ```

2. **Check #prod channel**
   - You should see deployment notification message

3. **Add reaction to message**
   - Click on message → Add emoji reaction
   - Use ✅ (white_check_mark) or ❌ (x) or +1/-1

4. **Check thread**
   - You should see reply in thread:
     - "✅ Deployment approved by {user}"
     - Or "❌ Deployment rejected by {user}"

5. **Check Heroku logs**
   ```bash
   heroku logs --app claude-code-orchestrator --tail
   ```
   - Should show:
   ```
   [Slack] Processing reaction_added event
   [Slack Reactions] {user} added :{reaction}: to message in {channel}
   [Slack Reactions] Processing approval from user {user_id}
   [Slack Reactions] Deployment {id} approved by {username}
   ```

## Troubleshooting

### "Verified ✗" on Slack Event URL

This means Slack couldn't verify the endpoint. Check:

1. **Is the server running?**
   ```bash
   heroku logs --app claude-code-orchestrator --tail
   ```

2. **Is the URL correct?**
   - Should be: `https://claude-code-orchestrator-{id}.herokuapp.com/slack/events`
   - Not: `http://` (must be https)

3. **Is SLACK_SIGNING_SECRET set?**
   ```bash
   heroku config --app claude-code-orchestrator | grep SLACK_SIGNING_SECRET
   ```

4. **Redeploy if needed**
   ```bash
   git push heroku main
   ```

### Reactions not triggering replies

1. Check you're using correct emojis: ✅, ❌, +1, or -1
2. Check Heroku logs for errors
3. Verify bot has `chat:write` permission (it should from Phase 3)
4. Try pushing new deployment and reacting to fresh message

### "Request signature verification failed"

This means the SLACK_SIGNING_SECRET is wrong or not set:

1. Double-check the signing secret from Slack app settings
2. Make sure there are no extra spaces when setting:
   ```bash
   heroku config:set SLACK_SIGNING_SECRET="your_secret_here" --app claude-code-orchestrator
   ```
3. Redeploy code
4. Retry reaction

## Current Implementation Status

### ✅ Implemented
- Reaction event handler
- Approval/rejection replies
- User info in audit trail
- Error handling with thread replies
- Heroku logs with [Slack Reactions] prefix

### ⏳ Coming in Future Phases (Phase 4+)
- Notion integration (update deployment status)
- Role-based approval validation
- Deployment trigger on approval
- Rollback on rejection
- Audit trail in Notion

## Architecture Diagram

```
GitHub Webhook → Deployment Notification (#prod message)
                          ↓
                  User adds ✅ reaction
                          ↓
                  Slack sends reaction_added event
                          ↓
                  /slack/events endpoint (server.js)
                          ↓
                  Signature verification (secure)
                          ↓
                  reactionsHandler.handleReactionAdded()
                          ↓
                  Get user info → Extract deployment ID
                          ↓
                  Post reply to thread
                          ↓
                  Log to Heroku: [Slack Reactions] Deployment approved
                          ↓
                  TODO: Update Notion, trigger deployment
```

## Key Security Features

1. **Request Signature Verification**
   - All Slack events verified with SLACK_SIGNING_SECRET
   - Prevents replay attacks (5-min timestamp check)
   - Uses crypto.timingSafeEqual (timing-safe comparison)

2. **Async Event Processing**
   - Always respond 200 immediately to Slack
   - Process events asynchronously
   - Prevents timeouts

3. **Error Handling**
   - All errors logged with [Slack Reactions] prefix
   - Errors posted to thread for visibility
   - Graceful degradation

## Next Steps

1. **Test the reaction workflow** (instructions above)
2. **Phase 4: Notion Integration**
   - Store deployment_data with thread_ts
   - Update Notion on approval/rejection
   - Create approval audit trail

3. **Phase 5: Auto-deployment**
   - Trigger Heroku deployment on approval
   - Rollback on rejection
   - Status updates back to Slack thread
