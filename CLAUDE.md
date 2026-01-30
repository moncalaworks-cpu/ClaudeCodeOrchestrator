# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

| Task | Command |
|------|---------|
| Install dependencies | `npm install` |
| Start server (port 3001) | `npm start` |
| Run all tests | `npm test` |
| Watch tests during development | `npm test:watch` |
| Generate coverage report | `npm test:coverage` |
| Run single test file | `npm test -- handlers/__tests__/reactions.test.js` |

## Architecture Overview

### Webhook Pipeline
The orchestrator operates as a **webhook event processor** with immediate response, asynchronous side effects:

```
External Event (GitHub push) → Webhook Handler → Return 200 OK immediately → Process async
```

**Critical pattern**: Always respond to webhook sources within their timeout windows (GitHub: ~30s, Heroku: ~60s). Never `await` external API calls in the response path. Use `.then().catch()` chains for asynchronous processing.

### Core Data Flow

1. **GitHub webhook** (`/webhooks/github`) → Validates signature, extracts deployment data
2. **Routes to handlers** → Slack notification handler (async)
3. **Slack notification** (`handlers/slack.js`) → Posts to environment-specific channels
4. **Slack reactions** (`/slack/events`) → Triggers approval/rejection workflow (`handlers/reactions.js`)
5. **GitHub Actions workflow** → Triggers Notion API updates on deployment completion

### Component Responsibilities

**server.js**: Express app with two webhook endpoints
- `/webhooks/github` - Routes to GitHub handler
- `/slack/events` - Receives Slack event callbacks (reactions, messages), routes to reaction handler

**webhooks/github.js**: Processes GitHub push events
- Signature verification (HMAC-SHA256)
- Extracts branch, commit, author from payload
- Generates deployment ID: `deploy-{branch}-{timestamp}`
- Triggers async Slack notification

**handlers/slack.js**: Sends deployment status notifications
- Maps branch → Slack channel (feature/* → DEV, develop → QA, main → PROD)
- Posts deployment message with commit details
- Fallback: Posts errors to INCIDENTS channel

**handlers/reactions.js**: Processes approval/rejection reactions
- Listens for emoji reactions on Slack messages (✅, ❌, +1, -1)
- Extracts deployment ID from message text via regex
- Posts thread reply with approval/rejection status
- Logs approval for audit trail

**jest.config.js**: Test configuration
- Coverage threshold: 70% across branches, functions, lines, statements
- Test files: `**/__tests__/**/*.test.js`
- Collect from: `handlers/`, `webhooks/` (excludes `__tests__`, `node_modules`)

## Environment Variables

Required for operation:

**GitHub**
- `GITHUB_PAT` - Personal Access Token
- `GITHUB_REPO` - Repository identifier
- `GITHUB_WEBHOOK_SECRET` - Webhook signature secret

**Slack**
- `SLACK_BOT_TOKEN` - Bot user OAuth token (xoxb-...)
- `SLACK_SIGNING_SECRET` - Event callback signature secret
- `SLACK_DEV_CHANNEL_ID` - Feature branch notifications
- `SLACK_QA_CHANNEL_ID` - Develop branch notifications
- `SLACK_PROD_CHANNEL_ID` - Main branch notifications
- `SLACK_INCIDENTS_CHANNEL_ID` - Error fallback channel

**Server**
- `PORT` - Server port (Heroku assigns dynamically; local default 3001)

## Key Implementation Patterns

### 1. Signature Verification
Both GitHub and Slack use HMAC-SHA256 verification with timing-safe comparison:
```javascript
crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(receivedSig))
```
This prevents timing attacks on signature validation.

### 2. Async Webhook Processing
```javascript
// CORRECT: Respond immediately, process async
res.status(200).json({...});
slackHandler.sendDeploymentNotification().then(...).catch(...);

// WRONG: Blocking on external API
const result = await slackHandler.sendDeploymentNotification();
res.status(200).json({...});
```

### 3. Error Handling in Async Context
Async operations in webhook handlers should:
- Use `.catch()` to prevent unhandled rejections
- Log errors with service prefix (`[Slack]`, `[GitHub]`, etc.)
- Post errors to INCIDENTS channel instead of throwing
- Not block webhook response

### 4. Channel Routing
Branch-to-channel mapping in `handlers/slack.js:getChannelForBranch()`:
- `feature/*` → DEV (developers)
- `develop` → QA (QA team)
- `main` → PROD (ops/leads)
- Errors → INCIDENTS

### 5. Deployment ID Extraction
In `handlers/reactions.js:extractDeploymentId()`, regex extracts ID from Slack message:
```javascript
const deploymentId = /deploy-[\w-]+/g.exec(text);
```
Format: `deploy-{branch}-{timestamp}` enables unique tracking across environments.

## Testing Strategy

### Test Structure
- Location: `handlers/__tests__/reactions.test.js` (507 lines, 26+ tests)
- Framework: Jest with mocked Slack WebClient
- Isolation: `@slack/web-api` mocked to test handler logic without API calls

### Test Categories
1. **Deployment ID extraction** - Regex parsing from message text
2. **Reaction handling** - Processing approval/rejection emoji
3. **Approval workflow** - User approval flow with thread replies
4. **Rejection workflow** - User rejection flow
5. **Thread replies** - Posting status updates to deployment thread
6. **Integration tests** - End-to-end approval/rejection scenarios

### Running Tests
```bash
npm test                                           # All tests
npm test:watch                                     # Watch mode
npm test:coverage                                  # Coverage report
npm test -- --testNamePattern="deployment ID"     # Specific test pattern
npm test -- handlers/__tests__/reactions.test.js  # Specific file
```

Coverage must meet thresholds: branches 70%, functions 70%, lines 70%, statements 70%.

## Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env with required variables (see README for full list)
# SLACK_BOT_TOKEN, GITHUB_WEBHOOK_SECRET, channel IDs, etc.

# 3. Start server
npm start
# Output: "Orchestrator webhook server listening on port 3001"

# 4. Test in another terminal
npm test:watch
```

## Common Workflow

**Adding a new handler**:
1. Create file in `handlers/{name}.js`
2. Export main function and any helper functions
3. Add tests in `handlers/__tests__/{name}.test.js`
4. Import and use in `server.js` or other handlers
5. Ensure 70% coverage threshold is met

**Debugging webhook failures**:
1. Check `.env` variables are set correctly
2. Verify service credentials (GitHub PAT, Slack token)
3. Check server logs for `[SERVICE]` prefix errors
4. Verify webhook signature secrets match (GitHub/Slack → local/Heroku config)
5. For Slack: Confirm bot is member of all channels

**Deploying to Heroku**:
1. Push code: `git push heroku main` (if linked) or `git push origin main` (auto-deploy)
2. Set environment variables: `heroku config:set VAR=value`
3. Verify with: `heroku logs --tail`
4. Test GitHub webhook: GitHub Settings → Webhooks → Recent Deliveries

## Important Notes

### Slack Bot Requirements
- Bot must be explicitly invited to each channel (having token/channel ID is not enough)
- Requires `chat:write` and `channels:read` scopes
- Invalid tokens return `not_authed` error; regenerate on https://api.slack.com/apps
- Channel membership errors show `not_in_channel`

### Server Port Handling
- Local development: Default `3001` (override with `PORT` env var)
- Heroku: Must read `process.env.PORT` (dynamically assigned, hardcoded values cause H10/H20 crashes)
- Current code: `const PORT = process.env.PORT || 3001;` ✅

### Webhook Timeout Prevention
- GitHub webhook timeout: ~30 seconds
- Heroku dyno timeout: ~60 seconds
- Solution: Never `await` external API calls in response path
- Pattern: Return 200 → process async with `.then().catch()`

### Testing Webhooks Locally
- Using `ngrok` or `localtunnel` adds complexity and tunnel instability
- Recommended: Deploy to Heroku for testing (24/7 stable endpoint)
- For quick iteration: Use `npm test` instead of manual webhook testing

## Phase Status

**Current**: Phase 5 (Infrastructure & Deployment) - Next

**Completed Phases**:
- Phase 0: Prerequisites & Accounts
- Phase 1: Notion Database
- Phase 2: GitHub Webhooks
- Phase 3: Slack Integration
- Phase 3B: Slack Reaction Handler (approval workflow)
- Phase 4: Notion API Integration (direct API updates via GitHub Actions)

**Upcoming**:
- Phase 5+: Docker, Heroku deployment automation, Claude API agents
