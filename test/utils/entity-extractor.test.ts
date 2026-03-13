/**
 * Tests for entity extraction from chunk content.
 */

import { describe, it, expect } from 'vitest';
import { extractEntities, type EntityMention } from '../../src/utils/entity-extractor.js';

/** Helper: find mention by normalizedName. */
function findByName(mentions: EntityMention[], name: string): EntityMention | undefined {
  return mentions.find((m) => m.normalizedName === name);
}

describe('entity-extractor', () => {
  describe('extractEntities', () => {
    describe('@mentions', () => {
      it('extracts @mentions as person entities', () => {
        const mentions = extractEntities('[User]\nHey @joel can you review this?');
        const joel = findByName(mentions, 'joel');
        expect(joel).toBeDefined();
        expect(joel!.entityType).toBe('person');
        expect(joel!.mentionForm).toBe('@joel');
        expect(joel!.confidence).toBe(0.95);
      });

      it('extracts multiple @mentions', () => {
        const mentions = extractEntities('[User]\n@alice and @bob are on it');
        expect(findByName(mentions, 'alice')).toBeDefined();
        expect(findByName(mentions, 'bob')).toBeDefined();
      });

      it('normalizes @mentions to lowercase', () => {
        const mentions = extractEntities('[User]\n@JoelSmith said hello');
        expect(findByName(mentions, 'joelsmith')).toBeDefined();
      });
    });

    describe('#channels', () => {
      it('extracts #channels as channel entities', () => {
        const mentions = extractEntities('[User]\nPosted in #general');
        const general = findByName(mentions, 'general');
        expect(general).toBeDefined();
        expect(general!.entityType).toBe('channel');
        expect(general!.mentionForm).toBe('#general');
        expect(general!.confidence).toBe(0.95);
      });

      it('skips hex color codes', () => {
        const mentions = extractEntities('[User]\nColor is #ff0000');
        expect(findByName(mentions, 'ff0000')).toBeUndefined();
      });

      it('extracts channel with hyphens', () => {
        const mentions = extractEntities('[User]\nCheck #dev-ops channel');
        expect(findByName(mentions, 'dev-ops')).toBeDefined();
      });
    });

    describe('email addresses', () => {
      it('extracts emails as person entities', () => {
        const mentions = extractEntities('[User]\nSend to alice@example.com');
        const alice = findByName(mentions, 'alice@example.com');
        expect(alice).toBeDefined();
        expect(alice!.entityType).toBe('person');
        expect(alice!.confidence).toBe(0.9);
      });
    });

    describe('URLs', () => {
      it('extracts URLs as url entities', () => {
        const mentions = extractEntities('[User]\nSee https://github.com/org/repo');
        const url = findByName(mentions, 'https://github.com/org/repo');
        expect(url).toBeDefined();
        expect(url!.entityType).toBe('url');
        expect(url!.confidence).toBe(1.0);
      });

      it('extracts http URLs', () => {
        const mentions = extractEntities('[User]\nCheck http://localhost:3000');
        expect(mentions.some((m) => m.entityType === 'url')).toBe(true);
      });
    });

    describe('contextual name patterns', () => {
      it('extracts "X said" pattern as person', () => {
        const mentions = extractEntities('[User]\nJoel said we should refactor');
        const joel = findByName(mentions, 'joel');
        expect(joel).toBeDefined();
        expect(joel!.entityType).toBe('person');
        expect(joel!.confidence).toBe(0.6);
      });

      it('extracts "with X" pattern as person', () => {
        const mentions = extractEntities('[User]\nMeeting with Sarah tomorrow');
        const sarah = findByName(mentions, 'sarah');
        expect(sarah).toBeDefined();
        expect(sarah!.entityType).toBe('person');
        expect(sarah!.confidence).toBe(0.6);
      });

      it('extracts "from X" pattern as person', () => {
        const mentions = extractEntities('[User]\nGot feedback from Marcus');
        const marcus = findByName(mentions, 'marcus');
        expect(marcus).toBeDefined();
      });

      it('extracts multi-word names', () => {
        const mentions = extractEntities('[User]\nJoel Smith said hello');
        const joel = findByName(mentions, 'joel smith');
        expect(joel).toBeDefined();
        expect(joel!.mentionForm).toBe('Joel Smith');
      });

      it('skips pronouns in name patterns', () => {
        const mentions = extractEntities('[User]\nHe said it was fine');
        expect(mentions.filter((m) => m.entityType === 'person')).toHaveLength(0);
      });

      it('skips blocklisted words', () => {
        const mentions = extractEntities('[User]\nHowever said the docs, this is wrong');
        expect(findByName(mentions, 'however')).toBeUndefined();
      });
    });

    describe('meeting keywords', () => {
      it('extracts standup', () => {
        const mentions = extractEntities('[User]\nIn the standup we discussed...');
        const standup = findByName(mentions, 'standup');
        expect(standup).toBeDefined();
        expect(standup!.entityType).toBe('meeting');
        expect(standup!.confidence).toBe(0.7);
      });

      it('extracts retro', () => {
        const mentions = extractEntities('[User]\nDuring the retro...');
        expect(findByName(mentions, 'retro')).toBeDefined();
      });

      it('extracts 1:1', () => {
        const mentions = extractEntities('[User]\nIn our 1:1 we agreed...');
        expect(findByName(mentions, '1:1')).toBeDefined();
      });

      it('extracts sprint review', () => {
        const mentions = extractEntities('[User]\nAt the sprint review...');
        expect(findByName(mentions, 'sprint-review')).toBeDefined();
      });
    });

    describe('code block skipping', () => {
      it('skips entities inside code blocks', () => {
        const mentions = extractEntities(
          '[User]\n```\n@joel said hello\n#general\n```\nReal content here',
        );
        expect(findByName(mentions, 'joel')).toBeUndefined();
        expect(findByName(mentions, 'general')).toBeUndefined();
      });

      it('preserves entities outside code blocks', () => {
        const mentions = extractEntities('[User]\n@alice\n```\n@bob\n```\n@carol');
        expect(findByName(mentions, 'alice')).toBeDefined();
        expect(findByName(mentions, 'bob')).toBeUndefined();
        expect(findByName(mentions, 'carol')).toBeDefined();
      });
    });

    describe('[Thinking] block skipping', () => {
      it('skips entities in [Thinking] blocks', () => {
        const mentions = extractEntities(
          '[Thinking]\nMaybe @joel is relevant\n[User]\n@alice said hi',
        );
        expect(findByName(mentions, 'joel')).toBeUndefined();
        expect(findByName(mentions, 'alice')).toBeDefined();
      });

      it('extracts from [Assistant] blocks', () => {
        const mentions = extractEntities('[Assistant]\n@bob confirmed the fix');
        expect(findByName(mentions, 'bob')).toBeDefined();
      });
    });

    describe('deduplication', () => {
      it('deduplicates same entity mentioned multiple times', () => {
        const mentions = extractEntities('[User]\n@joel @joel @joel');
        const joels = mentions.filter((m) => m.normalizedName === 'joel');
        expect(joels).toHaveLength(1);
      });

      it('keeps different entity types with same name', () => {
        const mentions = extractEntities('[User]\n@alice posted in #alice');
        const alices = mentions.filter((m) => m.normalizedName === 'alice');
        expect(alices).toHaveLength(2);
        expect(alices.map((a) => a.entityType).sort()).toEqual(['channel', 'person']);
      });
    });

    describe('edge cases', () => {
      it('returns empty for empty text', () => {
        expect(extractEntities('')).toEqual([]);
      });

      it('returns empty for text with no entities', () => {
        expect(extractEntities('[User]\nJust some regular text')).toEqual([]);
      });

      it('handles text without block markers', () => {
        const mentions = extractEntities('@joel said hello');
        expect(findByName(mentions, 'joel')).toBeDefined();
      });
    });
  });
});
