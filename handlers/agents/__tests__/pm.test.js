/**
 * PM Agent Tests
 */

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
  getDeploymentRecord: jest.fn(),
  updateAgentNotes: jest.fn().mockResolvedValue(true),
  updateDeploymentApproval: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../reactions', () => ({
  triggerDeployment: jest.fn().mockResolvedValue({ success: true })
}));

const pmAgent = require('../pm');
const slackHandler = require('../../slack');
const notionHandler = require('../../notion');
const reactionsHandler = require('../../reactions');

describe('PM Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENABLE_AUTO_APPROVAL = 'true';
  });

  describe('shouldAutoApprove', () => {
    test('auto-approves LOW risk feature branches', () => {
      const context = { branch: 'feature/test' };
      const devDecision = { risk_level: 'LOW' };
      const pmDecision = { decision: 'AUTO_APPROVE', confidence: 0.9 };

      const result = pmAgent.shouldAutoApprove(context, devDecision, pmDecision);

      expect(result).toBe(true);
    });

    test('rejects auto-approval for main branch', () => {
      const context = { branch: 'main' };
      const devDecision = { risk_level: 'LOW' };
      const pmDecision = { decision: 'AUTO_APPROVE', confidence: 0.9 };

      const result = pmAgent.shouldAutoApprove(context, devDecision, pmDecision);

      expect(result).toBe(false);
    });

    test('rejects auto-approval for MEDIUM risk', () => {
      const context = { branch: 'feature/test' };
      const devDecision = { risk_level: 'MEDIUM' };
      const pmDecision = { decision: 'AUTO_APPROVE', confidence: 0.9 };

      const result = pmAgent.shouldAutoApprove(context, devDecision, pmDecision);

      expect(result).toBe(false);
    });

    test('rejects auto-approval with low confidence', () => {
      const context = { branch: 'feature/test' };
      const devDecision = { risk_level: 'LOW' };
      const pmDecision = { decision: 'AUTO_APPROVE', confidence: 0.7 };

      const result = pmAgent.shouldAutoApprove(context, devDecision, pmDecision);

      expect(result).toBe(false);
    });

    test('respects ENABLE_AUTO_APPROVAL flag', () => {
      process.env.ENABLE_AUTO_APPROVAL = 'false';

      const context = { branch: 'feature/test' };
      const devDecision = { risk_level: 'LOW' };
      const pmDecision = { decision: 'AUTO_APPROVE', confidence: 0.9 };

      const result = pmAgent.shouldAutoApprove(context, devDecision, pmDecision);

      expect(result).toBe(false);
    });
  });

  describe('buildDecisionPrompt', () => {
    test('builds valid decision prompt', () => {
      const deploymentData = {
        branch: 'feature/auth',
        commit_message: 'Add JWT auth',
        commit_author: 'John',
        repository: 'owner/repo'
      };

      const devNotes = 'Risk Level: LOW\nRecommendation: APPROVE';

      const prompt = pmAgent.buildDecisionPrompt(deploymentData, devNotes);

      expect(prompt).toContain('feature/auth');
      expect(prompt).toContain('Add JWT auth');
      expect(prompt).toContain('Risk Level: LOW');
      expect(prompt).toContain('AUTO_APPROVE');
    });
  });

  describe('extractDevDecision', () => {
    test('extracts risk level and recommendation', () => {
      const devNotes = `Risk Level: LOW
Recommendation: APPROVE
Concerns: None`;

      const decision = pmAgent.extractDevDecision(devNotes);

      expect(decision.risk_level).toBe('LOW');
      expect(decision.recommendation).toBe('APPROVE');
    });

    test('defaults to MEDIUM/REVIEW when parsing fails', () => {
      const devNotes = 'Invalid notes';

      const decision = pmAgent.extractDevDecision(devNotes);

      expect(decision.risk_level).toBe('MEDIUM');
      expect(decision.recommendation).toBe('REVIEW');
    });
  });

  describe('reviewDeployment', () => {
    test('auto-approves LOW risk deployments', async () => {
      notionHandler.getDeploymentRecord.mockResolvedValue({
        properties: {
          'Branch': { select: { name: 'feature/test' } },
          'Commit Message': { select: { name: 'Test commit' } },
          'Author': { select: { name: 'John' } },
          'DEV Agent Notes': {
            rich_text: [{ text: { content: 'Risk Level: LOW\nRecommendation: APPROVE' } }]
          }
        }
      });

      mockAnthropic.messages.create.mockResolvedValue({
        content: [{
          text: '{"decision": "AUTO_APPROVE", "confidence": 0.92, "reasoning": "Safe changes"}'
        }],
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      const result = await pmAgent.reviewDeployment(
        'deploy-test-123',
        'C123',
        '1234567890.123456'
      );

      expect(result.success).toBe(true);
      expect(result.autoApproved).toBe(true);
      expect(notionHandler.updateDeploymentApproval).toHaveBeenCalled();
      expect(reactionsHandler.triggerDeployment).toHaveBeenCalled();
    });

    test('requests human review for MEDIUM risk', async () => {
      notionHandler.getDeploymentRecord.mockResolvedValue({
        properties: {
          'Branch': { select: { name: 'feature/test' } },
          'Commit Message': { select: { name: 'Test commit' } },
          'Author': { select: { name: 'John' } },
          'DEV Agent Notes': {
            rich_text: [{ text: { content: 'Risk Level: MEDIUM\nRecommendation: REVIEW' } }]
          }
        }
      });

      mockAnthropic.messages.create.mockResolvedValue({
        content: [{
          text: '{"decision": "HUMAN_REVIEW", "confidence": 0.85, "reasoning": "Requires validation"}'
        }],
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      const result = await pmAgent.reviewDeployment(
        'deploy-test-123',
        'C123',
        '1234567890.123456'
      );

      expect(result.success).toBe(true);
      expect(result.autoApproved).toBe(false);
      expect(reactionsHandler.triggerDeployment).not.toHaveBeenCalled();
    });

    test('defaults to human approval on Notion fetch error', async () => {
      notionHandler.getDeploymentRecord.mockResolvedValue(null);

      const result = await pmAgent.reviewDeployment(
        'deploy-test-123',
        'C123',
        '1234567890.123456'
      );

      expect(result.success).toBe(false);
      expect(result.defaultToHumanApproval).toBe(true);
    });

    test('defaults to human approval on Claude API error', async () => {
      notionHandler.getDeploymentRecord.mockResolvedValue({
        properties: {
          'Branch': { select: { name: 'feature/test' } },
          'Commit Message': { select: { name: 'Test' } },
          'Author': { select: { name: 'John' } },
          'DEV Agent Notes': { rich_text: [{ text: { content: 'Notes' } }] }
        }
      });

      mockAnthropic.messages.create.mockRejectedValue(new Error('API error'));

      const result = await pmAgent.reviewDeployment(
        'deploy-test-123',
        'C123',
        '1234567890.123456'
      );

      expect(result.success).toBe(false);
      expect(result.defaultToHumanApproval).toBe(true);
    });

    test('updates Notion with PM decision', async () => {
      notionHandler.getDeploymentRecord.mockResolvedValue({
        properties: {
          'Branch': { select: { name: 'develop' } },
          'Commit Message': { select: { name: 'Test' } },
          'Author': { select: { name: 'John' } },
          'DEV Agent Notes': {
            rich_text: [{ text: { content: 'Risk Level: LOW\nRecommendation: APPROVE' } }]
          }
        }
      });

      mockAnthropic.messages.create.mockResolvedValue({
        content: [{
          text: '{"decision": "AUTO_APPROVE", "confidence": 0.9, "reasoning": "Safe"}'
        }],
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      await pmAgent.reviewDeployment(
        'deploy-test-123',
        'C123',
        '1234567890.123456'
      );

      expect(notionHandler.updateAgentNotes).toHaveBeenCalledWith(
        'deploy-test-123',
        'PM',
        expect.stringContaining('AUTO_APPROVE')
      );
    });
  });
});
