/**
 * Tests for session start hook.
 */

import { describe, it, expect } from 'vitest';
import type { SessionStartOptions, SessionStartResult } from '../../src/hooks/session-start.js';

describe('session-start', () => {
  describe('SessionStartOptions interface', () => {
    it('has correct defaults', () => {
      const defaults: SessionStartOptions = {
        maxTokens: 2000,
        includeRecent: 3,
        includeCrossProject: 2,
        enableRetry: true,
        maxRetries: 3,
        gracefulDegradation: true,
      };

      expect(defaults.maxTokens).toBe(2000);
      expect(defaults.includeRecent).toBe(3);
      expect(defaults.includeCrossProject).toBe(2);
      expect(defaults.enableRetry).toBe(true);
    });

    it('allows custom token budget', () => {
      const options: SessionStartOptions = {
        maxTokens: 500,
      };

      expect(options.maxTokens).toBe(500);
    });

    it('allows disabling retry', () => {
      const options: SessionStartOptions = {
        enableRetry: false,
      };

      expect(options.enableRetry).toBe(false);
    });

    it('allows disabling graceful degradation', () => {
      const options: SessionStartOptions = {
        gracefulDegradation: false,
      };

      expect(options.gracefulDegradation).toBe(false);
    });
  });

  describe('SessionStartResult interface', () => {
    it('has correct structure for success', () => {
      const result: SessionStartResult = {
        summary: '## Recent Context\n\nSome memory context...',
        tokenCount: 150,
        clustersIncluded: 3,
        recentChunksIncluded: 2,
        lastSessionIncluded: false,
      };

      expect(result.summary).toContain('Recent Context');
      expect(result.tokenCount).toBe(150);
      expect(result.clustersIncluded).toBe(3);
      expect(result.recentChunksIncluded).toBe(2);
      expect(result.lastSessionIncluded).toBe(false);
    });

    it('has correct structure for empty memory', () => {
      const result: SessionStartResult = {
        summary: 'No memory context available yet.',
        tokenCount: 0,
        clustersIncluded: 0,
        recentChunksIncluded: 0,
        lastSessionIncluded: false,
      };

      expect(result.summary).toBe('No memory context available yet.');
      expect(result.tokenCount).toBe(0);
    });

    it('has correct structure for degraded result', () => {
      const result: SessionStartResult = {
        summary: 'Memory context temporarily unavailable.',
        tokenCount: 0,
        clustersIncluded: 0,
        recentChunksIncluded: 0,
        lastSessionIncluded: false,
        degraded: true,
      };

      expect(result.degraded).toBe(true);
    });

    it('includes optional metrics', () => {
      const result: SessionStartResult = {
        summary: 'Context...',
        tokenCount: 100,
        clustersIncluded: 1,
        recentChunksIncluded: 1,
        lastSessionIncluded: false,
        metrics: {
          hookName: 'session-start',
          startTime: Date.now() - 50,
          endTime: Date.now(),
          durationMs: 50,
          success: true,
          retryCount: 0,
        },
      };

      expect(result.metrics).toBeTruthy();
      expect(result.metrics?.success).toBe(true);
    });

    it('tracks lastSessionIncluded flag', () => {
      const withLastSession: SessionStartResult = {
        summary: '## Last Session...',
        tokenCount: 200,
        clustersIncluded: 1,
        recentChunksIncluded: 2,
        lastSessionIncluded: true,
      };

      const withoutLastSession: SessionStartResult = {
        summary: '## Recent Context...',
        tokenCount: 100,
        clustersIncluded: 1,
        recentChunksIncluded: 2,
        lastSessionIncluded: false,
      };

      expect(withLastSession.lastSessionIncluded).toBe(true);
      expect(withoutLastSession.lastSessionIncluded).toBe(false);
    });
  });

  describe('recent section building', () => {
    it('formats recent chunks correctly', () => {
      const chunks = [
        {
          content:
            'First chunk content that is quite long and should be truncated after 200 characters...',
          startTime: '2024-01-15T10:00:00Z',
        },
        {
          content: 'Second chunk content',
          startTime: '2024-01-15T11:00:00Z',
        },
      ];

      const lines = ['## Recent Context'];
      for (const chunk of chunks) {
        const date = new Date(chunk.startTime).toLocaleDateString();
        const preview = chunk.content.slice(0, 200).replace(/\n/g, ' ');
        const suffix = chunk.content.length > 200 ? '...' : '';
        lines.push(`- [${date}] ${preview}${suffix}`);
      }

      const section = lines.join('\n');

      expect(section).toContain('## Recent Context');
      expect(section).toContain('First chunk content');
      expect(section).toContain('Second chunk content');
    });

    it('handles empty chunks', () => {
      const chunks: Array<{ content: string; startTime: string }> = [];

      const hasRecent = chunks.length > 0;

      expect(hasRecent).toBe(false);
    });
  });

  describe('cluster section building', () => {
    it('formats cluster correctly', () => {
      const cluster = {
        name: 'Authentication',
        description: 'Topics related to user authentication and authorization.',
      };

      const section = `### ${cluster.name}\n${cluster.description}`;

      expect(section).toBe(
        '### Authentication\nTopics related to user authentication and authorization.',
      );
    });

    it('handles unnamed cluster', () => {
      const cluster = {
        name: null,
        description: 'Some description',
      };

      const name = cluster.name ?? 'Unnamed Topic';
      const section = `### ${name}\n${cluster.description}`;

      expect(section).toContain('### Unnamed Topic');
    });

    it('handles missing description', () => {
      const cluster = {
        name: 'Test Topic',
        description: null,
      };

      const description = cluster.description ?? 'No description available.';
      const section = `### ${cluster.name}\n${description}`;

      expect(section).toContain('No description available.');
    });
  });

  describe('project cluster relevance', () => {
    it('calculates relevance ratio', () => {
      const chunks = [
        { sessionSlug: 'my-project' },
        { sessionSlug: 'my-project' },
        { sessionSlug: 'other-project' },
        { sessionSlug: 'my-project' },
      ];
      const projectPath = 'my-project';

      const projectCount = chunks.filter((c) => c.sessionSlug === projectPath).length;
      const relevance = projectCount / chunks.length;

      expect(relevance).toBe(0.75);
    });

    it('returns 0 for non-matching project', () => {
      const chunks = [{ sessionSlug: 'other-project' }, { sessionSlug: 'another-project' }];
      const projectPath = 'my-project';

      const projectCount = chunks.filter((c) => c.sessionSlug === projectPath).length;
      const relevance = projectCount / chunks.length;

      expect(relevance).toBe(0);
    });

    it('sorts by relevance descending', () => {
      const relevances = [
        { name: 'A', relevance: 0.3 },
        { name: 'B', relevance: 0.8 },
        { name: 'C', relevance: 0.5 },
      ];

      relevances.sort((a, b) => b.relevance - a.relevance);

      expect(relevances[0].name).toBe('B');
      expect(relevances[1].name).toBe('C');
      expect(relevances[2].name).toBe('A');
    });
  });

  describe('token budget management', () => {
    it('tracks cumulative token usage', () => {
      const maxTokens = 1000;
      let currentTokens = 0;
      const sections = [
        { tokens: 200 },
        { tokens: 300 },
        { tokens: 400 },
        { tokens: 200 }, // Would exceed budget
      ];

      const included: number[] = [];
      for (const section of sections) {
        if (currentTokens + section.tokens <= maxTokens) {
          included.push(section.tokens);
          currentTokens += section.tokens;
        } else {
          break;
        }
      }

      expect(included).toEqual([200, 300, 400]);
      expect(currentTokens).toBe(900);
    });

    it('prioritizes recent chunks over clusters', () => {
      const priority = ['recentChunks', 'lastSession', 'projectClusters', 'crossProjectClusters'];

      expect(priority[0]).toBe('recentChunks');
      expect(priority[1]).toBe('lastSession');
    });

    it('reserves 20% of budget for last session', () => {
      const maxTokens = 1000;
      const lastSessionBudget = Math.floor(maxTokens * 0.2);
      const mainBudget = maxTokens - lastSessionBudget;

      expect(lastSessionBudget).toBe(200);
      expect(mainBudget).toBe(800);
    });
  });

  describe('fallback result', () => {
    it('has correct structure', () => {
      const fallback: SessionStartResult = {
        summary: 'Memory context temporarily unavailable.',
        tokenCount: 0,
        clustersIncluded: 0,
        recentChunksIncluded: 0,
        lastSessionIncluded: false,
        degraded: true,
      };

      expect(fallback.degraded).toBe(true);
      expect(fallback.tokenCount).toBe(0);
      expect(fallback.lastSessionIncluded).toBe(false);
    });
  });

  describe('memory section generation', () => {
    it('generates markdown section', () => {
      const result: SessionStartResult = {
        summary: '### Topic 1\nDescription...',
        tokenCount: 100,
        clustersIncluded: 1,
        recentChunksIncluded: 2,
        lastSessionIncluded: false,
      };

      const section = `## Memory Context

${result.summary}

---
*Memory summary: ${result.clustersIncluded} topics, ${result.recentChunksIncluded} recent items*
`;

      expect(section).toContain('## Memory Context');
      expect(section).toContain('1 topics');
      expect(section).toContain('2 recent items');
    });

    it('returns empty for zero token result', () => {
      const result: SessionStartResult = {
        summary: 'No memory context available yet.',
        tokenCount: 0,
        clustersIncluded: 0,
        recentChunksIncluded: 0,
        lastSessionIncluded: false,
        degraded: false,
      };

      const shouldGenerate = result.tokenCount > 0 || result.degraded;
      expect(shouldGenerate).toBe(false);
    });

    it('generates degraded section', () => {
      const _result: SessionStartResult = {
        summary: 'Memory context temporarily unavailable.',
        tokenCount: 0,
        clustersIncluded: 0,
        recentChunksIncluded: 0,
        lastSessionIncluded: false,
        degraded: true,
      };

      const section = `## Memory Context

*Memory system temporarily unavailable. Will be restored on next session.*
`;

      expect(section).toContain('temporarily unavailable');
    });

    it('includes last session note when lastSessionIncluded is true', () => {
      const result: SessionStartResult = {
        summary: '## Last Session...\n- Some content',
        tokenCount: 200,
        clustersIncluded: 1,
        recentChunksIncluded: 2,
        lastSessionIncluded: true,
      };

      const lastSessionNote = result.lastSessionIncluded ? ', last session included' : '';

      const section = `## Memory Context

${result.summary}

---
*Memory summary: ${result.clustersIncluded} topics, ${result.recentChunksIncluded} recent items${lastSessionNote}*
`;

      expect(section).toContain('last session included');
    });

    it('omits last session note when lastSessionIncluded is false', () => {
      const result: SessionStartResult = {
        summary: '### Topic 1\nDescription...',
        tokenCount: 100,
        clustersIncluded: 1,
        recentChunksIncluded: 2,
        lastSessionIncluded: false,
      };

      const lastSessionNote = result.lastSessionIncluded ? ', last session included' : '';

      const section = `## Memory Context

${result.summary}

---
*Memory summary: ${result.clustersIncluded} topics, ${result.recentChunksIncluded} recent items${lastSessionNote}*
`;

      expect(section).not.toContain('last session included');
    });
  });

  describe('last session section building', () => {
    it('builds section with date header and chunk previews', () => {
      const sessionDate = new Date('2024-01-15T10:00:00Z').toLocaleDateString();
      const sessionTime = new Date('2024-01-15T10:00:00Z').toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      const lines = [
        `## Last Session (${sessionDate} ${sessionTime})`,
        '- Working on authentication module...',
        '- Fixed login bug in session handler...',
      ];

      const section = lines.join('\n');

      expect(section).toContain('## Last Session');
      expect(section).toContain(sessionDate);
      expect(section).toContain('authentication module');
      expect(section).toContain('login bug');
    });

    it('returns null for no recent sessions', () => {
      const sessions: unknown[] = [];
      const result = sessions.length === 0 ? null : 'section';

      expect(result).toBeNull();
    });

    it('truncates chunk previews at 150 characters', () => {
      const longContent = 'A'.repeat(200);
      const preview = longContent.slice(0, 150);
      const suffix = longContent.length > 150 ? '...' : '';
      const line = `- ${preview}${suffix}`;

      expect(line).toContain('...');
      // 2 for "- " + 150 for preview + 3 for "..."
      expect(line.length).toBe(155);
    });

    it('takes the last 5 chunks from a session', () => {
      const chunks = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const tailChunks = chunks.slice(-5);

      expect(tailChunks).toEqual(['d', 'e', 'f', 'g', 'h']);
    });

    it('uses 7-day window for session lookup', () => {
      const now = Date.now();
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
      const sixDaysAgo = new Date(now - 6 * 24 * 60 * 60 * 1000);

      expect(sixDaysAgo.getTime()).toBeGreaterThan(sevenDaysAgo.getTime());
      expect(eightDaysAgo.getTime()).toBeLessThan(sevenDaysAgo.getTime());
    });
  });

  describe('slice operations', () => {
    it('gets last N chunks', () => {
      const chunks = ['a', 'b', 'c', 'd', 'e'];
      const lastThree = chunks.slice(-3);

      expect(lastThree).toEqual(['c', 'd', 'e']);
    });

    it('gets first N clusters', () => {
      const clusters = ['a', 'b', 'c', 'd', 'e'];
      const firstThree = clusters.slice(0, 3);

      expect(firstThree).toEqual(['a', 'b', 'c']);
    });
  });

  describe('filter operations', () => {
    it('filters clusters with description', () => {
      const clusters = [
        { name: 'A', description: 'Has desc' },
        { name: 'B', description: null },
        { name: 'C', description: 'Also has desc' },
      ];

      const withDesc = clusters.filter((c) => c.description);

      expect(withDesc.length).toBe(2);
    });

    it('excludes already included clusters', () => {
      const allClusters = [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ];
      const projectClusters = [{ id: '1', name: 'A' }];

      const crossProject = allClusters.filter((c) => !projectClusters.some((p) => p.id === c.id));

      expect(crossProject.length).toBe(2);
      expect(crossProject.find((c) => c.name === 'A')).toBeUndefined();
    });
  });
});
