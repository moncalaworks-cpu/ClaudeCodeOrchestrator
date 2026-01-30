# Claude Code Orchestrator

**An intelligent, multi-agent deployment automation framework for JavaScript/Python applications.**

Orchestrate seamless deployments across DEV, QA, and PROD environments with AI-powered agents handling building, testing, approvals, and deployment operations.

---

## Overview

The Claude Code Orchestrator is a comprehensive deployment automation system that uses 4 specialized AI agents to manage the complete lifecycle of application deployments:

- **DEV Agent** - Builds code, creates Docker images, fixes test failures
- **QAE Agent** - Runs tests (Playwright, Pytest, SQL), detects breaking changes
- **PM Agent** - Reviews deployments, approves, sends Slack notifications, syncs GitHub/Notion
- **OPS Agent** - Deploys to Heroku, auto-rollsback PROD failures

### Deployment Flow (Phase 3B - Fully Implemented)

```
Git Push (feature/*, develop, main)
    ↓
GitHub Webhook → Orchestrator Server
    ↓
Extract commit data, generate deployment ID
    ↓
Post Slack notification to environment-specific channel
(DEV/QA/PROD with clickable GitHub commit link)
    ↓
User reviews in Slack → Reacts with ✅ or ❌
    ↓
Orchestrator receives reaction event
    ↓
Post approval/rejection message to thread
    ↓
IF ✅ approved: Trigger GitHub Actions workflow
    ├─ GitHub Actions runs: git push heroku main
    ├─ Heroku detects push and deploys
    └─ Post GitHub Actions link in Slack
    ↓
IF ❌ rejected: Post rejection message
    ↓
Deployment complete (success or rejected)
```

---

## Current Status

**Phases Completed:** 0, 1, 2, 3, 3B, 4 ✅
**Current Phase:** 5 (Infrastructure & Deployment) - Next

| Phase | Title | Status |
|-------|-------|--------|
| 0 | Prerequisites & Accounts | ✅ Complete |
| 1 | Notion Database Setup | ✅ Complete |
| 2 | GitHub Configuration | ✅ Complete |
| 3 | Slack Integration | ✅ Complete |
| 3B | Slack Reactions & Approvals | ✅ Complete |
| 4 | Notion API Integration | ✅ Complete |
| 5-13 | Infrastructure & Deployment | ⏳ Pending |

---

## What's Implemented

### Phase 0 & 1: Notion Central Ledger ✅
- 44-field deployment database (status, commits, approvals, timestamps, etc.)
- 8 views for different team workflows
- API integration ready

### Phase 2: GitHub Webhooks ✅
- GitHub Personal Access Token (PAT) configured
- Repository webhook set up to trigger orchestrator
- Local orchestrator server running (Express.js on port 3001)
- Webhook signature verification working
- GitHub API integration tested

### Phase 3: Slack Integration ✅
- Slack bot token configured with messaging and event permissions
- Channel mapping for deployment notifications:
  - `feature/*` branches → DEV channel (`C0ABFT05V7E`)
  - `develop` branch → QA channel (`C0ABFT1BRS8`)
  - `main` branch → PROD channel (`C0AB5TMB0M9`)
  - Errors → INCIDENTS channel (`C0ABA82PMN2`)
- Slack handler module (`handlers/slack.js`) with deployment notification functions
- Deployment notifications include: repository, branch, commit SHA, message, author, and timestamp
- Error resilience: GitHub webhook continues even if Slack fails; errors logged and posted to INCIDENTS channel
- @slack/web-api SDK integrated

### Phase 3B: Slack Reactions & GitHub Actions Deployment ✅
- Event Subscriptions configured in Slack API
- Slack reactions handler (`handlers/reactions.js`) listening for approval/rejection emoji:
  - ✅ and +1 reactions → Approve deployment
  - ❌ and -1 reactions → Reject deployment
- Comprehensive test suite with 31 passing tests
- Approval workflow extracts deployment ID from message text
- Thread replies show approval/rejection status with user name
- Bot token scopes configured: `chat:write`, `users:read`, `conversations:history`
- GitHub Actions workflow (`.github/workflows/deploy.yml`) triggered on approval:
  - Listens for `repository_dispatch` event type `deployment-approved`
  - Executes `git push heroku main` to deploy
  - Uses `HEROKU_API_KEY` from GitHub Secrets for authentication
- Clean UX: Success message with GitHub Actions link, fallback manual command on failure
- End-to-end approval workflow tested and working with automatic deployment

### Phase 4: Notion API Integration ✅
- Direct Notion API integration via GitHub Actions workflow
- Deployment records automatically updated in Notion database
- Status updates: Deployment ID lookup, stage and status updates
- Notion API Token configured in GitHub Secrets
- Notion Database ID configured for querying and updating records
- Supports multiple deployment stages: Pending, In Progress, Deployed, Failed
- Real-time deployment tracking in central Notion ledger

### Local Orchestrator
- Express.js server listening on port 3001
- Webhook handler for GitHub push events
- Signature verification for security
- Branch filtering (feature/*, develop, main)
- Deployment data extraction from git commits
- Slack notification integration for deployment tracking

---

## Phase 3: Implementation Details & Lessons Learned

### What Was Built

**Files Created:**
- `handlers/slack.js` - Slack notification module (150 lines)
  - `sendDeploymentNotification()` - Sends deployment messages to Slack
  - `getChannelForBranch()` - Routes to correct channel based on branch
  - `postStatusUpdate()` - Stub for Phase 3B thread replies

**Files Modified:**
- `webhooks/github.js` - Integrated Slack handler for async notifications
- `server.js` - Fixed Heroku PORT environment variable
- `package.json` - Added @slack/web-api dependency

**Environment Configuration:**
- `SLACK_BOT_TOKEN` - Bot user OAuth token (xoxb-...)
- `SLACK_APP_TOKEN` - Not needed for Phase 3 (only chat:write required)
- `SLACK_DEV_CHANNEL_ID` - Feature branch notifications
- `SLACK_QA_CHANNEL_ID` - Develop branch notifications
- `SLACK_PROD_CHANNEL_ID` - Main branch notifications
- `SLACK_INCIDENTS_CHANNEL_ID` - Error fallback channel

### Major Issues & Solutions

#### Issue 1: Invalid Slack Token (not_authed error)
**Problem:** Bot token returned `not_authed` error from Slack API
**Root Cause:** Using old/revoked token or wrong app
**Solution:**
- Created new Slack app "Claude Orchestrator"
- Generated fresh bot token with `chat:write` scope
- Installed app to workspace

#### Issue 2: Webhook Timeout (408 error)
**Problem:** GitHub webhook requests timed out with 408 status
**Root Cause:** `await slackHandler.sendDeploymentNotification()` blocked the response
**Solution:**
- Moved Slack calls to async `.then()` chain
- Return 200 to GitHub immediately
- Let Slack notification process in background
- Prevents webhook timeout on slow Slack API calls

#### Issue 3: Heroku App Boot Timeout (H20/H10 errors)
**Problem:** App crashed 60 seconds after starting, kept restarting
**Root Cause:** Server listening on hardcoded port 3001, Heroku assigns dynamic PORT
**Solution:**
- Changed `const PORT = process.env.ORCHESTRATOR_PORT || 3001`
- To: `const PORT = process.env.PORT || 3001`
- Heroku now properly assigns port and app stays up

#### Issue 4: Bot Not Invited to Channels (not_in_channel error)
**Problem:** Slack API returned "not_in_channel" for all channels
**Root Cause:** Bot was not a member of the channels
**Solution:**
- Added @claude_orchestrator bot to #prod, #qa, #dev, #incidents
- Bot must be explicitly invited to each channel before posting

#### Issue 5: Environment Variables Not Loading (Heroku)
**Problem:** Local `.env` worked but Heroku didn't have variables
**Solution:**
- Used `heroku config:set` to configure environment variables
- Set `SLACK_BOT_TOKEN`, `GITHUB_WEBHOOK_SECRET`, and all channel IDs
- Never commit `.env` to git; always use config vars on platform

#### Issue 6: Tunneling Complexity (localtunnel/ngrok)
**Problem:** Local development required tunnel to receive webhooks, tunnels kept failing
**Solution:**
- Skip tunneling for serious testing
- Deploy to Heroku for stable, 24/7 endpoint
- GitHub webhooks are more reliable hitting production URL

### Key Lessons Learned

#### 1. Always Return Webhook Response First
- Webhook responses must complete within timeouts (GitHub: ~30s, Heroku: ~60s)
- Never `await` external API calls (Slack, Notion, etc.) in webhook handler
- Return 200 immediately, process side effects asynchronously
- This pattern is critical for reliability

#### 2. Environment Variables Strategy
**Local Development:**
- Use `.env` file with `source .env` before running
- Never commit secrets to git

**Heroku/Production:**
- Use `heroku config:set` or platform-specific secret management
- Never rely on `.env` being present on server
- Test `.env` variables aren't being accessed at startup

#### 3. Bot Membership Requirements
- Service bot must be explicitly invited to channels
- Having token and channel ID is not enough
- Bot needs "chat:write" permission in scope
- Verify "Bot is member of channel" before debugging API errors

#### 4. Error Handling Pattern for Critical Path
```
1. Try operation
2. If success: log with [SERVICE] prefix
3. If failure:
   - Log error with [SERVICE] prefix
   - Send to INCIDENTS channel
   - Don't throw (critical path continues)
   - Return error object, not exception
```

#### 5. Async Error Handling in Webhooks
- Use `.then().catch()` chains instead of `try/catch` with await
- Catch errors to prevent silent failures
- Always log errors with service prefix for debugging
- Example: `[Slack]`, `[GitHub]`, `[Notion]`

#### 6. Deployment vs. Local Testing
- For quick testing: use local server with ngrok/localtunnel
- For serious testing: deploy to production (Heroku)
- Production deployment catches issues localtunnel misses
- Webhooks are more reliable hitting stable URLs

#### 7. Environment-Specific Channels
- Slack channel mapping prevents wrong notifications to wrong teams
- feature/* → DEV (for developers)
- develop → QA (for QA team)
- main → PROD (for ops/leads)
- Centralizes error notifications to INCIDENTS

### End-to-End Flow (Verified Working)

1. Developer pushes to `main` branch
2. GitHub webhook POSTs to `https://claude-code-orchestrator-{id}.herokuapp.com/webhooks/github`
3. Heroku server receives, validates signature
4. Returns 200 OK immediately to GitHub
5. Asynchronously:
   - Extracts deployment data (commit, author, branch)
   - Calls Slack API with deployment info
   - Posts to #prod channel
   - On error: posts to #incidents channel
6. Slack message includes all deployment details

### Configuration Checklist for Production

- [ ] GitHub webhook configured pointing to Heroku app
- [ ] SLACK_BOT_TOKEN set on Heroku
- [ ] SLACK_PROD_CHANNEL_ID, QA, DEV, INCIDENTS set on Heroku
- [ ] Bot invited to all 4 Slack channels
- [ ] Bot has `chat:write` and `channels:read` scopes
- [ ] SERVER listening on process.env.PORT (not hardcoded)
- [ ] Async Slack calls don't block webhook response
- [ ] Error handling posts to INCIDENTS on failures
- [ ] Heroku logs accessible via `heroku logs --tail`

---

## Architecture

### Components

```
┌─ GitHub ────────────────────────────────┐
│  • Webhook triggers on push              │
│  • Commit info extracted                 │
└──────────────────────────────────────────┘
                    ↓
┌─ Orchestrator Server ───────────────────┐
│  • Receives GitHub webhooks              │
│  • Validates signature                   │
│  • Extracts deployment data              │
│  • Sends Slack notification              │
└──────────────────────────────────────────┘
                    ↓
┌─ Slack ─────────────────────────────────┐
│  • Posts deployment notification         │
│  • Listens for reactions (✅/❌)         │
│  • Posts approval/rejection reply        │
└──────────────────────────────────────────┘
                    ↓
┌─ Notion (Phase 4) ──────────────────────┐
│  • Central state ledger                  │
│  • Tracks all deployments                │
│  • Updated via Notion API                │
└──────────────────────────────────────────┘
                    ↓
┌─ Heroku (Phase 5+) ─────────────────────┐
│  • DEV, QA, PROD environments            │
│  • Deployment target                     │
│  • Auto-rollback on failure              │
└──────────────────────────────────────────┘
```

---

## Prerequisites

### Required Accounts
- Notion workspace
- GitHub account & repository
- Slack workspace
- Docker Hub account
- Heroku account
- Anthropic (Claude API) account

### Required Tools
- **Node.js** ≥ 18 (tested with 22+)
- **Git CLI**
- **Docker CLI**
- **Heroku CLI**
- **curl** (for testing)

### Verify Installation

```bash
node --version        # Should be ≥ 22.x.x
git --version
docker --version
heroku --version
curl --version
```

---

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/moncalaworks-cpu/ClaudeCodeOrchestrator.git
cd ClaudeCodeOrchestrator
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create .env File

```bash
cat > .env << 'EOF'
# GitHub
GITHUB_PAT=ghp_YOUR_PAT_HERE
GITHUB_REPO=moncalaworks-cpu/ClaudeCodeOrchestrator
GITHUB_WEBHOOK_SECRET=YOUR_SECRET_HERE

# Slack
SLACK_BOT_TOKEN=xoxb-YOUR_TOKEN_HERE
SLACK_SIGNING_SECRET=YOUR_SIGNING_SECRET_HERE
SLACK_DEV_CHANNEL_ID=C0ABFT05V7E
SLACK_QA_CHANNEL_ID=C0ABFT1BRS8
SLACK_PROD_CHANNEL_ID=C0AB5TMB0M9
SLACK_INCIDENTS_CHANNEL_ID=C0ABA82PMN2

# Heroku (for auto-deployment on approval)
HEROKU_API_TOKEN=YOUR_HEROKU_API_TOKEN_HERE
HEROKU_APP_NAME=claude-code-orchestrator-YOUR_ID_HERE

# Notion (for Phase 4+)
NOTION_API_TOKEN=PLACEHOLDER
NOTION_DATABASE_ID=PLACEHOLDER
EOF
```

Replace placeholder values with actual credentials from Phases 0-2 setup.

### 4. Start the Orchestrator

```bash
npm start
```

You should see:
```
Orchestrator webhook server listening on port 3001
```

### 5. Test the Webhook

In another terminal:

```bash
source .env && PAYLOAD='{"repository":{"full_name":"moncalaworks-cpu/ClaudeCodeOrchestrator"},"ref":"refs/heads/main","pusher":{"name":"Test"},"commits":[{"id":"abc123","message":"test","author":{"name":"Test User"}}]}' && SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" -hex | cut -d' ' -f2) && curl -X POST http://localhost:3001/webhooks/github -H "Content-Type: application/json" -H "x-hub-signature-256: sha256=$SIGNATURE" -H "x-github-event: push" -H "x-github-delivery: test-id" -d "$PAYLOAD" | jq .
```

Expected response:
```json
{
  "status": "received",
  "deployment_id": "deploy-main-1234567890",
  "branch": "main"
}
```

### 6. Verify Slack Integration (Phase 3)

After starting the server, verify Slack notifications are working:

**Step 1: Ensure server is running**
```bash
npm start
# Output: Orchestrator webhook server listening on port 3001
```

**Step 2: Trigger a real GitHub webhook**

Push a commit to a tracked branch (feature/*, develop, or main):
```bash
git commit --allow-empty -m "Test Phase 3 Slack integration"
git push origin main
```

**Step 3: Check Slack notification**

- For `main` branch → Check **#prod** channel
- For `develop` branch → Check **#qa** channel
- For `feature/*` branches → Check **#dev** channel
- For errors → Check **#incidents** channel

You should see a message like:
```
PROD deployment pending - deploy-main-1674567890

Repository: moncalaworks-cpu/ClaudeCodeOrchestrator
Branch: main
Commit: abc1234 - Test Phase 3 Slack integration
Author: Your Name
Triggered: 2026-01-27T10:30:00Z
```

**Troubleshooting:**

If no message appears:
1. Verify server is still running: `lsof -i :3001`
2. Check server console for `[Slack]` errors
3. Verify `SLACK_BOT_TOKEN` and channel IDs in `.env`
4. Ensure bot is member of target channels
5. Check GitHub Recent Deliveries for webhook status

### 7. Setup Auto-Deployment on Approval (Phase 3B+)

After approving a deployment via Slack reaction (✅), the system can automatically trigger Heroku deployment:

**Step 1: Get Heroku API Token**

```bash
heroku authorizations:create --description "Claude Code Orchestrator"
```

Copy the `Token` value.

**Step 2: Set Heroku Credentials on Heroku**

```bash
heroku config:set HEROKU_API_TOKEN=YOUR_TOKEN_HERE --app claude-code-orchestrator
heroku config:set HEROKU_APP_NAME=claude-code-orchestrator-YOUR_ID_HERE --app claude-code-orchestrator
```

**Step 3: Restart the App**

```bash
heroku restart --app claude-code-orchestrator
```

**Step 4: Test the Workflow**

1. Push a commit to trigger a deployment notification
2. React with ✅ in Slack to approve
3. Check Heroku logs:
   ```bash
   heroku logs --app claude-code-orchestrator --tail
   ```
4. You should see: `[Slack Reactions] ✅ Heroku deployment triggered for deploy-main-...`
5. Monitor deployment at: https://dashboard.heroku.com/apps/claude-code-orchestrator/activity

---

## Project Structure

```
ClaudeCodeOrchestrator/
├── server.js                           # Main Express server
├── package.json                        # Dependencies
├── jest.config.js                      # Jest test configuration
├── CLAUDE.md                           # Claude Code guidance
├── .env                                # Environment variables (git-ignored)
├── .gitignore                          # Git ignore rules
├── webhooks/
│   └── github.js                       # GitHub webhook handler
├── handlers/
│   ├── slack.js                        # Slack notification handler
│   ├── reactions.js                    # Slack reactions handler (approvals/rejections)
│   └── __tests__/
│       └── reactions.test.js           # Jest tests (31 tests, all passing)
├── agents/                             # AI agent implementations (future)
└── README.md                           # This file
```

---

## Key Features

### ✅ Implemented
- GitHub webhook integration with signature verification
- Express.js server for receiving webhooks
- Automatic branch filtering (feature/*, develop, main)
- Commit information extraction
- Deployment ID generation with timestamps
- Environment variable management
- Slack bot integration (@slack/web-api)
- Environment-specific channel routing for notifications
- Deployment status notifications with commit details
- Error handling with INCIDENTS channel fallback
- Slack Event Subscriptions configured
- Approval/rejection reactions (✅/❌ and +1/-1)
- Thread replies showing approval status with user names
- Comprehensive test suite (31 tests, all passing)

### ⏳ Pending (Phases 5-13)
- Docker Hub image registry
- Heroku multi-environment deployment
- Claude API agent orchestration
- End-to-end testing
- Production deployment

---

## Development Workflow

### Adding a New Phase

Each phase has dedicated documentation in `/home/ken/Repos/Claude/` directory:

```bash
cat PHASE_${N}_${TITLE}.md
```

### Testing Webhooks

Use webhook.site for real testing without exposing localhost:

1. Visit https://webhook.site
2. Copy your unique URL
3. Update GitHub webhook Payload URL
4. Make a test push to trigger

### Checking Orchestrator Logs

The orchestrator logs important events:

```
[GitHub] Event: push, Repo: ...
[GitHub] ✅ Processing deployment for branch: main
[GitHub] Deployment data: {...}
```

---

## Next Steps

1. **Phase 3B: Slack Reactions & Approvals** ✅ Complete
   - ✅ Event Subscriptions configured in Slack API
   - ✅ Reaction handler built and tested (31 tests passing)
   - ✅ Approval/rejection workflow implemented
   - ✅ Thread replies with status updates working
   - ✅ End-to-end testing verified

2. **Phase 4: Notion API Integration** ✅ Complete
   - Direct Notion API integration via GitHub Actions
   - Real-time deployment status updates
   - Centralized deployment tracking

3. **Phases 5-13: Infrastructure & Agents**
   - Heroku app setup (DEV, QA, PROD environments)
   - Docker Hub configuration
   - Claude API agent implementation
   - Auto-deployment on approval
   - Multi-environment orchestration
   - End-to-end testing
   - Production launch

See the detailed implementation guide:
```bash
cat /home/ken/Repos/Claude/IMPLEMENTATION_GUIDE.md
```

---

## Troubleshooting

### Server won't start on port 3001
```bash
# Check if port is in use
lsof -i :3001

# Kill any process using the port
kill -9 <PID>
```

### Webhook not receiving events
```bash
# Verify webhook is active in GitHub settings
# Check Recent Deliveries section for status

# Test manually with curl
cd ClaudeCodeOrchestrator && source .env && ...
```

### GitHub API authentication fails
```bash
# Verify PAT hasn't expired
# Regenerate at github.com/settings/tokens

# Check PAT has required scopes: repo, workflow, read:org
```

### Slack notifications not appearing
```bash
# 1. Test Slack token directly
node -e "const { WebClient } = require('@slack/web-api'); const slack = new WebClient(process.env.SLACK_BOT_TOKEN); (async () => { try { const result = await slack.auth.test(); console.log('Token valid:', result.user_id); } catch(e) { console.error('Token invalid:', e.message); } })();"

# 2. Verify bot is member of channel
# Go to Slack channel → Add members → Search @claude_orchestrator → Add

# 3. Check Heroku config vars
heroku config --app claude-code-orchestrator | grep SLACK_

# 4. Check Heroku logs for [Slack] errors
heroku logs --app claude-code-orchestrator --tail

# 5. Verify GitHub webhook is hitting correct URL
# Go to GitHub settings → Webhooks → Check "Recent Deliveries"
# Look for 200 status (success) or error code (failure)
```

### Slack API "not_authed" or "invalid_auth" error
```bash
# Bot token is invalid or missing required scopes
# Solution:
# 1. Go to https://api.slack.com/apps → Select "Claude Orchestrator"
# 2. Click "OAuth & Permissions"
# 3. Verify required scopes in "Bot Token Scopes":
#    - chat:write (for posting messages)
#    - users:read (for approval/rejection reactions)
#    - conversations:history (for reading messages in reactions)
# 4. Click "Install to Workspace" or "Reinstall to Workspace"
# 5. Copy fresh "Bot User OAuth Token" (starts with xoxb-)
# 6. Update Heroku: heroku config:set SLACK_BOT_TOKEN=xoxb-YOUR_NEW_TOKEN
# 7. Restart app: heroku restart
```

### Slack API "not_in_channel" error
```bash
# Bot hasn't been invited to the channel
# Solution:
# 1. Go to Slack channel (e.g., #prod)
# 2. Click channel name at top
# 3. Click "Members" tab
# 4. Click "Add a member"
# 5. Search for "@claude_orchestrator"
# 6. Click to add
# Repeat for all 4 channels: #prod, #qa, #dev, #incidents
```

### Heroku app crashing (H10/H20 errors)
```bash
# App timeout on startup or after webhook
# Check logs: heroku logs --app claude-code-orchestrator --tail

# If see "Stopping process with SIGKILL":
# - Problem: Server listening on wrong port
# - Solution: Must use process.env.PORT, not hardcoded 3001
# - Verify server.js has: const PORT = process.env.PORT || 3001;

# If see slow response to webhook:
# - Problem: Slack calls blocking webhook response
# - Solution: Use .then() chains, not await in webhook handler
# - Return 200 to GitHub immediately
```

### Webhook timeout (408/503 errors)
```bash
# GitHub webhook returns 408 (timeout) or Heroku returns 503
# Root cause: Webhook handler blocking on external API call

# Wrong pattern (blocks):
# res.status(200).json({...});  // Don't send response
# const slackResult = await slackHandler.sendDeploymentNotification();  // BLOCKS HERE

# Correct pattern (async):
# res.status(200).json({...});  // Send response first
# slackHandler.sendDeploymentNotification().then(...).catch(...);  // Process async
```

### Environment variables not loading on Heroku
```bash
# .env file doesn't exist on Heroku - use config:set
# WRONG: heroku push (or git push) and expect .env to be there
# CORRECT: heroku config:set SLACK_BOT_TOKEN=xoxb-...

# Verify config vars are set:
heroku config --app claude-code-orchestrator

# Set multiple at once:
heroku config:set VAR1=value1 VAR2=value2 VAR3=value3 --app claude-code-orchestrator
```

For detailed troubleshooting, see Phase 3 implementation guide above.

---

## Technologies

- **Node.js** - Runtime
- **Express.js** - Web framework
- **Jest** - Unit testing framework
- **GitHub API** - Version control integration
- **Slack API** - Team notifications and event subscriptions
- **Notion API** - Central state management and deployment tracking
- **Heroku** - Container deployment (Phase 5+)
- **Docker** - Image building (Phase 5+)
- **Claude API** - AI agents (Phase 5+)

---

## Development

This is an active development project. For implementation details:

- **CLAUDE.md** - Claude Code guidance for future instances
- **README.md** - This file with complete documentation
- `npm test` - Run 31 passing unit tests
- `npm start` - Start the orchestrator server locally
- Heroku logs - `heroku logs --app claude-code-orchestrator --tail`

Phase-specific documentation can be added as each phase completes.

---

## Support

For questions or issues:
1. Check the relevant phase documentation
2. Review troubleshooting sections
3. Verify `.env` credentials are correct
4. Check server logs for error details

---

## Status

**Project Status:** Phase 5 (Infrastructure & Deployment) - Pending
**Last Updated:** 2026-01-30 (Using Notion database schema to discover property IDs)
**Author:** Ken Shinzato
**Repository:** https://github.com/moncalaworks-cpu/ClaudeCodeOrchestrator

### Phase 3B Completion Summary (2026-01-30)

**Implementation Status:** ✅ COMPLETE
- Full end-to-end Slack approval to Heroku deployment workflow working
- Event Subscriptions configured in Slack API
- Approval/rejection reactions (✅/❌) triggering deployment
- GitHub Actions workflow automatically deploys on approval
- Slack messages include clickable GitHub commit and Actions links
- All 31 unit tests passing

**Complete Deployment Workflow:**
1. Developer pushes code → GitHub webhook triggers
2. Orchestrator posts notification to Slack with commit link
3. User reviews and reacts with ✅ to approve
4. Orchestrator posts approval message and calls GitHub API
5. GitHub Actions workflow triggers via repository_dispatch
6. GitHub Action runs `git push heroku main`
7. Heroku detects push and auto-deploys
8. Slack displays GitHub Actions link for progress monitoring
9. On failure: fallback message with manual deployment command

**Verification:**
- GitHub push → Slack notification with commit URL ✅
- User reacts with ✅ → Approval message posted to thread ✅
- GitHub API repository_dispatch triggered ✅
- GitHub Actions workflow runs automatically ✅
- Heroku receives push and deploys ✅
- Success message with Actions link displayed ✅

**Implementation Details:**
- `handlers/reactions.js` - Slack reaction handler + GitHub API trigger
- `handlers/__tests__/reactions.test.js` - 31 comprehensive tests
- `handlers/slack.js` - Slack notification with commit URL formatting
- `.github/workflows/deploy.yml` - GitHub Actions workflow for Heroku deployment
- `server.js` - GitHub webhook + Slack events endpoints
- `CLAUDE.md` - Comprehensive guidance for future Claude instances

**Key Features Implemented:**
- GitHub commit hash as clickable link to GitHub commit page
- Emoji reaction detection (✅, ❌, +1, -1)
- Deployment ID extraction via regex pattern matching
- User info lookup for approval attribution
- GitHub API repository_dispatch for workflow triggering
- GitHub Actions workflow with Heroku API key authentication
- Direct links to GitHub Actions workflow runs
- Graceful fallback to manual command on API failure
- Comprehensive error handling and logging
- Full test coverage with Jest mocking

**Lessons Learned:**
1. **Heroku Dyno Environment** - Git is not installed on Heroku dynos; can't run git commands directly. Solution: Use GitHub Actions (external CI/CD) for git operations.

2. **Heroku API Complexity** - Creating releases via Heroku API requires slug IDs which are difficult to obtain. Better to use GitHub as the deployment source.

3. **GitHub Actions for CI/CD** - Using `repository_dispatch` is the cleanest way to trigger external workflow actions. Works perfectly for approval-based deployments.

4. **Jest Mocking Timing** - Mock setup must happen BEFORE module requiring (via jest.mock factory function), not in beforeEach hook. The handler creates WebClient at module load time.

5. **Slack Scope Management** - Different actions require different scopes: `chat:write` for messaging, `users:read` for user info, `conversations:history` for reading messages. Set all needed scopes upfront to avoid `missing_scope` errors.

6. **UX Design** - Fallback approaches are essential. Show manual commands only on failure, not on success. Keep success messages clean and actionable with direct links.

7. **Deployment Verification** - Test full end-to-end workflows on production (Heroku), not just local development. Local testing with tunnels masks environment-specific issues.

### Recent Changes (Phase 3B - Complete)
- ✅ Implemented Slack reaction handler with full test coverage
- ✅ Fixed jest mock setup (17 failing → 31 passing tests)
- ✅ Added GitHub commit URL as clickable link in Slack
- ✅ Configured Slack Event Subscriptions with proper scopes
- ✅ Created GitHub Actions deployment workflow (.github/workflows/deploy.yml)
- ✅ Integrated GitHub API repository_dispatch for workflow triggering
- ✅ Added fallback manual deployment command on API failure
- ✅ Included GitHub Actions URL in success messages
- ✅ Created CLAUDE.md documentation for future instances
- ✅ Updated README with complete Phase 3B implementation
- ✅ Verified end-to-end approval to Heroku deployment workflow
