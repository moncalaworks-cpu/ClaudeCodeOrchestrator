/**
 * Slack Reaction Handler
 * Processes deployment approvals/rejections via reactions
 */

const { WebClient } = require('@slack/web-api');
const https = require('https');

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Handle reaction_added event from Slack
 * @param {object} event - Slack reaction event
 */
async function handleReactionAdded(event) {
  try {
    const { user, reaction, item } = event;

    // Only process reactions on messages (not files, etc)
    if (item.type !== 'message') {
      console.log(`[Slack Reactions] Ignoring reaction on ${item.type}`);
      return;
    }

    const threadTs = item.ts;
    const channel = item.channel;

    console.log(`[Slack Reactions] ${user} added :${reaction}: to message in ${channel}`);

    // Check if this is an approval/rejection reaction
    if (reaction === 'white_check_mark' || reaction === '+1') {
      await approveDeployment(channel, threadTs, user);
    } else if (reaction === 'x' || reaction === '-1') {
      await rejectDeployment(channel, threadTs, user);
    } else {
      console.log(`[Slack Reactions] Ignoring reaction: ${reaction}`);
    }
  } catch (error) {
    console.error(`[Slack Reactions] Error handling reaction: ${error.message}`);
  }
}

/**
 * Handle deployment approval
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} userId - User ID who approved
 */
async function approveDeployment(channel, threadTs, userId) {
  try {
    console.log(`[Slack Reactions] Processing approval from user ${userId}`);

    // Get user info for audit trail
    const userInfo = await slack.users.info({ user: userId });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Get the message to extract deployment info
    const messageResult = await slack.conversations.history({
      channel: channel,
      latest: threadTs,
      limit: 1,
      inclusive: true
    });

    const message = messageResult.messages[0];
    const deploymentId = extractDeploymentId(message.text);

    // Reply to thread with approval
    await slack.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: `✅ Deployment approved by ${userName}`,
      mrkdwn: true
    });

    console.log(`[Slack Reactions] Deployment ${deploymentId} approved by ${userName}`);

    // Post deployment command to thread
    await postDeploymentCommand(channel, threadTs, deploymentId);

    // TODO: Phase 4 - Update Notion deployment record
    // Example:
    // await notionHandler.updateDeploymentStatus(deploymentId, {
    //   status: 'approved',
    //   approvedBy: userName,
    //   approvalTime: new Date().toISOString()
    // });

  } catch (error) {
    console.error(`[Slack Reactions] Error approving deployment: ${error.message}`);

    // Reply to thread with error
    try {
      await slack.chat.postMessage({
        channel: channel,
        thread_ts: threadTs,
        text: `Error processing approval: ${error.message}`,
        mrkdwn: true
      });
    } catch (replyError) {
      console.error(`[Slack Reactions] Failed to post error to thread: ${replyError.message}`);
    }
  }
}

/**
 * Handle deployment rejection
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} userId - User ID who rejected
 */
async function rejectDeployment(channel, threadTs, userId) {
  try {
    console.log(`[Slack Reactions] Processing rejection from user ${userId}`);

    // Get user info for audit trail
    const userInfo = await slack.users.info({ user: userId });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Get the message to extract deployment info
    const messageResult = await slack.conversations.history({
      channel: channel,
      latest: threadTs,
      limit: 1,
      inclusive: true
    });

    const message = messageResult.messages[0];
    const deploymentId = extractDeploymentId(message.text);

    // Reply to thread with rejection
    await slack.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: `❌ Deployment rejected by ${userName}`,
      mrkdwn: true
    });

    console.log(`[Slack Reactions] Deployment ${deploymentId} rejected by ${userName}`);

    // TODO: Phase 4 - Update Notion deployment record
    // TODO: Phase 5 - Cancel/rollback deployment
    // Example:
    // await notionHandler.updateDeploymentStatus(deploymentId, {
    //   status: 'rejected',
    //   rejectedBy: userName,
    //   rejectionTime: new Date().toISOString()
    // });

  } catch (error) {
    console.error(`[Slack Reactions] Error rejecting deployment: ${error.message}`);

    // Reply to thread with error
    try {
      await slack.chat.postMessage({
        channel: channel,
        thread_ts: threadTs,
        text: `Error processing rejection: ${error.message}`,
        mrkdwn: true
      });
    } catch (replyError) {
      console.error(`[Slack Reactions] Failed to post error to thread: ${replyError.message}`);
    }
  }
}

/**
 * Extract deployment ID from message text
 * Looks for "deploy-branch-timestamp" pattern
 * @param {string} messageText - The Slack message text
 * @returns {string} Deployment ID or 'unknown'
 */
function extractDeploymentId(messageText) {
  if (!messageText) return 'unknown';
  const match = messageText.match(/deploy-[a-zA-Z0-9*/-]+-\d+/);
  return match ? match[0] : 'unknown';
}

/**
 * Validate user has permission to approve
 * TODO: Implement role-based access control
 * @param {string} userId - User ID to validate
 * @param {string} channel - Channel where approval is happening
 * @returns {boolean} True if user can approve
 */
async function validateApprover(userId, channel) {
  try {
    // TODO: Check if user is member of approvers list
    // For now, allow all users
    console.log(`[Slack Reactions] Validating approver: ${userId}`);
    return true;
  } catch (error) {
    console.error(`[Slack Reactions] Error validating approver: ${error.message}`);
    return false;
  }
}

/**
 * Reply to a deployment thread with status update
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} status - Status message
 */
async function replyToThread(channel, threadTs, status) {
  try {
    await slack.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: status,
      mrkdwn: true
    });
    console.log(`[Slack Reactions] Posted status to thread: ${status.substring(0, 50)}...`);
  } catch (error) {
    console.error(`[Slack Reactions] Error replying to thread: ${error.message}`);
  }
}

/**
 * Post deployment approval to Slack with Heroku deploy command
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} deploymentId - Deployment ID
 */
async function postDeploymentCommand(channel, threadTs, deploymentId) {
  try {
    const deployCommand = 'git push heroku main';
    const message = `🚀 Ready to deploy! Run this command to deploy to Heroku:\n\`\`\`\n${deployCommand}\n\`\`\`\n\nDeployment ID: ${deploymentId}`;

    await slack.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: message,
      mrkdwn: true
    });

    console.log(`[Slack Reactions] Posted deployment command for ${deploymentId}`);
  } catch (error) {
    console.error(`[Slack Reactions] Error posting deployment command: ${error.message}`);
  }
}

module.exports = {
  handleReactionAdded,
  approveDeployment,
  rejectDeployment,
  validateApprover,
  replyToThread,
  extractDeploymentId,
  postDeploymentCommand
};
