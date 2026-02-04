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

## Claude API Agent Architecture

### Phase 1: DEV + PM Agents (Approval Workflow Automation)

**Overview**: Two specialized Claude agents automate deployment code review and approval decisions:
1. **DEV Agent** - Analyzes code changes for risk assessment
2. **PM Agent** - Reviews risk assessment and makes approval decision

**Workflow**:
```
GitHub Push → Slack Notification + Notion Record
  ↓
DEV Agent (Claude 3.5 Haiku)
  - Clone repository
  - Analyze git diff
  - Extract: risk_level, concerns, recommendation
  - Post analysis to Slack thread
  - Update "DEV Agent Notes" in Notion
  ↓
PM Agent (Claude 3.7 Sonnet)
  - Read DEV agent notes from Notion
  - Make approval decision: AUTO_APPROVE or HUMAN_REVIEW
  - Post decision to Slack thread
  - Auto-approve low-risk deployments (if enabled)
  - Trigger GitHub Actions deployment OR request human approval
  - Update "PM Agent Notes" in Notion
```

### Agent Components

**handlers/agents/base.js**: Shared utilities
- `callClaude(params)` - Claude API wrapper with error handling
- `extractDecision(responseText)` - Parse JSON from Claude responses
- `postAgentUpdate(channel, threadTs, agentName, message)` - Update Slack thread
- `updateNotionNotes(deploymentId, agentName, notes)` - Persist analysis to Notion
- `retryWithBackoff(fn, maxAttempts, initialDelayMs)` - Retry logic with exponential backoff

**handlers/agents/dev.js**: Code analysis agent
- `analyzeDeployment(deploymentData, channel, threadTs)` - Main entry point
- `prepareRepository(repository)` - Clone/update git repository
- `analyzeCommitDiff(repoPath, commitSha)` - Extract git diff and stats
- `buildAnalysisPrompt(deploymentData, diffAnalysis)` - Build Claude prompt

**handlers/agents/pm.js**: Approval decision agent
- `reviewDeployment(deploymentId, channel, threadTs)` - Main entry point
- `shouldAutoApprove(context, devDecision, pmDecision)` - Auto-approval criteria
- `buildDecisionPrompt(deploymentData, devNotes)` - Build Claude prompt
- `extractDevDecision(devNotes)` - Parse DEV agent notes
- `triggerGitHubDeployment(deploymentId, channel, threadTs, branch)` - Deploy on auto-approve

### DEV Agent Details

**Model**: Claude 3.5 Haiku (fast, low-cost code analysis)
**Cost**: ~$0.0015 per analysis (~$45/month at 50 deployments/day)

**Decision Format**:
```json
{
  "risk_level": "LOW|MEDIUM|HIGH",
  "concerns": ["breaking change", "missing tests"],
  "recommendation": "APPROVE|REVIEW|BLOCK",
  "reasoning": "Explain your assessment"
}
```

**Risk Assessment Criteria**:
- **LOW**: Minor changes, no breaking changes, well-tested
- **MEDIUM**: Moderate changes, potential concerns, requires review
- **HIGH**: Breaking changes, security risks, database migrations

**Data Collection**:
1. Clone repository using GitHub PAT
2. Run `git diff` to extract code changes (max 10k chars)
3. Parse `git show --stat` for file counts and line changes
4. Include commit message, author, branch name
5. Send to Claude with full context

### PM Agent Details

**Model**: Claude 3.7 Sonnet (complex reasoning for approval decisions)
**Cost**: ~$0.0046 per decision (~$138/month at 50 deployments/day)

**Decision Format**:
```json
{
  "decision": "AUTO_APPROVE|HUMAN_REVIEW",
  "confidence": 0.92,
  "reasoning": "Why this decision?"
}
```

**Auto-Approval Criteria** (requires all conditions):
1. DEV risk_level == "LOW"
2. PM decision == "AUTO_APPROVE"
3. Confidence >= 0.8 (80%)
4. NOT main/master branch (never auto-approve PROD)
5. `ENABLE_AUTO_APPROVAL=true` env flag set

**Context for Decision**:
- Branch name (feature/*, develop, main)
- Commit message quality
- Commit author
- DEV agent risk assessment
- DEV agent concerns list

### Integration Points

**webhooks/github.js** (line 96+):
```javascript
// After Slack notification + Notion record created
if (process.env.ENABLE_DEV_AGENT === 'true') {
  const devAgent = require('../handlers/agents/dev');
  devAgent.analyzeDeployment(...)
    .then(devResult => {
      if (process.env.ENABLE_PM_AGENT === 'true') {
        const pmAgent = require('../handlers/agents/pm');
        pmAgent.reviewDeployment(...)
      }
    })
}
```

**handlers/slack.js** (extended):
- `postThreadUpdate(channel, threadTs, message)` - Post update to existing thread

**handlers/notion.js** (extended):
- `updateAgentNotes(deploymentId, agentName, notes)` - Persist agent analysis
- `getDeploymentRecord(deploymentId)` - Fetch full deployment record

**handlers/reactions.js** (extended):
- `triggerDeployment(deploymentId, channel, threadTs, approver)` - Trigger deployment

### Testing

**Test Files**:
- `handlers/agents/__tests__/base.test.js` - Base utilities (15+ tests)
- `handlers/agents/__tests__/dev.test.js` - DEV agent (8+ tests)
- `handlers/agents/__tests__/pm.test.js` - PM agent (13+ tests)

**Mocking Strategy**:
- Mock `@anthropic-ai/sdk` to test Claude API interactions
- Mock `child_process` for git operations
- Mock Slack/Notion handlers to isolate agent logic

**Running Agent Tests**:
```bash
npm test -- handlers/agents/__tests__/base.test.js
npm test -- handlers/agents/__tests__/dev.test.js
npm test -- handlers/agents/__tests__/pm.test.js
npm test -- handlers/agents/__tests__  # Run all agent tests
```

### Monitoring & Observability

**Logging Prefixes**:
- `[Claude API]` - Anthropic API calls
- `[DEV Agent]` - Code analysis agent
- `[PM Agent]` - Approval decision agent
- `[Base Agent]` - Shared utilities

**Notion Audit Trail**:
- "DEV Agent Notes" field stores complete analysis
- "PM Agent Notes" field stores approval decision
- Timestamp fields track when agents processed deployment

**Slack Thread Updates**:
- Agents post status updates to Slack thread
- Format: `[AGENT_NAME] message`
- All decisions visible to team in real-time

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

**Notion**
- `NOTION_API_TOKEN` - Notion integration token
- `NOTION_DATABASE_ID` - Deployment database ID

**Claude API Agents**
- `ANTHROPIC_API_KEY` - Claude API key (required for agents)
- `ENABLE_DEV_AGENT` - Enable code analysis (default: false)
- `ENABLE_PM_AGENT` - Enable approval decision (default: false)
- `ENABLE_AUTO_APPROVAL` - Allow auto-approval of low-risk deployments (default: false)
- `CLAUDE_DEV_MODEL` - DEV agent model (default: claude-3-5-haiku-20241022)
- `CLAUDE_PM_MODEL` - PM agent model (default: claude-3-7-sonnet-20250219)

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

**Enabling Claude API Agents**:
1. Set `ANTHROPIC_API_KEY` in .env or Heroku config
2. Enable individual agents: `ENABLE_DEV_AGENT=true`, `ENABLE_PM_AGENT=true`
3. Set `ENABLE_AUTO_APPROVAL=true` to allow auto-approval
4. Deploy and monitor logs: `heroku logs --tail`
5. Check Slack threads for agent updates
6. Review Notion "DEV Agent Notes" and "PM Agent Notes" fields

**Agent Troubleshooting**:
- Agent doesn't run? Check `ENABLE_DEV_AGENT=true` and `ANTHROPIC_API_KEY` set
- Claude API error? Check API key is valid and account has credit
- Repository clone fails? Ensure `GITHUB_PAT` has repo access permissions
- Auto-approval not working? Verify `ENABLE_AUTO_APPROVAL=true` and deployment is LOW risk
- Slack updates missing? Check bot is in all required channels

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

**Current**: Phase 6 (OPS & QAE Agents) - Next

**Completed Phases**:
- Phase 0: Prerequisites & Accounts
- Phase 1: Notion Database
- Phase 2: GitHub Webhooks
- Phase 3: Slack Integration
- Phase 3B: Slack Reaction Handler (approval workflow)
- Phase 4: Notion API Integration (direct API updates via GitHub Actions)
- Phase 5: Claude API Agents (DEV + PM agents for automated code review & approval)

**In Progress**:
- Phase 5B: OPS Agent (deployment monitoring, auto-rollback)
- Phase 5C: QAE Agent (post-deployment testing)

**Upcoming**:
- Phase 6+: Agent memory/learning, prompt caching, Docker deployment
