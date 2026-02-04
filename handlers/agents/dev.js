/**
 * DEV Agent
 * Analyzes commits and assesses deployment risk
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const baseAgent = require('./base');

// Models
const DEV_MODEL = process.env.CLAUDE_DEV_MODEL || 'claude-3-5-haiku-20241022';

/**
 * Clone or update git repository
 * @param {string} repository - Repository in format owner/repo
 * @returns {string} Path to repository
 */
function prepareRepository(repository) {
  const repoPath = `/tmp/repos/${repository.replace('/', '-')}`;

  try {
    if (!fs.existsSync(repoPath)) {
      console.log(`[DEV Agent] Cloning repository to ${repoPath}`);
      const repoUrl = `https://oauth2:${process.env.GITHUB_PAT}@github.com/${repository}.git`;
      execSync(`git clone ${repoUrl} ${repoPath}`, { stdio: 'pipe', timeout: 30000 });
    } else {
      console.log(`[DEV Agent] Updating existing repository at ${repoPath}`);
      execSync(`cd ${repoPath} && git fetch origin`, { stdio: 'pipe', timeout: 30000 });
    }

    return repoPath;
  } catch (error) {
    console.warn(`[DEV Agent] ⚠️ Repository preparation failed: ${error.message}`);
    return null;
  }
}

/**
 * Analyze commit changes
 * @param {string} repoPath - Path to repository
 * @param {string} commitSha - Commit SHA
 * @returns {object} Diff and stats
 */
function analyzeCommitDiff(repoPath, commitSha) {
  try {
    if (!repoPath) {
      return { diff: '', filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
    }

    // Get full diff
    const diff = execSync(`cd ${repoPath} && git diff ${commitSha}~1 ${commitSha}`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10, // 10MB max
      timeout: 30000
    });

    // Get file stats
    const stats = execSync(`cd ${repoPath} && git show --stat ${commitSha}`, {
      encoding: 'utf-8',
      timeout: 30000
    });

    // Parse stats for file count and line changes
    const fileMatches = stats.match(/(\d+) files? changed/);
    const filesChanged = fileMatches ? parseInt(fileMatches[1]) : 0;

    const insertMatches = stats.match(/(\d+) insertions?\(\+\)/);
    const linesAdded = insertMatches ? parseInt(insertMatches[1]) : 0;

    const deleteMatches = stats.match(/(\d+) deletions?\(-\)/);
    const linesRemoved = deleteMatches ? parseInt(deleteMatches[1]) : 0;

    // Limit diff to 10k chars for Claude context
    const limitedDiff = diff.substring(0, 10000);
    const truncated = diff.length > 10000;

    return {
      diff: limitedDiff,
      truncated: truncated,
      filesChanged: filesChanged,
      linesAdded: linesAdded,
      linesRemoved: linesRemoved
    };
  } catch (error) {
    console.warn(`[DEV Agent] ⚠️ Diff analysis failed: ${error.message}`);
    return { diff: '', filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
  }
}

/**
 * Build analysis prompt for Claude
 * @param {object} deploymentData - Deployment data
 * @param {object} diffAnalysis - Diff analysis results
 * @returns {string} Prompt text
 */
function buildAnalysisPrompt(deploymentData, diffAnalysis) {
  const { branch, commit_sha, commit_message, commit_author, repository } = deploymentData;
  const { diff, filesChanged, linesAdded, linesRemoved, truncated } = diffAnalysis;

  const prompt = `You are a DEV agent analyzing a deployment for code review purposes.

Deployment Details:
- Repository: ${repository}
- Branch: ${branch}
- Commit: ${commit_sha}
- Message: ${commit_message}
- Author: ${commit_author}
- Files Changed: ${filesChanged}
- Lines Added: ${linesAdded}
- Lines Removed: ${linesRemoved}
${truncated ? '- Note: Diff output was truncated due to size limits' : ''}

Code Diff:
\`\`\`diff
${diff}
\`\`\`

Analyze this deployment and provide:
1. Risk level (LOW/MEDIUM/HIGH)
2. Key concerns (list breaking changes, security issues, performance impacts, etc.)
3. Recommendation (APPROVE/REVIEW/BLOCK)
4. Reasoning (brief explanation of your assessment)

Respond with ONLY valid JSON, no additional text:
\`\`\`json
{
  "risk_level": "LOW|MEDIUM|HIGH",
  "concerns": ["concern1", "concern2"],
  "recommendation": "APPROVE|REVIEW|BLOCK",
  "reasoning": "Your explanation here"
}
\`\`\``;

  return prompt;
}

/**
 * Analyze deployment and assess risk
 * @param {object} deploymentData - Deployment data from GitHub webhook
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Slack thread timestamp
 * @returns {Promise} {success, decision/error}
 */
async function analyzeDeployment(deploymentData, channel, threadTs) {
  const deploymentId = deploymentData.deployment_id;

  try {
    // Post status update to Slack
    await baseAgent.postAgentUpdate(
      channel,
      threadTs,
      'DEV',
      '🔍 Analyzing commit changes...'
    );

    // Prepare repository
    const repoPath = prepareRepository(deploymentData.repository);

    // Analyze diff
    const diffAnalysis = analyzeCommitDiff(repoPath, deploymentData.commit_sha);

    // Build prompt
    const prompt = buildAnalysisPrompt(deploymentData, diffAnalysis);

    // Call Claude
    const claudeResult = await baseAgent.callClaude({
      model: DEV_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    if (!claudeResult.success) {
      throw new Error(`Claude API failed: ${claudeResult.error}`);
    }

    // Extract decision
    const responseText = claudeResult.data.content[0].text;
    const decision = baseAgent.extractDecision(responseText);

    if (!decision) {
      throw new Error('Failed to parse Claude response as JSON');
    }

    // Validate decision format
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(decision.risk_level)) {
      decision.risk_level = 'MEDIUM'; // Default if invalid
    }
    if (!['APPROVE', 'REVIEW', 'BLOCK'].includes(decision.recommendation)) {
      decision.recommendation = 'REVIEW'; // Default if invalid
    }
    if (!Array.isArray(decision.concerns)) {
      decision.concerns = []; // Default if invalid
    }
    if (!decision.reasoning) {
      decision.reasoning = 'Analysis complete'; // Default if missing
    }

    // Update Notion with analysis
    const analysisNotes = `Risk Level: ${decision.risk_level}
Recommendation: ${decision.recommendation}
Concerns: ${decision.concerns.join(', ') || 'None'}
Reasoning: ${decision.reasoning}

Files Changed: ${diffAnalysis.filesChanged}
Lines Added: ${diffAnalysis.linesAdded}
Lines Removed: ${diffAnalysis.linesRemoved}`;

    await baseAgent.updateNotionNotes(deploymentId, 'DEV', analysisNotes);

    // Post summary to Slack thread
    let riskEmoji = '🟢';
    if (decision.risk_level === 'MEDIUM') riskEmoji = '🟡';
    if (decision.risk_level === 'HIGH') riskEmoji = '🔴';

    const slackMessage = `✅ Analysis complete

${riskEmoji} Risk: ${decision.risk_level}
📋 Recommendation: ${decision.recommendation}
${decision.concerns.length > 0 ? `⚠️ Concerns: ${decision.concerns.join(', ')}` : '✔️ No concerns identified'}

${decision.reasoning}`;

    await baseAgent.postAgentUpdate(channel, threadTs, 'DEV', slackMessage);

    console.log(`[DEV Agent] ✅ Analysis complete for ${deploymentId}`);

    return {
      success: true,
      deploymentId: deploymentId,
      decision: decision,
      stats: diffAnalysis
    };

  } catch (error) {
    console.error(`[DEV Agent] ❌ Error: ${error.message}`);

    // Post error to Slack
    await baseAgent.postAgentUpdate(
      channel,
      threadTs,
      'DEV',
      `❌ Analysis failed: ${error.message}`
    );

    return {
      success: false,
      deploymentId: deploymentId,
      error: error.message
    };
  }
}

module.exports = {
  analyzeDeployment,
  prepareRepository,
  analyzeCommitDiff,
  buildAnalysisPrompt
};
