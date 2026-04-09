import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeRuntimeConfig } from '@atlassian-dc-mcp/common';
import { JiraService } from '../jira-service.js';
import { IssueService, SearchService } from '../jira-client/index.js';

jest.mock('../jira-client/index.js', () => ({
  IssueService: {
    getTransitions: jest.fn(),
    doTransition: jest.fn(),
    getIssue: jest.fn(),
    editIssue: jest.fn(),
    createIssue: jest.fn(),
    getComments: jest.fn(),
    addComment: jest.fn(),
  },
  SearchService: {
    searchUsingSearchRequest: jest.fn(),
  },
  OpenAPI: {
    BASE: '',
    TOKEN: '',
    VERSION: '',
  },
}));

describe('JiraService', () => {
  let jiraService: JiraService;
  const mockIssueKey = 'PROJ-123';

  beforeEach(() => {
    jiraService = new JiraService('test-host', 'test-token');
    jest.clearAllMocks();
  });

  describe('getTransitions', () => {
    it('should successfully get available transitions for an issue', async () => {
      const mockTransitionsData = {
        transitions: [
          {
            id: '21',
            name: 'Start Progress',
            to: {
              id: '3',
              name: 'In Progress',
              statusCategory: { name: 'In Progress' },
            },
          },
          {
            id: '31',
            name: 'Done',
            to: {
              id: '4',
              name: 'Done',
              statusCategory: { name: 'Done' },
            },
          },
        ],
      };
      (IssueService.getTransitions as jest.Mock).mockResolvedValue(mockTransitionsData);

      const result = await jiraService.getTransitions(mockIssueKey);

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockTransitionsData);
      expect(IssueService.getTransitions).toHaveBeenCalledWith(mockIssueKey);
    });

    it('should return empty transitions array when no transitions available', async () => {
      const mockTransitionsData = {
        transitions: [],
      };
      (IssueService.getTransitions as jest.Mock).mockResolvedValue(mockTransitionsData);

      const result = await jiraService.getTransitions(mockIssueKey);

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockTransitionsData);
      expect(result.data?.transitions).toHaveLength(0);
    });

    it('should handle API errors gracefully', async () => {
      const mockError = new Error('Issue not found');
      (IssueService.getTransitions as jest.Mock).mockRejectedValue(mockError);

      const result = await jiraService.getTransitions(mockIssueKey);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Issue not found');
    });

    it('should handle permission errors', async () => {
      const mockError = new Error('Insufficient permissions to view transitions');
      (IssueService.getTransitions as jest.Mock).mockRejectedValue(mockError);

      const result = await jiraService.getTransitions('RESTRICTED-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient permissions to view transitions');
    });
  });

  describe('token optimization paths', () => {
    it('uses the default field profile and page size for search', async () => {
      const mockSearchResults = { issues: [] };
      (SearchService.searchUsingSearchRequest as jest.Mock).mockResolvedValue(mockSearchResults);

      const result = await jiraService.searchIssues('project = TEST');

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockSearchResults);
      expect(SearchService.searchUsingSearchRequest).toHaveBeenCalledWith({
        jql: 'project = TEST',
        maxResults: 25,
        fields: ['summary', 'description', 'status', 'assignee', 'reporter', 'priority', 'issuetype', 'labels', 'updated'],
        expand: undefined,
        startAt: undefined,
      });
    });

    it('honors explicit search fields and maxResults', async () => {
      const mockSearchResults = { issues: [] };
      (SearchService.searchUsingSearchRequest as jest.Mock).mockResolvedValue(mockSearchResults);

      await jiraService.searchIssues('project = TEST', 20, ['changelog'], 5, ['summary', 'status']);

      expect(SearchService.searchUsingSearchRequest).toHaveBeenCalledWith({
        jql: 'project = TEST',
        maxResults: 5,
        fields: ['summary', 'status'],
        expand: ['changelog'],
        startAt: 20,
      });
    });

    it('uses the richer default field profile for single issue reads', async () => {
      const mockIssue = { key: mockIssueKey };
      (IssueService.getIssue as jest.Mock).mockResolvedValue(mockIssue);

      const result = await jiraService.getIssue(mockIssueKey);

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockIssue);
      expect(IssueService.getIssue).toHaveBeenCalledWith(mockIssueKey, undefined, [
        'summary',
        'description',
        'status',
        'assignee',
        'reporter',
        'priority',
        'issuetype',
        'labels',
        'updated',
        'parent',
        'subtasks',
      ]);
    });

    it('honors explicit issue fields', async () => {
      (IssueService.getIssue as jest.Mock).mockResolvedValue({ key: mockIssueKey });

      await jiraService.getIssue(mockIssueKey, 'renderedFields', ['summary', 'status']);

      expect(IssueService.getIssue).toHaveBeenCalledWith(mockIssueKey, 'renderedFields', ['summary', 'status']);
    });

    it('uses the package default page size for issue comments', async () => {
      const mockComments = { comments: [] };
      (IssueService.getComments as jest.Mock).mockResolvedValue(mockComments);

      const result = await jiraService.getIssueComments(mockIssueKey);

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockComments);
      expect(IssueService.getComments).toHaveBeenCalledWith(mockIssueKey, undefined, '25', undefined, undefined);
    });

    it('forwards explicit issue comment pagination', async () => {
      (IssueService.getComments as jest.Mock).mockResolvedValue({ comments: [] });

      await jiraService.getIssueComments(mockIssueKey, 'renderedBody', 10, 20);

      expect(IssueService.getComments).toHaveBeenCalledWith(mockIssueKey, 'renderedBody', '10', undefined, '20');
    });
  });

  describe('transitionIssue', () => {
    it('should successfully transition an issue to a new status', async () => {
      (IssueService.doTransition as jest.Mock).mockResolvedValue(undefined);

      const result = await jiraService.transitionIssue({
        issueKey: mockIssueKey,
        transitionId: '21',
      });

      expect(result.success).toBe(true);
      expect(IssueService.doTransition).toHaveBeenCalledWith(mockIssueKey, {
        transition: { id: '21' },
      });
    });

    it('should successfully transition with additional fields', async () => {
      (IssueService.doTransition as jest.Mock).mockResolvedValue(undefined);

      const result = await jiraService.transitionIssue({
        issueKey: mockIssueKey,
        transitionId: '31',
        fields: {
          resolution: { name: 'Done' },
          comment: { body: 'Closing this issue' },
        },
      });

      expect(result.success).toBe(true);
      expect(IssueService.doTransition).toHaveBeenCalledWith(mockIssueKey, {
        transition: { id: '31' },
        fields: {
          resolution: { name: 'Done' },
          comment: { body: 'Closing this issue' },
        },
      });
    });

    it('should handle invalid transition ID errors', async () => {
      const mockError = new Error('Invalid transition ID');
      (IssueService.doTransition as jest.Mock).mockRejectedValue(mockError);

      const result = await jiraService.transitionIssue({
        issueKey: mockIssueKey,
        transitionId: '999',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid transition ID');
    });

    it('should handle missing required fields errors', async () => {
      const mockError = new Error('Resolution field is required');
      (IssueService.doTransition as jest.Mock).mockRejectedValue(mockError);

      const result = await jiraService.transitionIssue({
        issueKey: mockIssueKey,
        transitionId: '31',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Resolution field is required');
    });

    it('should handle permission errors', async () => {
      const mockError = new Error('User does not have permission to transition this issue');
      (IssueService.doTransition as jest.Mock).mockRejectedValue(mockError);

      const result = await jiraService.transitionIssue({
        issueKey: 'RESTRICTED-1',
        transitionId: '21',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('User does not have permission to transition this issue');
    });

    it('should handle issue not found errors', async () => {
      const mockError = new Error('Issue does not exist');
      (IssueService.doTransition as jest.Mock).mockRejectedValue(mockError);

      const result = await jiraService.transitionIssue({
        issueKey: 'NONEXISTENT-999',
        transitionId: '21',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Issue does not exist');
    });
  });

  describe('project exclusions', () => {
    const makeService = (excluded: string[]) =>
      new JiraService('test-host', 'test-token', undefined, () => 25, () => excluded);

    describe('searchIssues — JQL injection', () => {
      it('injects NOT IN clause for single excluded project', async () => {
        (SearchService.searchUsingSearchRequest as jest.Mock).mockResolvedValue({ issues: [] });
        await makeService(['EXCL']).searchIssues('project = TEST');
        expect(SearchService.searchUsingSearchRequest).toHaveBeenCalledWith(
          expect.objectContaining({ jql: '(project = TEST) AND project NOT IN ("EXCL")' })
        );
      });

      it('injects NOT IN clause for multiple excluded projects', async () => {
        (SearchService.searchUsingSearchRequest as jest.Mock).mockResolvedValue({ issues: [] });
        await makeService(['EXCL', 'PRIVATE', 'LEGACY']).searchIssues('project = TEST');
        expect(SearchService.searchUsingSearchRequest).toHaveBeenCalledWith(
          expect.objectContaining({ jql: '(project = TEST) AND project NOT IN ("EXCL", "PRIVATE", "LEGACY")' })
        );
      });

      it('preserves ORDER BY at the end of the modified JQL', async () => {
        (SearchService.searchUsingSearchRequest as jest.Mock).mockResolvedValue({ issues: [] });
        await makeService(['EXCL']).searchIssues('project = TEST ORDER BY created DESC');
        expect(SearchService.searchUsingSearchRequest).toHaveBeenCalledWith(
          expect.objectContaining({ jql: '(project = TEST) AND project NOT IN ("EXCL") ORDER BY created DESC' })
        );
      });

      it('passes JQL unchanged when no projects are excluded', async () => {
        (SearchService.searchUsingSearchRequest as jest.Mock).mockResolvedValue({ issues: [] });
        await jiraService.searchIssues('project = TEST ORDER BY created DESC');
        expect(SearchService.searchUsingSearchRequest).toHaveBeenCalledWith(
          expect.objectContaining({ jql: 'project = TEST ORDER BY created DESC' })
        );
      });

      it('calls the API and returns data for a non-excluded search', async () => {
        const mockData = { issues: [{ key: 'OK-1' }] };
        (SearchService.searchUsingSearchRequest as jest.Mock).mockResolvedValue(mockData);
        const result = await makeService(['EXCL']).searchIssues('project = OK');
        expect(result.success).toBe(true);
        expect(result.data).toBe(mockData);
        expect(SearchService.searchUsingSearchRequest).toHaveBeenCalledTimes(1);
      });
    });

    describe('getIssue', () => {
      it('blocks request and does not call API when project is excluded', async () => {
        const result = await makeService(['EXCL']).getIssue('EXCL-123');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/EXCL/);
        expect(IssueService.getIssue).not.toHaveBeenCalled();
      });

      it('calls API with correct args and returns data when project is allowed', async () => {
        const mockIssue = { key: 'OK-1' };
        (IssueService.getIssue as jest.Mock).mockResolvedValue(mockIssue);
        const result = await makeService(['EXCL']).getIssue('OK-1', 'renderedFields', ['summary']);
        expect(result.success).toBe(true);
        expect(result.data).toBe(mockIssue);
        expect(IssueService.getIssue).toHaveBeenCalledWith('OK-1', 'renderedFields', ['summary']);
      });
    });

    describe('getIssueComments', () => {
      it('blocks request and does not call API when project is excluded', async () => {
        const result = await makeService(['EXCL']).getIssueComments('EXCL-1');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/EXCL/);
        expect(IssueService.getComments).not.toHaveBeenCalled();
      });

      it('calls API and returns data when project is allowed', async () => {
        const mockData = { comments: [] };
        (IssueService.getComments as jest.Mock).mockResolvedValue(mockData);
        const result = await makeService(['EXCL']).getIssueComments('OK-1');
        expect(result.success).toBe(true);
        expect(IssueService.getComments).toHaveBeenCalledWith('OK-1', undefined, '25', undefined, undefined);
      });
    });

    describe('postIssueComment', () => {
      it('blocks request and does not call API when project is excluded', async () => {
        const result = await makeService(['EXCL']).postIssueComment('EXCL-1', 'hello');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/EXCL/);
        expect(IssueService.addComment).not.toHaveBeenCalled();
      });

      it('calls API and returns data when project is allowed', async () => {
        (IssueService.addComment as jest.Mock).mockResolvedValue({ id: '1' });
        const result = await makeService(['EXCL']).postIssueComment('OK-1', 'hello');
        expect(result.success).toBe(true);
        expect(IssueService.addComment).toHaveBeenCalledWith('OK-1', undefined, { body: 'hello' });
      });
    });

    describe('createIssue', () => {
      it('blocks request and does not call API when projectId is excluded', async () => {
        const result = await makeService(['EXCL']).createIssue({ projectId: 'EXCL', summary: 'x', description: 'x', issueTypeId: '1' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/EXCL/);
        expect(IssueService.createIssue).not.toHaveBeenCalled();
      });

      it('calls API when projectId is allowed', async () => {
        (IssueService.createIssue as jest.Mock).mockResolvedValue({ key: 'OK-2' });
        const result = await makeService(['EXCL']).createIssue({ projectId: 'OK', summary: 's', description: 'd', issueTypeId: '1' });
        expect(result.success).toBe(true);
        expect(IssueService.createIssue).toHaveBeenCalledWith(true, {
          fields: { project: { key: 'OK' }, summary: 's', description: 'd', issuetype: { id: '1' } },
        });
      });

      it('strips project from customFields to prevent exclusion bypass', async () => {
        (IssueService.createIssue as jest.Mock).mockResolvedValue({ key: 'OK-2' });
        await makeService(['EXCL']).createIssue({
          projectId: 'OK', summary: 's', description: 'd', issueTypeId: '1',
          customFields: { project: { key: 'EXCL' }, labels: ['bug'] },
        });
        expect(IssueService.createIssue).toHaveBeenCalledWith(true, {
          fields: { project: { key: 'OK' }, summary: 's', description: 'd', issuetype: { id: '1' }, labels: ['bug'] },
        });
      });
    });

    describe('updateIssue', () => {
      it('blocks request and does not call API when project is excluded', async () => {
        const result = await makeService(['EXCL']).updateIssue({ issueKey: 'EXCL-1', summary: 'x' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/EXCL/);
        expect(IssueService.editIssue).not.toHaveBeenCalled();
      });

      it('calls API when project is allowed', async () => {
        (IssueService.editIssue as jest.Mock).mockResolvedValue(undefined);
        const result = await makeService(['EXCL']).updateIssue({ issueKey: 'OK-1', summary: 'new' });
        expect(result.success).toBe(true);
        expect(IssueService.editIssue).toHaveBeenCalledWith('OK-1', 'true', { fields: { summary: 'new' } });
      });

      it('strips project from customFields to prevent exclusion bypass', async () => {
        (IssueService.editIssue as jest.Mock).mockResolvedValue(undefined);
        await makeService(['EXCL']).updateIssue({
          issueKey: 'OK-1', summary: 'new',
          customFields: { project: { key: 'EXCL' }, labels: ['urgent'] },
        });
        expect(IssueService.editIssue).toHaveBeenCalledWith('OK-1', 'true', {
          fields: { summary: 'new', labels: ['urgent'] },
        });
      });
    });

    describe('getTransitions', () => {
      it('blocks request and does not call API when project is excluded', async () => {
        const result = await makeService(['EXCL']).getTransitions('EXCL-1');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/EXCL/);
        expect(IssueService.getTransitions).not.toHaveBeenCalled();
      });

      it('calls API and returns transitions when project is allowed', async () => {
        const mockData = { transitions: [{ id: '1', name: 'To Do' }] };
        (IssueService.getTransitions as jest.Mock).mockResolvedValue(mockData);
        const result = await makeService(['EXCL']).getTransitions('OK-1');
        expect(result.success).toBe(true);
        expect(result.data).toBe(mockData);
        expect(IssueService.getTransitions).toHaveBeenCalledWith('OK-1');
      });
    });

    describe('transitionIssue', () => {
      it('blocks request and does not call API when project is excluded', async () => {
        const result = await makeService(['EXCL']).transitionIssue({ issueKey: 'EXCL-1', transitionId: '21' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/EXCL/);
        expect(IssueService.doTransition).not.toHaveBeenCalled();
      });

      it('calls API when project is allowed', async () => {
        (IssueService.doTransition as jest.Mock).mockResolvedValue(undefined);
        const result = await makeService(['EXCL']).transitionIssue({ issueKey: 'OK-1', transitionId: '21' });
        expect(result.success).toBe(true);
        expect(IssueService.doTransition).toHaveBeenCalledWith('OK-1', { transition: { id: '21' } });
      });
    });

    describe('edge cases', () => {
      it('is case-insensitive: lowercase exclusion blocks uppercase issue key', async () => {
        const result = await makeService(['excl']).getIssue('EXCL-123');
        expect(result.success).toBe(false);
        expect(IssueService.getIssue).not.toHaveBeenCalled();
      });

      it('is case-insensitive: uppercase exclusion blocks lowercase issue key', async () => {
        const result = await makeService(['EXCL']).getIssue('excl-1');
        expect(result.success).toBe(false);
        expect(IssueService.getIssue).not.toHaveBeenCalled();
      });

      it('does not block when exclusion list is empty', async () => {
        (IssueService.getIssue as jest.Mock).mockResolvedValue({ key: 'EXCL-1' });
        const result = await makeService([]).getIssue('EXCL-1');
        expect(result.success).toBe(true);
        expect(IssueService.getIssue).toHaveBeenCalled();
      });

      it('error message identifies the blocked project key', async () => {
        const result = await makeService(['BLOCKED']).getIssue('BLOCKED-42');
        expect(result.error).toContain('BLOCKED');
        expect(result.error).toContain('excluded');
      });
    });
  });

  describe('validateConfig', () => {
    const originalEnv = process.env;
    let tempDir: string;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.ATLASSIAN_DC_MCP_CONFIG_FILE;
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-validate-config-'));
      initializeRuntimeConfig({ cwd: tempDir });
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should return empty array when all required env vars are present', () => {
      process.env.JIRA_API_TOKEN = 'test-token';
      process.env.JIRA_HOST = 'test-host';

      const missingVars = JiraService.validateConfig();
      expect(missingVars).toEqual([]);
    });

    it('should return missing vars when JIRA_API_TOKEN is missing', () => {
      delete process.env.JIRA_API_TOKEN;
      process.env.JIRA_HOST = 'test-host';

      const missingVars = JiraService.validateConfig();
      expect(missingVars).toContain('JIRA_API_TOKEN');
    });

    it('should return missing vars when both host options are missing', () => {
      process.env.JIRA_API_TOKEN = 'test-token';
      delete process.env.JIRA_HOST;
      delete process.env.JIRA_API_BASE_PATH;

      const missingVars = JiraService.validateConfig();
      expect(missingVars).toContain('JIRA_HOST or JIRA_API_BASE_PATH');
    });

    it('should accept JIRA_API_BASE_PATH as alternative to JIRA_HOST', () => {
      process.env.JIRA_API_TOKEN = 'test-token';
      delete process.env.JIRA_HOST;
      process.env.JIRA_API_BASE_PATH = 'https://test-host/rest';

      const missingVars = JiraService.validateConfig();
      expect(missingVars).toEqual([]);
    });

    it('should accept required config from the shared config file', () => {
      const sharedConfigPath = path.join(tempDir, 'shared.env');
      fs.writeFileSync(sharedConfigPath, 'JIRA_HOST=file-host\nJIRA_API_TOKEN=file-token\n');
      process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;

      const missingVars = JiraService.validateConfig();
      expect(missingVars).toEqual([]);
    });
  });
});
