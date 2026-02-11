/**
 * Tests for approximate token counting.
 */

import { describe, it, expect } from 'vitest';
import { approximateTokens } from '../../src/utils/token-counter.js';

describe('approximateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(approximateTokens('')).toBe(0);
  });

  it('returns positive count for non-empty text', () => {
    expect(approximateTokens('hello world')).toBeGreaterThan(0);
  });

  it('scales with text length', () => {
    const short = approximateTokens('short');
    const long = approximateTokens('this is a much longer piece of text that should produce more tokens');
    expect(long).toBeGreaterThan(short);
  });

  it('rounds up (ceil)', () => {
    // 1 char / 3.5 = 0.28... → ceil = 1
    expect(approximateTokens('a')).toBe(1);
  });

  it('uses ~3.5 chars per token', () => {
    // 35 chars / 3.5 = exactly 10
    const text = 'a'.repeat(35);
    expect(approximateTokens(text)).toBe(10);
  });

  it('handles multiline text', () => {
    const text = 'line one\nline two\nline three';
    expect(approximateTokens(text)).toBeGreaterThan(0);
  });
});
