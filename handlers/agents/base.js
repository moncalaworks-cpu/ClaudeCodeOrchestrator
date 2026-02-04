/**
 * Base Agent Utilities
 * Shared utilities for all Claude API agents
 */

const Anthropic = require('@anthropic-ai/sdk');
const slackHandler = require('../slack');
const notionHandler = require('../notion');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Call Claude API with error handling
 * @param {object} params - Claude API parameters
 * @param {string} params.model - Model ID (e.g., 'claude-3-5-haiku-20241022')
 * @param {number} params.max_tokens - Max tokens in response
 * @param {array} params.messages - Messages array
 * @returns {Promise} {success, data/error}
 */
async function callClaude(params) {
  try {
    const response = await anthropic.messages.create({
      model: params.model,
      max_tokens: params.max_tokens || 1024,
      messages: params.messages
    });

    console.log(`[Claude API] ✅ Call successful (${params.model})`);

    return {
      success: true,
      data: response,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens
      }
    };
  } catch (error) {
    console.error(`[Claude API] ❌ Error: ${error.message}`);
    return {
      success: false,
      error: error.message,
      errorType: error.status || 'unknown'
    };
  }
}

/**
 * Extract JSON from Claude response
 * Handles responses with markdown code blocks or inline JSON
 * @param {string} responseText - Claude response text
 * @returns {object|null} Parsed JSON or null if extraction fails
 */
function extractDecision(responseText) {
  try {
    // Try to extract JSON from markdown code block first (with flexible whitespace)
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      const jsonStr = codeBlockMatch[1].trim();
      try {
        return JSON.parse(jsonStr);
      } catch {
        // Code block doesn't contain JSON, fall through
      }
    }

    // Try to find JSON object starting with { or [
    const jsonMatch = responseText.match(/(\{[\s\S]*?\}|\[[\s\S]*?\])/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    // Try to parse entire response as JSON
    const parsed = JSON.parse(responseText);
    return parsed;
  } catch (error) {
    console.warn(`[Claude API] ⚠️ Failed to extract JSON from response: ${error.message}`);
    return null;
  }
}

/**
 * Post update to Slack thread
 * @param {string} channel - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} agentName - Agent name (DEV/PM/OPS/QAE)
 * @param {string} message - Message text (markdown)
 * @returns {Promise} {success, ts/error}
 */
async function postAgentUpdate(channel, threadTs, agentName, message) {
  try {
    const formattedMessage = `[${agentName} Agent] ${message}`;
    const result = await slackHandler.postThreadUpdate(channel, threadTs, formattedMessage);
    return result;
  } catch (error) {
    console.error(`[Base Agent] Error posting update to Slack: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Update agent notes in Notion
 * @param {string} deploymentId - Deployment ID
 * @param {string} agentName - Agent name (DEV/PM/OPS/QAE)
 * @param {string} notes - Agent notes (text)
 * @returns {Promise} {success, error}
 */
async function updateNotionNotes(deploymentId, agentName, notes) {
  try {
    const success = await notionHandler.updateAgentNotes(
      deploymentId,
      agentName,
      notes.substring(0, 2000) // Notion limit
    );

    return {
      success: success,
      error: success ? null : 'Failed to update Notion'
    };
  } catch (error) {
    console.error(`[Base Agent] Error updating Notion: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Retry logic with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxAttempts - Maximum retry attempts
 * @param {number} initialDelayMs - Initial delay in milliseconds
 * @returns {Promise} Result from function
 */
async function retryWithBackoff(fn, maxAttempts = 3, initialDelayMs = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[Base Agent] ⚠️ Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

module.exports = {
  callClaude,
  extractDecision,
  postAgentUpdate,
  updateNotionNotes,
  retryWithBackoff
};
