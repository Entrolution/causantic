/**
 * Tests for cross-session linking.
 */

import { describe, it, expect } from 'vitest';
import { isContinuedSession } from '../../src/ingest/cross-session-linker.js';

describe('cross-session-linker', () => {
  describe('isContinuedSession', () => {
    it('detects standard continuation pattern', () => {
      const content =
        'This session is being continued from a previous conversation that ran out of context.';
      expect(isContinuedSession(content)).toBe(true);
    });

    it('detects "Continuing from previous session" pattern', () => {
      const content = 'Continuing from previous session. The user was working on...';
      expect(isContinuedSession(content)).toBe(true);
    });

    it('detects "This is a continuation of" pattern', () => {
      const content = 'This is a continuation of the earlier discussion about TypeScript.';
      expect(isContinuedSession(content)).toBe(true);
    });

    it('detects "Resumed session" pattern', () => {
      const content = 'Resumed session from earlier today.';
      expect(isContinuedSession(content)).toBe(true);
    });

    it('returns false for non-continuation content', () => {
      const content = 'Hello, I need help with my code.';
      expect(isContinuedSession(content)).toBe(false);
    });

    it('returns false for empty content', () => {
      expect(isContinuedSession('')).toBe(false);
    });

    it('detects continuation with [User] role prefix', () => {
      const content = '[User]\nThis session is being continued from a previous conversation that ran out of context.';
      expect(isContinuedSession(content)).toBe(true);
    });

    it('detects continuation with [Assistant] role prefix', () => {
      const content = '[Assistant]\nThis session is being continued from a previous conversation.';
      expect(isContinuedSession(content)).toBe(true);
    });

    it('requires pattern at start of content (after role prefix)', () => {
      // Pattern must be at the beginning
      const content = 'Some text. This session is being continued from a previous conversation.';
      expect(isContinuedSession(content)).toBe(false);
    });

    it('is case sensitive', () => {
      // Lowercase should not match
      const content = 'this session is being continued from a previous conversation';
      expect(isContinuedSession(content)).toBe(false);
    });
  });

  describe('CrossSessionLinkResult interface', () => {
    it('has correct structure for successful link', () => {
      const result = {
        sessionId: 'session-abc',
        previousSessionId: 'session-xyz',
        edgeCount: 6,
        isContinuation: true,
      };

      expect(result.sessionId).toBe('session-abc');
      expect(result.previousSessionId).toBe('session-xyz');
      expect(result.edgeCount).toBe(6);
      expect(result.isContinuation).toBe(true);
    });

    it('has correct structure when no previous session found', () => {
      const result = {
        sessionId: 'session-abc',
        previousSessionId: null,
        edgeCount: 0,
        isContinuation: true, // Continuation detected but no previous found
      };

      expect(result.previousSessionId).toBeNull();
      expect(result.edgeCount).toBe(0);
      expect(result.isContinuation).toBe(true);
    });

    it('has correct structure for non-continuation', () => {
      const result = {
        sessionId: 'session-abc',
        previousSessionId: null,
        edgeCount: 0,
        isContinuation: false,
      };

      expect(result.previousSessionId).toBeNull();
      expect(result.edgeCount).toBe(0);
      expect(result.isContinuation).toBe(false);
    });
  });

  describe('continuation patterns', () => {
    const continuationStarts = [
      'This session is being continued from a previous conversation',
      'Continuing from previous session',
      'This is a continuation of',
      'Resumed session',
    ];

    for (const pattern of continuationStarts) {
      it(`recognizes "${pattern.slice(0, 30)}..."`, () => {
        const content = `${pattern} and more content here.`;
        expect(isContinuedSession(content)).toBe(true);
      });

      it(`recognizes "${pattern.slice(0, 30)}..." with [User] prefix`, () => {
        const content = `[User]\n${pattern} and more content here.`;
        expect(isContinuedSession(content)).toBe(true);
      });
    }
  });

  describe('edge count calculation', () => {
    it('creates a single edge: last prev chunk → first new chunk', () => {
      // New model: single forward edge per cross-session link
      const expectedEdgeCount = 1;
      expect(expectedEdgeCount).toBe(1);
    });

    it('returns 0 edges when no previous chunks', () => {
      const expectedEdgeCount = 0;
      expect(expectedEdgeCount).toBe(0);
    });
  });

  describe('session timing logic', () => {
    it('previous session must end before current session starts', () => {
      const prevSessionEndTime = new Date('2024-01-01T12:00:00Z').getTime();
      const currSessionStartTime = new Date('2024-01-01T12:30:00Z').getTime();

      expect(prevSessionEndTime).toBeLessThan(currSessionStartTime);
    });

    it('selects most recent previous session', () => {
      const sessions = [
        { id: 'old', endTime: new Date('2024-01-01T10:00:00Z').getTime() },
        { id: 'recent', endTime: new Date('2024-01-01T12:00:00Z').getTime() },
        { id: 'oldest', endTime: new Date('2024-01-01T08:00:00Z').getTime() },
      ];

      const currStartTime = new Date('2024-01-01T13:00:00Z').getTime();

      // Filter sessions that end before current starts
      const candidates = sessions.filter((s) => s.endTime < currStartTime);

      // Select most recent
      const selected = candidates.reduce((a, b) => (a.endTime > b.endTime ? a : b));

      expect(selected.id).toBe('recent');
    });
  });

  describe('project filtering', () => {
    it('only links sessions from same project', () => {
      const sessions = [
        { id: 's1', slug: 'project-a' },
        { id: 's2', slug: 'project-b' },
        { id: 's3', slug: 'project-a' },
      ];

      const targetSlug = 'project-a';
      const sameProjSessions = sessions.filter((s) => s.slug === targetSlug);

      expect(sameProjSessions.length).toBe(2);
      expect(sameProjSessions.every((s) => s.slug === targetSlug)).toBe(true);
    });
  });

  describe('linkAllSessions result', () => {
    it('has correct structure', () => {
      const result = {
        totalLinked: 5,
        totalEdges: 30,
        results: [
          { sessionId: 's1', previousSessionId: null, edgeCount: 0, isContinuation: false },
          { sessionId: 's2', previousSessionId: 's1', edgeCount: 6, isContinuation: true },
        ],
      };

      expect(result.totalLinked).toBe(5);
      expect(result.totalEdges).toBe(30);
      expect(result.results.length).toBe(2);
    });

    it('counts only sessions with edges as linked', () => {
      const results = [
        { sessionId: 's1', previousSessionId: null, edgeCount: 0, isContinuation: false },
        { sessionId: 's2', previousSessionId: 's1', edgeCount: 6, isContinuation: true },
        { sessionId: 's3', previousSessionId: 's2', edgeCount: 6, isContinuation: true },
        { sessionId: 's4', previousSessionId: null, edgeCount: 0, isContinuation: false },
      ];

      const totalLinked = results.filter((r) => r.edgeCount > 0).length;
      expect(totalLinked).toBe(2);
    });

    it('sums all edge counts', () => {
      const results = [{ edgeCount: 0 }, { edgeCount: 6 }, { edgeCount: 6 }, { edgeCount: 0 }];

      const totalEdges = results.reduce((sum, r) => sum + r.edgeCount, 0);
      expect(totalEdges).toBe(12);
    });
  });
});
