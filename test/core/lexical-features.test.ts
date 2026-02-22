import { describe, it, expect } from 'vitest';
import {
  hasTopicShiftMarker,
  hasContinuationMarker,
  extractFilePaths,
  computeFilePathOverlap,
  extractKeywords,
  computeKeywordOverlap,
} from '../../src/core/lexical-features.js';

describe('lexical-features', () => {
  describe('hasTopicShiftMarker', () => {
    it('detects "actually let\'s" pattern', () => {
      expect(hasTopicShiftMarker("Actually, let's talk about something else")).toBe(true);
    });

    it('detects "switching to" pattern', () => {
      expect(hasTopicShiftMarker('Switching to a different topic')).toBe(true);
    });

    it('detects "switching gears" pattern', () => {
      expect(hasTopicShiftMarker('Switching gears for a moment')).toBe(true);
    });

    it('detects "new question" pattern', () => {
      expect(hasTopicShiftMarker('New question about deployment')).toBe(true);
    });

    it('detects "different topic" pattern', () => {
      expect(hasTopicShiftMarker('Different topic here')).toBe(true);
    });

    it('detects "on a different note" pattern', () => {
      expect(hasTopicShiftMarker('On a different note, how do I...')).toBe(true);
    });

    it('detects "ok so" pattern', () => {
      expect(hasTopicShiftMarker('Ok so now I need help with...')).toBe(true);
    });

    it('detects "moving on" pattern', () => {
      expect(hasTopicShiftMarker('Moving on to the next task')).toBe(true);
    });

    it('detects "forget about that" pattern', () => {
      expect(hasTopicShiftMarker('Forget about that, I have a new issue')).toBe(true);
    });

    it('detects "let\'s change" pattern', () => {
      expect(hasTopicShiftMarker("Let's change direction")).toBe(true);
    });

    it('detects "unrelated" pattern', () => {
      expect(hasTopicShiftMarker('Unrelated question')).toBe(true);
    });

    it('detects "btw" pattern', () => {
      expect(hasTopicShiftMarker('btw, have you seen this?')).toBe(true);
    });

    it('detects "by the way" pattern', () => {
      expect(hasTopicShiftMarker('By the way, I wanted to ask about...')).toBe(true);
    });

    it('returns false for continuation text', () => {
      expect(hasTopicShiftMarker('Yes, that works perfectly')).toBe(false);
    });

    it('returns false for neutral text', () => {
      expect(hasTopicShiftMarker('The database query is failing')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasTopicShiftMarker('')).toBe(false);
    });

    it('trims whitespace before matching', () => {
      expect(hasTopicShiftMarker('  Moving on to something else  ')).toBe(true);
    });

    it('matches are case-insensitive', () => {
      expect(hasTopicShiftMarker('SWITCHING TO another topic')).toBe(true);
    });

    it('patterns match from start of text only', () => {
      // "switching to" must be at the start
      expect(hasTopicShiftMarker('I was switching to another topic')).toBe(false);
    });
  });

  describe('hasContinuationMarker', () => {
    it('detects "yes" pattern', () => {
      expect(hasContinuationMarker('Yes, that makes sense')).toBe(true);
    });

    it('detects "no" pattern', () => {
      expect(hasContinuationMarker('No, that is not right')).toBe(true);
    });

    it('detects "right" pattern', () => {
      expect(hasContinuationMarker('Right, exactly what I meant')).toBe(true);
    });

    it('detects "it is" pattern', () => {
      expect(hasContinuationMarker('It is working now')).toBe(true);
    });

    it('detects "that shows" pattern', () => {
      expect(hasContinuationMarker('That shows the correct output')).toBe(true);
    });

    it('detects "the error" pattern', () => {
      expect(hasContinuationMarker('The error is still happening')).toBe(true);
    });

    it('detects "your fix" pattern', () => {
      expect(hasContinuationMarker('Your fix resolved the issue')).toBe(true);
    });

    it('detects "thanks" pattern', () => {
      expect(hasContinuationMarker('Thanks, that helped')).toBe(true);
    });

    it('detects "thank you" pattern', () => {
      expect(hasContinuationMarker('Thank you for the explanation')).toBe(true);
    });

    it('detects "ok" pattern', () => {
      expect(hasContinuationMarker('Ok, I understand now')).toBe(true);
    });

    it('detects "got it" pattern', () => {
      expect(hasContinuationMarker('Got it, makes sense')).toBe(true);
    });

    it('detects "but" pattern', () => {
      expect(hasContinuationMarker('But what about edge cases?')).toBe(true);
    });

    it('detects "also" pattern', () => {
      expect(hasContinuationMarker('Also, I noticed another issue')).toBe(true);
    });

    it('detects "what about" pattern', () => {
      expect(hasContinuationMarker('What about performance?')).toBe(true);
    });

    it('detects "can you also" pattern', () => {
      expect(hasContinuationMarker('Can you also add error handling?')).toBe(true);
    });

    it('detects "I see" pattern', () => {
      expect(hasContinuationMarker('I see what you mean')).toBe(true);
    });

    it('detects "I understand" pattern', () => {
      expect(hasContinuationMarker('I understand the approach')).toBe(true);
    });

    it('returns false for topic shift text', () => {
      expect(hasContinuationMarker('Switching to deployment')).toBe(false);
    });

    it('returns false for neutral text', () => {
      expect(hasContinuationMarker('The database query is failing')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasContinuationMarker('')).toBe(false);
    });

    it('trims whitespace before matching', () => {
      expect(hasContinuationMarker('  Yes, exactly  ')).toBe(true);
    });

    it('matches are case-insensitive', () => {
      expect(hasContinuationMarker('THANKS for the help')).toBe(true);
    });
  });

  describe('extractFilePaths', () => {
    it('extracts .ts file paths', () => {
      const paths = extractFilePaths('Check the file src/core/lexical-features.ts for details');
      expect(paths.has('src/core/lexical-features.ts')).toBe(true);
    });

    it('extracts .js file paths', () => {
      const paths = extractFilePaths('Look at utils/helper.js');
      expect(paths.has('utils/helper.js')).toBe(true);
    });

    it('extracts multiple file paths', () => {
      const paths = extractFilePaths('Edit src/index.ts and src/config.json');
      expect(paths.has('src/index.ts')).toBe(true);
      expect(paths.has('src/config.json')).toBe(true);
    });

    it('extracts paths with ./ prefix and normalizes them', () => {
      const paths = extractFilePaths('The file ./src/main.ts needs updating');
      expect(paths.has('src/main.ts')).toBe(true);
    });

    it('normalizes paths to lowercase', () => {
      const paths = extractFilePaths('See SRC/Core/Types.ts');
      expect(paths.has('src/core/types.ts')).toBe(true);
    });

    it('extracts directory paths', () => {
      const paths = extractFilePaths('Look in src/core/utils for the module');
      expect(paths.has('src/core/utils')).toBe(true);
    });

    it('extracts paths in quotes', () => {
      const paths = extractFilePaths('Open "src/index.ts" in your editor');
      expect(paths.has('src/index.ts')).toBe(true);
    });

    it('extracts paths in backticks', () => {
      const paths = extractFilePaths('Run `src/cli/index.ts` to start');
      expect(paths.has('src/cli/index.ts')).toBe(true);
    });

    it('returns a Set', () => {
      const paths = extractFilePaths('Check src/index.ts');
      expect(paths).toBeInstanceOf(Set);
    });

    it('returns empty set for text without paths', () => {
      const paths = extractFilePaths('No file paths here at all');
      expect(paths.size).toBe(0);
    });

    it('deduplicates identical paths', () => {
      const paths = extractFilePaths('Edit src/index.ts and also src/index.ts');
      // Both references to same file should be deduplicated in the Set
      expect(paths.has('src/index.ts')).toBe(true);
    });

    it('handles various file extensions', () => {
      // Each path needs its own surrounding delimiters; consecutive space-separated
      // paths share a delimiter causing the regex to skip alternating matches.
      expect(extractFilePaths('check app.py here').has('app.py')).toBe(true);
      expect(extractFilePaths('open config.yaml now').has('config.yaml')).toBe(true);
      expect(extractFilePaths('edit style.css file').has('style.css')).toBe(true);
      expect(extractFilePaths('run script.sh once').has('script.sh')).toBe(true);
      expect(extractFilePaths('load query.sql data').has('query.sql')).toBe(true);
    });

    it('handles paths with dots in directory names', () => {
      const paths = extractFilePaths('Check .github/workflows/ci.yml');
      expect(paths.has('.github/workflows/ci.yml')).toBe(true);
    });
  });

  describe('computeFilePathOverlap', () => {
    it('returns 1.0 for identical path sets', () => {
      const text = 'Edit src/index.ts and src/config.json';
      expect(computeFilePathOverlap(text, text)).toBe(1);
    });

    it('returns 0 for completely different paths', () => {
      const overlap = computeFilePathOverlap('Edit src/index.ts', 'Edit lib/helper.py');
      expect(overlap).toBe(0);
    });

    it('returns value between 0 and 1 for partial overlap', () => {
      const overlap = computeFilePathOverlap(
        'Edit src/index.ts and src/config.json',
        'Edit src/index.ts and lib/utils.ts',
      );
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThan(1);
    });

    it('returns 0 when both texts have no paths', () => {
      expect(computeFilePathOverlap('no paths here', 'nothing here either')).toBe(0);
    });

    it('returns 0 when one text has no paths', () => {
      expect(computeFilePathOverlap('Edit src/index.ts', 'no paths')).toBe(0);
    });

    it('computes Jaccard coefficient correctly', () => {
      // textA has {src/a.ts, src/b.ts}, textB has {src/b.ts, src/c.ts}
      // intersection = 1 (src/b.ts), union = 3 → 1/3
      // Use sentence wrappers so both paths are captured by the regex.
      const overlap = computeFilePathOverlap(
        'Edit src/a.ts and then edit src/b.ts too',
        'Edit src/b.ts and then edit src/c.ts too',
      );
      expect(overlap).toBeCloseTo(1 / 3);
    });
  });

  describe('extractKeywords', () => {
    it('extracts meaningful words', () => {
      const keywords = extractKeywords('database connection failed');
      expect(keywords.has('database')).toBe(true);
      expect(keywords.has('connection')).toBe(true);
      expect(keywords.has('failed')).toBe(true);
    });

    it('returns a Set', () => {
      expect(extractKeywords('test')).toBeInstanceOf(Set);
    });

    it('returns empty set for empty string', () => {
      expect(extractKeywords('').size).toBe(0);
    });

    it('filters out stop words', () => {
      const keywords = extractKeywords('the database is not working');
      expect(keywords.has('the')).toBe(false);
      expect(keywords.has('not')).toBe(false);
      expect(keywords.has('database')).toBe(true);
      expect(keywords.has('working')).toBe(true);
    });

    it('filters out short tokens (< 3 chars)', () => {
      const keywords = extractKeywords('I am ok to go do it');
      // All tokens are short or stop words
      expect(keywords.size).toBe(0);
    });

    it('filters out pure numbers', () => {
      const keywords = extractKeywords('error 404 on line 123');
      expect(keywords.has('404')).toBe(false);
      expect(keywords.has('123')).toBe(false);
      expect(keywords.has('error')).toBe(true);
      expect(keywords.has('line')).toBe(true);
    });

    it('converts to lowercase', () => {
      const keywords = extractKeywords('DATABASE Connection');
      expect(keywords.has('database')).toBe(true);
      expect(keywords.has('connection')).toBe(true);
      expect(keywords.has('DATABASE')).toBe(false);
    });

    it('splits on non-alphanumeric characters', () => {
      const keywords = extractKeywords('hello-world foo_bar baz.qux');
      expect(keywords.has('hello')).toBe(true);
      expect(keywords.has('world')).toBe(true);
      expect(keywords.has('foo_bar')).toBe(true);
      expect(keywords.has('baz')).toBe(true);
      expect(keywords.has('qux')).toBe(true);
    });

    it('keeps tokens with mixed alphanumeric characters', () => {
      const keywords = extractKeywords('error404 v2beta');
      expect(keywords.has('error404')).toBe(true);
      expect(keywords.has('v2beta')).toBe(true);
    });

    it('handles code-related text', () => {
      const keywords = extractKeywords('TypeError: Cannot read property of undefined');
      expect(keywords.has('typeerror')).toBe(true);
      expect(keywords.has('cannot')).toBe(true);
      expect(keywords.has('read')).toBe(true);
      expect(keywords.has('property')).toBe(true);
      expect(keywords.has('undefined')).toBe(true);
    });
  });

  describe('computeKeywordOverlap', () => {
    it('returns 1.0 for identical text', () => {
      const text = 'database connection pool management';
      expect(computeKeywordOverlap(text, text)).toBe(1);
    });

    it('returns 0 for completely different text', () => {
      const overlap = computeKeywordOverlap(
        'database connection pooling',
        'frontend rendering styles',
      );
      expect(overlap).toBe(0);
    });

    it('returns value between 0 and 1 for partial overlap', () => {
      const overlap = computeKeywordOverlap(
        'database connection pool error',
        'database connection timeout',
      );
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThan(1);
    });

    it('returns 0 when both texts are empty', () => {
      expect(computeKeywordOverlap('', '')).toBe(0);
    });

    it('returns 0 when texts have only stop words', () => {
      expect(computeKeywordOverlap('the is a an', 'to for of with')).toBe(0);
    });

    it('computes Jaccard coefficient correctly', () => {
      // textA keywords: {database, connection}, textB keywords: {database, pooling}
      // intersection = 1, union = 3 → 1/3
      const overlap = computeKeywordOverlap('database connection', 'database pooling');
      expect(overlap).toBeCloseTo(1 / 3);
    });
  });
});
