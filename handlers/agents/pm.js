/**
 * PM Agent
 * Reviews deployment and makes approval decision
 */

const baseAgent = require('./base');
const notionHandler = require('../notion');
const reactionsHandler = require('../reactions');

// Models
const PM_MODEL = process.env.CLAUDE_PM_MODEL || 'claude-3-7-sonnet-20250219';

/**
 * Determine if deployment should be auto-approved
 * @param {object} context - Deployment context
 * @param {object} devDecision - DEV agent decision
 * @param {object} pmDecision - PM agent decision
 * @returns {boolean} True if should auto-approve
 */
function shouldAutoApprove(context, devDecision, pmDecision) {
  // Check if auto-approval is enabled
  if (process.env.ENABLE_AUTO_APPROVAL !== 'true') {
    return false;
  }

  // Criteria
  return (
    devDecision.risk_level === 'LOW' &&
    pmDecision.decision === 'AUTO_APPROVE' &&
    pmDecision.confidence >= 0.8 &&
    context.branch !== 'main' &&
    context.branch !== 'master'
  );
}

/**
 * Build decision prompt for Claude
 * @param {object} deploymentData - Deployment data
 * @param {object} devNotes - DEV agent notes
 * @returns {string} Prompt text
 */
function buildDecisionPrompt(deploymentData, devNotes) {
  const { branch, commit_message, commit_author, repository } = deploymentData;

  const prompt = `You are a PM agent reviewing a deployment for approval decision.

Deployment Context:
- Repository: ${repository}
- Branch: ${branch}
- Commit Message: ${commit_message}
- Author: ${commit_author}

DEV Agent Analysis:
${devNotes}

Decision Task:
Determine if this deployment can be AUTO_APPROVED without human review, or if it needs HUMAN_REVIEW.

Criteria for AUTO_APPROVE:
- LOW risk from DEV agent analysis
- No blocking concerns or breaking changes
- Feature branch OR develop (never auto-approve main/master for PROD)
- Clear, descriptive commit message
- Trusted workflow patterns

Respond with ONLY valid JSON, no additional text:
\`\`\`json
{
  "decision": "AUTO_APPROVE|HUMAN_REVIEW",
  "confidence": 0.0,
  "reasoning": "Why this decision?"
}
\`\`\``;

  return prompt;
}

/**
 * Review deployment and make approval decision
 * @param {string} deploymentId - Deployment ID
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Slack thread timestamp
 * @returns {Promise} {success, decision/error}
 */
async function reviewDeployment(deploymentId, channel, threadTs) {
  try {
    // Post status update to Slack
    await baseAgent.postAgentUpdate(
      channel,
      threadTs,
      'PM',
      '📊 Reviewing deployment...'
    );

    // Fetch deployment record from Notion
    const deploymentRecord = await notionHandler.getDeploymentRecord(deploymentId);
    if (!deploymentRecord) {
      throw new Error('Failed to fetch deployment record from Notion');
    }

    // Extract properties
    const branch = deploymentRecord.properties.Branch?.select?.name;
    const commitMessage = deploymentRecord.properties['Commit Message']?.select?.name;
    const author = deploymentRecord.properties.Author?.select?.name;
    const repository = deploymentRecord.properties['Commit SHA']?.rich_text?.[0]?.text?.content; // Fallback

    // Extract DEV Agent Notes
    const devAgentNotes = deploymentRecord.properties['DEV Agent Notes']?.rich_text?.[0]?.text?.content || 'No analysis available';

    // Build decision prompt
    const prompt = buildDecisionPrompt(
      { branch, commit_message: commitMessage, commit_author: author, repository },
      devAgentNotes
    );

    // Call Claude
    const claudeResult = await baseAgent.callClaude({
      model: PM_MODEL,
      max_tokens: 300,
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
    if (!['AUTO_APPROVE', 'HUMAN_REVIEW'].includes(decision.decision)) {
      decision.decision = 'HUMAN_REVIEW'; // Default to safe option
    }
    if (typeof decision.confidence !== 'number') {
      decision.confidence = 0;
    }

    // Update Notion with PM decision
    const pmNotes = `Decision: ${decision.decision}
Confidence: ${(decision.confidence * 100).toFixed(0)}%
Reasoning: ${decision.reasoning}

Timestamp: ${new Date().toISOString()}`;

    await baseAgent.updateNotionNotes(deploymentId, 'PM', pmNotes);

    // Determine if should auto-approve
    const context = { branch };
    const devDecision = extractDevDecision(devAgentNotes);
    const canAutoApprove = shouldAutoApprove(context, devDecision, decision);

    if (canAutoApprove) {
      // Post auto-approval message
      await baseAgent.postAgentUpdate(
        channel,
        threadTs,
        'PM',
        `✅ Auto-approved (confidence: ${(decision.confidence * 100).toFixed(0)}%)\n\n${decision.reasoning}`
      );

      // Update Notion approval status
      const approvalResult = await notionHandler.updateDeploymentApproval(deploymentId, 'PM Agent (Auto)');

      // Trigger GitHub Actions deployment
      const deploymentResult = await triggerGitHubDeployment(
        deploymentId,
        channel,
        threadTs,
        branch
      );

      if (!deploymentResult.success) {
        console.warn(`[PM Agent] ⚠️ GitHub deployment trigger failed: ${deploymentResult.error}`);
      }

      console.log(`[PM Agent] ✅ Auto-approved ${deploymentId}`);

      return {
        success: true,
        deploymentId: deploymentId,
        decision: decision,
        autoApproved: true
      };
    } else {
      // Post human review request
      await baseAgent.postAgentUpdate(
        channel,
        threadTs,
        'PM',
        `⚠️ Human approval required\n\n${decision.reasoning}\n\nReact with ✅ to approve or ❌ to reject`
      );

      console.log(`[PM Agent] ⚠️ Human review requested for ${deploymentId}`);

      return {
        success: true,
        deploymentId: deploymentId,
        decision: decision,
        autoApproved: false
      };
    }

  } catch (error) {
    console.error(`[PM Agent] ❌ Error: ${error.message}`);

    // Post error to Slack
    await baseAgent.postAgentUpdate(
      channel,
      threadTs,
      'PM',
      `❌ Review failed: ${error.message}\n\nRequesting human approval instead.`
    );

    // Default to human approval on error
    return {
      success: false,
      deploymentId: deploymentId,
      error: error.message,
      defaultToHumanApproval: true
    };
  }
}

/**
 * Extract DEV decision from notes text
 * @param {string} devNotes - DEV agent notes
 * @returns {object} Parsed decision
 */
function extractDevDecision(devNotes) {
  try {
    const riskMatch = devNotes.match(/Risk Level: (LOW|MEDIUM|HIGH)/);
    const recommendationMatch = devNotes.match(/Recommendation: (APPROVE|REVIEW|BLOCK)/);

    return {
      risk_level: riskMatch ? riskMatch[1] : 'MEDIUM',
      recommendation: recommendationMatch ? recommendationMatch[1] : 'REVIEW'
    };
  } catch (error) {
    return {
      risk_level: 'MEDIUM',
      recommendation: 'REVIEW'
    };
  }
}

/**
 * Trigger GitHub Actions deployment
 * @param {string} deploymentId - Deployment ID
 * @param {string} channel - Slack channel
 * @param {string} threadTs - Thread timestamp
 * @param {string} branch - Branch name
 * @returns {Promise} {success, error}
 */
async function triggerGitHubDeployment(deploymentId, channel, threadTs, branch) {
  try {
    console.log(`[PM Agent] 🚀 Triggering deployment for ${deploymentId} on branch ${branch}`);

    // Call the reactions handler's deployment trigger
    // which handles GitHub Actions workflow dispatch
    const result = await reactionsHandler.triggerDeployment(
      deploymentId,
      channel,
      threadTs,
      'PM Agent'
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    return { success: true };
  } catch (error) {
    console.error(`[PM Agent] ⚠️ Deployment trigger error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = {
  reviewDeployment,
  shouldAutoApprove,
  buildDecisionPrompt,
  extractDevDecision,
  triggerGitHubDeployment
};
