/**
 * Slack Reactions Handler Tests
 * Tests for deployment approval/rejection via Slack reactions
 */

// Setup mock Slack client BEFORE mocking the module
const mockSlack = {
  users: {
    info: jest.fn()
  },
  conversations: {
    history: jest.fn()
  },
  chat: {
    postMessage: jest.fn()
  }
};

// Mock the Slack WebClient BEFORE requiring the handler
jest.mock('@slack/web-api', () => {
  return {
    WebClient: jest.fn(() => mockSlack)
  };
});

const { WebClient } = require('@slack/web-api');
const reactionsHandler = require('../reactions');

describe('Slack Reactions Handler', () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('extractDeploymentId', () => {
    test('extracts deployment ID from standard message', () => {
      const message = 'PROD deployment pending - deploy-main-1769563800391\nRepository: test';
      const result = reactionsHandler.extractDeploymentId(message);
      expect(result).toBe('deploy-main-1769563800391');
    });

    test('returns "unknown" when no deployment ID found', () => {
      const message = 'Some random message without deployment ID';
      const result = reactionsHandler.extractDeploymentId(message);
      expect(result).toBe('unknown');
    });

    test('extracts feature branch deployment IDs', () => {
      const message = 'DEV deployment pending - deploy-feature/new-feature-1234567890';
      const result = reactionsHandler.extractDeploymentId(message);
      expect(result).toBe('deploy-feature/new-feature-1234567890');
    });

    test('extracts QA branch deployment IDs', () => {
      const message = 'QA deployment pending - deploy-develop-9876543210';
      const result = reactionsHandler.extractDeploymentId(message);
      expect(result).toBe('deploy-develop-9876543210');
    });

    test('handles empty message', () => {
      const result = reactionsHandler.extractDeploymentId('');
      expect(result).toBe('unknown');
    });

    test('handles null/undefined gracefully', () => {
      expect(reactionsHandler.extractDeploymentId(null)).toBe('unknown');
      expect(reactionsHandler.extractDeploymentId(undefined)).toBe('unknown');
    });
  });

  describe('handleReactionAdded', () => {
    test('processes white_check_mark reaction', async () => {
      const event = {
        user: 'U123456',
        reaction: 'white_check_mark',
        item: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.000001'
        }
      };

      mockSlack.users.info.mockResolvedValue({
        user: { real_name: 'John Doe' }
      });
      mockSlack.conversations.history.mockResolvedValue({
        messages: [{ text: 'deploy-main-123' }]
      });
      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });

      await reactionsHandler.handleReactionAdded(event);

      expect(mockSlack.users.info).toHaveBeenCalledWith({ user: 'U123456' });
    });

    test('processes +1 reaction (alternative approval)', async () => {
      const event = {
        user: 'U123456',
        reaction: '+1',
        item: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.000001'
        }
      };

      mockSlack.users.info.mockResolvedValue({
        user: { real_name: 'John Doe' }
      });
      mockSlack.conversations.history.mockResolvedValue({
        messages: [{ text: 'deploy-main-123' }]
      });
      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });

      await reactionsHandler.handleReactionAdded(event);

      expect(mockSlack.users.info).toHaveBeenCalled();
    });

    test('processes x reaction (rejection)', async () => {
      const event = {
        user: 'U123456',
        reaction: 'x',
        item: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.000001'
        }
      };

      mockSlack.users.info.mockResolvedValue({
        user: { real_name: 'Jane Smith' }
      });
      mockSlack.conversations.history.mockResolvedValue({
        messages: [{ text: 'deploy-main-123' }]
      });
      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });

      await reactionsHandler.handleReactionAdded(event);

      expect(mockSlack.users.info).toHaveBeenCalled();
    });

    test('processes -1 reaction (alternative rejection)', async () => {
      const event = {
        user: 'U123456',
        reaction: '-1',
        item: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.000001'
        }
      };

      mockSlack.users.info.mockResolvedValue({
        user: { real_name: 'Jane Smith' }
      });
      mockSlack.conversations.history.mockResolvedValue({
        messages: [{ text: 'deploy-main-123' }]
      });
      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });

      await reactionsHandler.handleReactionAdded(event);

      expect(mockSlack.users.info).toHaveBeenCalled();
    });

    test('ignores unrelated reactions', async () => {
      const event = {
        user: 'U123456',
        reaction: 'laughing',
        item: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.000001'
        }
      };

      await reactionsHandler.handleReactionAdded(event);

      expect(mockSlack.users.info).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring reaction: laughing')
      );
    });

    test('ignores reactions on files', async () => {
      const event = {
        user: 'U123456',
        reaction: 'white_check_mark',
        item: {
          type: 'file',
          file_id: 'F123456'
        }
      };

      await reactionsHandler.handleReactionAdded(event);

      expect(mockSlack.users.info).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring reaction on file')
      );
    });

    test('handles errors gracefully', async () => {
      const event = {
        user: 'U123456',
        reaction: 'white_check_mark',
        item: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.000001'
        }
      };

      mockSlack.users.info.mockRejectedValue(new Error('API Error'));

      await reactionsHandler.handleReactionAdded(event);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error approving deployment')
      );
    });
  });

  describe('approveDeployment', () => {
    beforeEach(() => {
      mockSlack.users.info.mockResolvedValue({
        user: {
          real_name: 'John Doe',
          name: 'john.doe'
        }
      });

      mockSlack.conversations.history.mockResolvedValue({
        messages: [{
          text: 'PROD deployment pending - deploy-main-1769563800391\nRepository: moncalaworks-cpu/ClaudeCodeOrchestrator'
        }]
      });

      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });
    });

    test('posts approval message to thread', async () => {
      await reactionsHandler.approveDeployment('C123', '1234567890.000001', 'U456');

      expect(mockSlack.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123',
          thread_ts: '1234567890.000001',
          text: expect.stringContaining('approved')
        })
      );
    });

    test('includes user name in approval reply', async () => {
      await reactionsHandler.approveDeployment('C123', '1234567890.000001', 'U456');

      expect(mockSlack.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('John Doe')
        })
      );
    });

    test('uses fallback username when real_name is unavailable', async () => {
      mockSlack.users.info.mockResolvedValue({
        user: {
          name: 'john.doe'
        }
      });

      await reactionsHandler.approveDeployment('C123', '1234567890.000001', 'U456');

      expect(mockSlack.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('john.doe')
        })
      );
    });

    test('logs deployment ID when approved', async () => {
      await reactionsHandler.approveDeployment('C123', '1234567890.000001', 'U456');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deployment deploy-main-1769563800391 approved')
      );
    });

    test('handles user info API errors', async () => {
      mockSlack.users.info.mockRejectedValue(new Error('User not found'));

      await reactionsHandler.approveDeployment('C123', '1234567890.000001', 'U456');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error approving deployment')
      );
    });

    test('posts error to thread on failure', async () => {
      mockSlack.chat.postMessage.mockRejectedValueOnce(new Error('Slack API error'));

      await reactionsHandler.approveDeployment('C123', '1234567890.000001', 'U456');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error approving deployment')
      );
    });

    test('handles postMessage failures gracefully', async () => {
      mockSlack.chat.postMessage.mockRejectedValue(new Error('API Error'));

      await reactionsHandler.approveDeployment('C123', '1234567890.000001', 'U456');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error approving deployment')
      );
    });

    test('always marks deployment as mrkdwn enabled', async () => {
      await reactionsHandler.approveDeployment('C123', '1234567890.000001', 'U456');

      expect(mockSlack.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          mrkdwn: true
        })
      );
    });
  });

  describe('rejectDeployment', () => {
    beforeEach(() => {
      mockSlack.users.info.mockResolvedValue({
        user: {
          real_name: 'Jane Smith',
          name: 'jane.smith'
        }
      });

      mockSlack.conversations.history.mockResolvedValue({
        messages: [{
          text: 'PROD deployment pending - deploy-main-1769563800391'
        }]
      });

      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });
    });

    test('posts rejection message to thread', async () => {
      await reactionsHandler.rejectDeployment('C123', '1234567890.000001', 'U456');

      expect(mockSlack.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123',
          thread_ts: '1234567890.000001',
          text: expect.stringContaining('rejected')
        })
      );
    });

    test('includes user name in rejection reply', async () => {
      await reactionsHandler.rejectDeployment('C123', '1234567890.000001', 'U456');

      expect(mockSlack.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Jane Smith')
        })
      );
    });

    test('logs deployment ID when rejected', async () => {
      await reactionsHandler.rejectDeployment('C123', '1234567890.000001', 'U456');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deployment deploy-main-1769563800391 rejected')
      );
    });

    test('handles user info API errors', async () => {
      mockSlack.users.info.mockRejectedValue(new Error('User not found'));

      await reactionsHandler.rejectDeployment('C123', '1234567890.000001', 'U456');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error rejecting deployment')
      );
    });

    test('posts error to thread on failure', async () => {
      mockSlack.chat.postMessage.mockRejectedValueOnce(new Error('Slack API error'));

      await reactionsHandler.rejectDeployment('C123', '1234567890.000001', 'U456');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error rejecting deployment')
      );
    });
  });

  describe('replyToThread', () => {
    beforeEach(() => {
      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });
    });

    test('posts message to thread', async () => {
      await reactionsHandler.replyToThread('C123', '1234567890.000001', 'Test status');

      expect(mockSlack.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        thread_ts: '1234567890.000001',
        text: 'Test status',
        mrkdwn: true
      });
    });

    test('handles API errors gracefully', async () => {
      mockSlack.chat.postMessage.mockRejectedValue(new Error('API Error'));

      await reactionsHandler.replyToThread('C123', '1234567890.000001', 'Test');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error replying to thread')
      );
    });

    test('logs success to console', async () => {
      await reactionsHandler.replyToThread('C123', '1234567890.000001', 'Test status message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Posted status to thread')
      );
    });
  });

  describe('Integration Tests', () => {
    test('full approval workflow', async () => {
      mockSlack.users.info.mockResolvedValue({
        user: { real_name: 'John Doe' }
      });
      mockSlack.conversations.history.mockResolvedValue({
        messages: [{ text: 'deploy-main-123' }]
      });
      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });

      const event = {
        user: 'U123456',
        reaction: 'white_check_mark',
        item: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.000001'
        }
      };

      await reactionsHandler.handleReactionAdded(event);

      // Verify the workflow
      expect(mockSlack.users.info).toHaveBeenCalled();
      expect(mockSlack.conversations.history).toHaveBeenCalled();
      expect(mockSlack.chat.postMessage).toHaveBeenCalled();

      // Verify logging
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Slack Reactions]')
      );
    });

    test('full rejection workflow', async () => {
      mockSlack.users.info.mockResolvedValue({
        user: { real_name: 'Jane Smith' }
      });
      mockSlack.conversations.history.mockResolvedValue({
        messages: [{ text: 'deploy-main-123' }]
      });
      mockSlack.chat.postMessage.mockResolvedValue({ ts: '1234567890.000002' });

      const event = {
        user: 'U123456',
        reaction: 'x',
        item: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.000001'
        }
      };

      await reactionsHandler.handleReactionAdded(event);

      // Verify the workflow
      expect(mockSlack.users.info).toHaveBeenCalled();
      expect(mockSlack.conversations.history).toHaveBeenCalled();
      expect(mockSlack.chat.postMessage).toHaveBeenCalled();
    });
  });
});
