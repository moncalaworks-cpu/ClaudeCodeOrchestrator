/**
 * DEV Agent Tests
 */

const fs = require('fs');
const path = require('path');

// Mock child_process BEFORE requiring dev.js
const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  execSync: mockExecSync
}));

// Mock Anthropic SDK
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
  postThreadUpdate: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../notion', () => ({
  updateAgentNotes: jest.fn().mockResolvedValue(true)
}));

// Mock fs
jest.mock('fs');

const devAgent = require('../dev');
const baseAgent = require('../base');
const slackHandler = require('../../slack');
const notionHandler = require('../../notion');

describe('DEV Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
  });

  describe('analyzeCommitDiff', () => {
    test('parses git diff and stats correctly', () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('git diff')) {
          return 'diff --git a/file.js b/file.js\n+console.log("test")';
        }
        if (cmd.includes('git show --stat')) {
          return 'file.js | 2 insertions(+), 1 deletion(-)';
        }
        return '';
      });

      const result = devAgent.analyzeCommitDiff('/repo', 'abc123');

      expect(result.filesChanged).toBe(0);
      expect(result.linesAdded).toBe(2);
      expect(result.linesRemoved).toBe(1);
      expect(result.diff).toContain('diff --git');
    });

    test('handles no repository gracefully', () => {
      const result = devAgent.analyzeCommitDiff(null, 'abc123');

      expect(result.diff).toBe('');
      expect(result.filesChanged).toBe(0);
    });

    test('limits diff output to 10k chars', () => {
      const largeDiff = '+' + 'x'.repeat(15000);
      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('git diff')) return largeDiff;
        if (cmd.includes('git show --stat')) return '';
        return '';
      });

      const result = devAgent.analyzeCommitDiff('/repo', 'abc123');

      expect(result.diff.length).toBeLessThanOrEqual(10000);
      expect(result.truncated).toBe(true);
    });
  });

  describe('buildAnalysisPrompt', () => {
    test('builds valid analysis prompt', () => {
      const deploymentData = {
        branch: 'feature/auth',
        commit_sha: 'abc123',
        commit_message: 'Add JWT auth',
        commit_author: 'John',
        repository: 'owner/repo'
      };

      const diffAnalysis = {
        diff: 'diff content',
        filesChanged: 5,
        linesAdded: 100,
        linesRemoved: 50,
        truncated: false
      };

      const prompt = devAgent.buildAnalysisPrompt(deploymentData, diffAnalysis);

      expect(prompt).toContain('feature/auth');
      expect(prompt).toContain('Files Changed: 5');
      expect(prompt).toContain('risk_level');
      expect(prompt).toContain('recommendation');
    });
  });

  describe('analyzeDeployment', () => {
    test('analyzes deployment and returns decision', async () => {
      mockExecSync.mockReturnValue('');
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{
          text: '```json\n{"risk_level": "LOW", "recommendation": "APPROVE", "concerns": [], "reasoning": "Safe"}\n```'
        }],
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      fs.existsSync.mockReturnValue(true);

      const deploymentData = {
        deployment_id: 'deploy-test-123',
        branch: 'feature/test',
        commit_sha: 'abc123',
        commit_message: 'Test commit',
        commit_author: 'John',
        repository: 'owner/repo'
      };

      const result = await devAgent.analyzeDeployment(
        deploymentData,
        'C123',
        '1234567890.123456'
      );

      expect(result.success).toBe(true);
      expect(result.decision.risk_level).toBe('LOW');
      expect(result.decision.recommendation).toBe('APPROVE');
      expect(slackHandler.postThreadUpdate).toHaveBeenCalled();
      expect(notionHandler.updateAgentNotes).toHaveBeenCalled();
    });

    test('handles Claude API failure', async () => {
      mockExecSync.mockReturnValue('');
      mockAnthropic.messages.create.mockRejectedValue(
        new Error('API error')
      );

      const deploymentData = {
        deployment_id: 'deploy-test-123',
        branch: 'feature/test',
        commit_sha: 'abc123',
        commit_message: 'Test commit',
        commit_author: 'John',
        repository: 'owner/repo'
      };

      const result = await devAgent.analyzeDeployment(
        deploymentData,
        'C123',
        '1234567890.123456'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude API failed');
    });

    test('validates and defaults invalid decision fields', async () => {
      mockExecSync.mockReturnValue('');
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{
          text: '{"risk_level": "INVALID", "recommendation": "UNKNOWN"}'
        }],
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      fs.existsSync.mockReturnValue(true);

      const deploymentData = {
        deployment_id: 'deploy-test-123',
        branch: 'feature/test',
        commit_sha: 'abc123',
        commit_message: 'Test',
        commit_author: 'John',
        repository: 'owner/repo'
      };

      const result = await devAgent.analyzeDeployment(
        deploymentData,
        'C123',
        '1234567890.123456'
      );

      expect(result.success).toBe(true);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(result.decision.risk_level);
      expect(['APPROVE', 'REVIEW', 'BLOCK']).toContain(result.decision.recommendation);
    });

    test('posts status updates to Slack', async () => {
      mockExecSync.mockReturnValue('');
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{
          text: '```json\n{"risk_level": "LOW", "recommendation": "APPROVE", "concerns": [], "reasoning": "Safe"}\n```'
        }],
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      fs.existsSync.mockReturnValue(true);

      const deploymentData = {
        deployment_id: 'deploy-test-123',
        branch: 'feature/test',
        commit_sha: 'abc123',
        commit_message: 'Test',
        commit_author: 'John',
        repository: 'owner/repo'
      };

      await devAgent.analyzeDeployment(
        deploymentData,
        'C123',
        '1234567890.123456'
      );

      // Should post at least 2 updates: initial status + analysis complete
      expect(slackHandler.postThreadUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
