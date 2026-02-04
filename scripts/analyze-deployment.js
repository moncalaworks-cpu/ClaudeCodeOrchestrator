#!/usr/bin/env node

/**
 * Analyze Deployment with Claude Code
 *
 * Interactive analysis script that uses Claude Code to review deployment changes.
 * Leverages Claude Pro subscription - zero API costs.
 *
 * Usage:
 *   npm run analyze-deployment <deployment-id>
 *   Example: npm run analyze-deployment deploy-feature-auth-1234567890
 */

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const notionHandler = require('../handlers/notion');

const deploymentId = process.argv[2];

if (!deploymentId) {
  console.error('Usage: npm run analyze-deployment <deployment-id>');
  console.error('Example: npm run analyze-deployment deploy-feature-auth-1234567890');
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

async function main() {
  try {
    console.log(`\n🔍 Analyzing deployment: ${deploymentId}\n`);

    // Fetch deployment record from Notion
    const deployment = await notionHandler.getDeploymentRecord(deploymentId);
    if (!deployment) {
      console.error(`❌ Deployment record not found: ${deploymentId}`);
      process.exit(1);
    }

    // Extract deployment details
    const props = deployment.properties;
    const branch = props.Branch?.select?.name || 'unknown';
    const commitSha = props['Commit SHA']?.rich_text?.[0]?.text?.content || 'unknown';
    const commitMsg = props['Commit Message']?.select?.name || 'No message';
    const author = props.Author?.select?.name || 'unknown';
    const repo = props.Repository?.rich_text?.[0]?.text?.content ||
                 process.env.GITHUB_REPO || 'unknown/repo';

    console.log('📋 Deployment Details:');
    console.log(`   Branch: ${branch}`);
    console.log(`   Commit: ${commitSha}`);
    console.log(`   Message: ${commitMsg}`);
    console.log(`   Author: ${author}`);
    console.log(`   Repo: ${repo}\n`);

    // Clone/update repository
    console.log('📦 Preparing repository...');
    const repoPath = prepareRepository(repo);
    if (!repoPath) {
      console.error('❌ Failed to clone repository');
      process.exit(1);
    }

    // Get commit diff
    console.log('📝 Extracting commit changes...\n');
    const diff = getCommitDiff(repoPath, commitSha);

    // Build analysis prompt
    const prompt_text = buildAnalysisPrompt({
      branch,
      commitSha,
      commitMsg,
      author,
      repo,
      diff
    });

    // Save prompt to temp file for Claude Code to read
    const promptFile = `/tmp/deploy-analysis-${deploymentId}.txt`;
    fs.writeFileSync(promptFile, prompt_text);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('💬 CLAUDE CODE ANALYSIS REQUEST');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(prompt_text);
    console.log('\n═══════════════════════════════════════════════════════════════');

    // Ask user for approval
    const answer = await prompt('\n✅ Approve deployment? (yes/no): ');

    if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
      console.log(`\n✅ Deployment ${deploymentId} approved by user`);

      // Update Notion
      await notionHandler.updateDeploymentApproval(deploymentId, 'Claude Code User');
      console.log('📋 Notion record updated');

      // Post approval to Slack
      const slackHandler = require('../handlers/slack');
      const threadTs = props['Slack Thread ID']?.rich_text?.[0]?.text?.content;
      const channel = process.env.SLACK_DEV_CHANNEL_ID; // Could vary by branch

      if (threadTs && channel) {
        await slackHandler.postThreadUpdate(
          channel,
          threadTs,
          `✅ Deployment approved via Claude Code analysis\n\nDeployment ID: ${deploymentId}`
        );
        console.log('📨 Slack notification sent');
      }
    } else {
      console.log(`\n❌ Deployment ${deploymentId} rejected by user`);

      // Update Notion
      await notionHandler.updateDeploymentRejection(deploymentId, 'Claude Code User');
      console.log('📋 Notion record updated');

      // Post rejection to Slack
      const slackHandler = require('../handlers/slack');
      const threadTs = props['Slack Thread ID']?.rich_text?.[0]?.text?.content;
      const channel = process.env.SLACK_DEV_CHANNEL_ID;

      if (threadTs && channel) {
        await slackHandler.postThreadUpdate(
          channel,
          threadTs,
          `❌ Deployment rejected via Claude Code analysis\n\nDeployment ID: ${deploymentId}`
        );
        console.log('📨 Slack notification sent');
      }
    }

    // Cleanup
    fs.unlinkSync(promptFile);
    rl.close();

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    rl.close();
    process.exit(1);
  }
}

/**
 * Clone or update repository
 */
function prepareRepository(repo) {
  try {
    const repoPath = `/tmp/repos/${repo.replace('/', '-')}`;

    if (!fs.existsSync(repoPath)) {
      console.log(`Cloning ${repo}...`);
      const repoUrl = `https://oauth2:${process.env.GITHUB_PAT}@github.com/${repo}.git`;
      execSync(`git clone ${repoUrl} ${repoPath}`, { stdio: 'pipe' });
    } else {
      console.log(`Updating ${repo}...`);
      execSync(`cd ${repoPath} && git fetch origin`, { stdio: 'pipe' });
    }

    return repoPath;
  } catch (error) {
    console.error(`Failed to prepare repository: ${error.message}`);
    return null;
  }
}

/**
 * Get commit diff
 */
function getCommitDiff(repoPath, commitSha) {
  try {
    const diff = execSync(`cd ${repoPath} && git diff ${commitSha}~1 ${commitSha}`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10
    });

    const stats = execSync(`cd ${repoPath} && git show --stat ${commitSha}`, {
      encoding: 'utf-8'
    });

    return {
      diff: diff.substring(0, 15000), // Limit size
      stats: stats
    };
  } catch (error) {
    console.warn(`⚠️ Could not get commit diff: ${error.message}`);
    return { diff: '', stats: '' };
  }
}

/**
 * Build analysis prompt for Claude Code
 */
function buildAnalysisPrompt(data) {
  const { branch, commitSha, commitMsg, author, repo, diff } = data;

  return `DEPLOYMENT ANALYSIS REQUEST
═══════════════════════════════════════════════════════════════════════════

Repository: ${repo}
Branch: ${branch}
Commit: ${commitSha}
Message: ${commitMsg}
Author: ${author}

COMMIT DIFF:
───────────────────────────────────────────────────────────────────────────
${diff.diff || '(No diff available)'}
───────────────────────────────────────────────────────────────────────────

STATISTICS:
${diff.stats || '(No stats available)'}

ANALYSIS TASK:
───────────────────────────────────────────────────────────────────────────
Review this deployment and provide:

1. RISK ASSESSMENT
   - Risk Level: LOW / MEDIUM / HIGH
   - Key Concerns: Any breaking changes, security issues, or problems?
   - Recommendation: Should this be approved?

2. QUALITY CHECKS
   - Code quality observations
   - Potential issues or improvements
   - Any test coverage concerns?

3. REASONING
   - Explain your assessment
   - What factors influenced your risk level?

Please provide a thorough analysis to help make an informed deployment decision.
═══════════════════════════════════════════════════════════════════════════`;
}

// Run the analysis
main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  rl.close();
  process.exit(1);
});
