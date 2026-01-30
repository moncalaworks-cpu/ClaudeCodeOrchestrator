/**
 * Slack Handler
 * Sends deployment notifications to environment-specific channels
 */

const { WebClient } = require('@slack/web-api');

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Map branch names to Slack channel IDs
 * @param {string} branch - The branch name
 * @returns {string} The channel ID for the branch
 */
function getChannelForBranch(branch) {
  if (branch.startsWith('feature/')) {
    return process.env.SLACK_DEV_CHANNEL_ID;
  }
  if (branch === 'develop') {
    return process.env.SLACK_QA_CHANNEL_ID;
  }
  if (branch === 'main') {
    return process.env.SLACK_PROD_CHANNEL_ID;
  }
  return process.env.SLACK_INCIDENTS_CHANNEL_ID; // Default to incidents for unknown branches
}

/**
 * Send deployment notification to Slack
 * @param {object} deploymentData - Deployment data from GitHub webhook
 * @returns {object} Result with success status and thread_ts (or error)
 */
async function sendDeploymentNotification(deploymentData) {
  try {
    const channel = getChannelForBranch(deploymentData.branch);

    // Determine deployment status label based on branch
    let statusLabel = 'deployment pending';
    if (deploymentData.branch.startsWith('feature/')) {
      statusLabel = 'DEV deployment pending';
    } else if (deploymentData.branch === 'develop') {
      statusLabel = 'QA deployment pending';
    } else if (deploymentData.branch === 'main') {
      statusLabel = 'PROD deployment pending';
    }

    const commitUrl = `https://github.com/${deploymentData.repository}/commit/${deploymentData.commit_sha}`;
    const message = `${statusLabel} - ${deploymentData.deployment_id}

Repository: ${deploymentData.repository}
Branch: ${deploymentData.branch}
Commit: <${commitUrl}|${deploymentData.commit_sha}> - ${deploymentData.commit_message}
Author: ${deploymentData.commit_author}
Triggered: ${deploymentData.triggered_at}`;

    const result = await slack.chat.postMessage({
      channel: channel,
      text: message,
      mrkdwn: true
    });

    console.log(`[Slack] Notification sent to channel ${channel}, thread_ts: ${result.ts}`);

    return {
      success: true,
      thread_ts: result.ts,
      channel: channel,
      message_ts: result.ts
    };
  } catch (error) {
    console.error(`[Slack] ❌ Failed to send notification: ${error.message}`);

    // Attempt to post error to INCIDENTS channel
    try {
      await slack.chat.postMessage({
        channel: process.env.SLACK_INCIDENTS_CHANNEL_ID,
        text: `❌ Failed to send deployment notification for ${deploymentData.deployment_id}\n\nError: ${error.message}\n\nBranch: ${deploymentData.branch}`,
        mrkdwn: true
      });
      console.log('[Slack] ✅ Error notification sent to INCIDENTS channel');
    } catch (incidentError) {
      console.error(`[Slack] ❌ Failed to send incident notification: ${incidentError.message}`);
    }

    return {
      success: false,
      error: error.message,
      thread_ts: null
    };
  }
}

/**
 * Post status update to deployment thread
 * Stub for future implementation in Phase 3B
 * @param {string} threadId - Thread timestamp to reply to
 * @param {string} status - Status message
 * @returns {object} Result object
 */
async function postStatusUpdate(threadId, status) {
  try {
    // Stub for future phases
    console.log(`[Slack] Status update stub called for thread ${threadId}: ${status}`);
    return {
      success: true,
      message: 'Status update stub - to be implemented in Phase 3B'
    };
  } catch (error) {
    console.error(`[Slack] Failed to post status update: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  sendDeploymentNotification,
  getChannelForBranch,
  postStatusUpdate
};
