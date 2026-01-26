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

### Deployment Flow

```
Git Push (feature/*, develop, main)
    ↓
GitHub Webhook → Orchestrator
    ↓
PM Agent creates Slack thread & Notion record
    ↓
DEV Agent builds Docker image
    ↓
QAE Agent runs parallel tests
    ↓
IF tests pass → PM Agent approves
    ↓
IF QA: Auto-deploy
IF PROD: Wait for human approval via Slack reaction
    ↓
OPS Agent deploys to Heroku
    ↓
Deployment complete, status updated
```

---

## Current Status

**Phases Completed:** 0, 1, 2 ✅
**Current Phase:** 3 (Slack Configuration) - Next

| Phase | Title | Status |
|-------|-------|--------|
| 0 | Prerequisites & Accounts | ✅ Complete |
| 1 | Notion Database Setup | ✅ Complete |
| 2 | GitHub Configuration | ✅ Complete |
| 3 | Slack Configuration | 🔄 In Progress |
| 3B | Clawdbot Setup | ⏳ Pending |
| 4 | Zapier Integration | ⏳ Pending |
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

### Local Orchestrator
- Express.js server listening on port 3001
- Webhook handler for GitHub push events
- Signature verification for security
- Branch filtering (feature/*, develop, main)
- Deployment data extraction from git commits

---

## Architecture

### Components

```
┌─ GitHub ────────────────────────────────┐
│  • Webhook triggers on push              │
│  • Commit info extracted                 │
└──────────────────────────────────────────┘
                    ↓
┌─ Local Orchestrator ─────────────────────┐
│  • Receives webhook                      │
│  • Validates signature                   │
│  • Extracts deployment data              │
│  • Routes to Notion/Agents              │
└──────────────────────────────────────────┘
                    ↓
┌─ Notion ────────────────────────────────┐
│  • Central state ledger                  │
│  • Tracks all deployments                │
│  • Integration status tracking           │
└──────────────────────────────────────────┘
                    ↓
┌─ Slack ─────────────────────────────────┐
│  • Team notifications                    │
│  • Approval reactions (✅/❌)             │
│  • Status updates                        │
└──────────────────────────────────────────┘
                    ↓
┌─ Clawdbot + Claude Code ────────────────┐
│  • Listens to Slack reactions            │
│  • Validates with Claude AI              │
│  • Updates Notion via Zapier             │
└──────────────────────────────────────────┘
                    ↓
┌─ Heroku ────────────────────────────────┐
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
- Zapier account

### Required Tools
- **Node.js** ≥ 22 (for Clawdbot support)
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
GITHUB_WEBHOOK_URL=https://webhook.site/your-unique-id

# Notion
NOTION_API_TOKEN=PLACEHOLDER
NOTION_DATABASE_ID=PLACEHOLDER

# Slack
SLACK_BOT_TOKEN=PLACEHOLDER
SLACK_APP_TOKEN=PLACEHOLDER

# Orchestrator
ORCHESTRATOR_PORT=3001
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

---

## Project Structure

```
ClaudeCodeOrchestrator/
├── server.js                 # Main Express server
├── package.json             # Dependencies
├── .env                     # Environment variables (git-ignored)
├── .gitignore              # Git ignore rules
├── webhooks/
│   └── github.js           # GitHub webhook handler
├── handlers/               # Request handlers (future)
├── agents/                 # AI agent implementations (future)
└── README.md              # This file
```

---

## Key Features

### ✅ Implemented
- GitHub webhook integration with signature verification
- Express.js server for receiving webhooks
- Automatic branch filtering (feature/*, develop, main)
- Commit information extraction
- Deployment ID generation
- Environment variable management

### 🔄 In Progress (Phase 3)
- Slack bot configuration
- Team notification channels
- Approval workflow

### ⏳ Pending (Phases 3B-13)
- Clawdbot Slack reaction listener
- Zapier webhook processor
- Notion state machine integration
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

1. **Phase 3: Slack Configuration**
   - Create Slack bot with required permissions
   - Configure notification channels
   - Set up deployment status messages

2. **Phase 3B: Clawdbot Setup**
   - Install Clawdbot CLI
   - Configure reaction listener
   - Set up local Claude Code integration

3. **Phase 4: Zapier Integration**
   - Create Zapier webhook
   - Map fields to Notion
   - Test approval workflow

4. **Phases 5-13: Infrastructure**
   - Heroku app setup (DEV, QA, PROD)
   - Docker Hub configuration
   - Claude API integration
   - Agent deployment
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

For detailed troubleshooting, see Phase 2 documentation.

---

## Technologies

- **Node.js** - Runtime
- **Express.js** - Web framework
- **GitHub API** - Version control integration
- **Notion API** - State management
- **Slack API** - Team notifications
- **Zapier** - Webhook processor
- **Heroku** - Container deployment
- **Docker** - Image building
- **Claude API** - AI agents
- **Clawdbot** - Slack event listener

---

## Contributing

This is an active development project. See documentation files for implementation details:

- `PHASE_0_PREREQUISITES.md` - Account & tool setup
- `PHASE_1_NOTION_SETUP.md` - Database configuration
- `PHASE_2_GITHUB_CONFIG.md` - Webhook integration
- `PHASE_3_SLACK_CONFIG.md` - Bot setup
- `PHASE_3B_CLAWDBOT_SETUP.md` - Reaction listener
- `PHASE_4_ZAPIER_INTEGRATION.md` - Webhook processor
- `PHASE_5+_*.md` - Infrastructure & agents

---

## Support

For questions or issues:
1. Check the relevant phase documentation
2. Review troubleshooting sections
3. Verify `.env` credentials are correct
4. Check server logs for error details

---

## Status

**Project Status:** Early stage development
**Last Updated:** 2026-01-26
**Author:** Ken Shinzato
**Repository:** https://github.com/moncalaworks-cpu/ClaudeCodeOrchestrator
