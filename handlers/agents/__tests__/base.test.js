/**
 * Base Agent Tests
 */

// Mock Anthropic SDK BEFORE requiring the module
const mockAnthropic = {
  messages: {
    create: jest.fn()
  }
};

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn(() => mockAnthropic);
});

// Mock handlers
jest.mock('../../slack', () => ({
  postThreadUpdate: jest.fn().mockResolvedValue({ success: true, ts: '1234567890.123456' })
}));

jest.mock('../../notion', () => ({
  updateAgentNotes: jest.fn().mockResolvedValue(true),
  getDeploymentRecord: jest.fn().mockResolvedValue({
    properties: {}
  })
}));

const baseAgent = require('../base');
const slackHandler = require('../../slack');
const notionHandler = require('../../notion');

describe('Base Agent Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('callClaude', () => {
    test('successfully calls Claude API', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ text: 'Response from Claude' }],
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      const result = await baseAgent.callClaude({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Test prompt' }]
      });

      expect(result.success).toBe(true);
      expect(result.data.content[0].text).toBe('Response from Claude');
      expect(result.usage.input_tokens).toBe(100);
      expect(result.usage.output_tokens).toBe(50);
    });

    test('handles API errors gracefully', async () => {
      mockAnthropic.messages.create.mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      const result = await baseAgent.callClaude({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Test prompt' }]
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('rate limit');
    });
  });

  describe('extractDecision', () => {
    test('extracts JSON from markdown code block', () => {
      const response = `
        Here's the decision:
        \`\`\`json
        {
          "risk_level": "LOW",
          "recommendation": "APPROVE",
          "concerns": [],
          "reasoning": "Safe changes"
        }
        \`\`\`
      `;

      const decision = baseAgent.extractDecision(response);

      expect(decision).not.toBeNull();
      expect(decision.risk_level).toBe('LOW');
      expect(decision.recommendation).toBe('APPROVE');
    });

    test('extracts JSON without markdown fence', () => {
      const response = '{"risk_level": "HIGH", "recommendation": "BLOCK"}';

      const decision = baseAgent.extractDecision(response);

      expect(decision).not.toBeNull();
      expect(decision.risk_level).toBe('HIGH');
      expect(decision.recommendation).toBe('BLOCK');
    });

    test('handles invalid JSON gracefully', () => {
      const response = 'This is not JSON';

      const decision = baseAgent.extractDecision(response);

      expect(decision).toBeNull();
    });
  });

  describe('postAgentUpdate', () => {
    test('posts update to Slack thread', async () => {
      const result = await baseAgent.postAgentUpdate(
        'C123',
        '1234567890.123456',
        'DEV',
        'Test message'
      );

      expect(result.success).toBe(true);
      expect(slackHandler.postThreadUpdate).toHaveBeenCalledWith(
        'C123',
        '1234567890.123456',
        '[DEV Agent] Test message'
      );
    });
  });

  describe('updateNotionNotes', () => {
    test('updates Notion agent notes', async () => {
      const result = await baseAgent.updateNotionNotes(
        'deploy-test-123',
        'DEV',
        'Analysis notes'
      );

      expect(result.success).toBe(true);
      expect(notionHandler.updateAgentNotes).toHaveBeenCalledWith(
        'deploy-test-123',
        'DEV',
        'Analysis notes'
      );
    });

    test('truncates long notes to 2000 chars', async () => {
      const longNotes = 'x'.repeat(3000);

      await baseAgent.updateNotionNotes(
        'deploy-test-123',
        'DEV',
        longNotes
      );

      const callArgs = notionHandler.updateAgentNotes.mock.calls[0];
      expect(callArgs[2].length).toBeLessThanOrEqual(2000);
    });
  });

  describe('retryWithBackoff', () => {
    test('succeeds on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await baseAgent.retryWithBackoff(fn, 3, 10);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on failure and succeeds', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValueOnce('success');

      const result = await baseAgent.retryWithBackoff(fn, 3, 10);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('throws after max attempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Always fails'));

      await expect(
        baseAgent.retryWithBackoff(fn, 3, 10)
      ).rejects.toThrow('Always fails');

      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});
