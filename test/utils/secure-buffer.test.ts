/**
 * Tests for SecureBuffer and helper functions.
 */

import { describe, it, expect } from 'vitest';
import { SecureBuffer, withSecureBuffer, withSecureBufferSync } from '../../src/utils/secure-buffer.js';

describe('SecureBuffer', () => {
  it('creates from string', () => {
    const buf = new SecureBuffer('secret');
    expect(buf.toString()).toBe('secret');
    expect(buf.length).toBe(6);
    buf.clear();
  });

  it('creates from Buffer', () => {
    const buf = new SecureBuffer(Buffer.from('secret'));
    expect(buf.toString()).toBe('secret');
    buf.clear();
  });

  it('toBuffer returns a copy, not the original', () => {
    const buf = new SecureBuffer('secret');
    const copy = buf.toBuffer();
    copy.fill(0);
    expect(buf.toString()).toBe('secret');
    buf.clear();
  });

  it('toString accepts encoding parameter', () => {
    const buf = new SecureBuffer('hello');
    expect(buf.toString('hex')).toBe(Buffer.from('hello').toString('hex'));
    buf.clear();
  });

  it('isCleared returns false initially', () => {
    const buf = new SecureBuffer('secret');
    expect(buf.isCleared()).toBe(false);
    buf.clear();
  });

  it('clear zeros the buffer and sets cleared flag', () => {
    const buf = new SecureBuffer('secret');
    buf.clear();
    expect(buf.isCleared()).toBe(true);
  });

  it('clear is safe to call multiple times', () => {
    const buf = new SecureBuffer('secret');
    buf.clear();
    buf.clear();
    expect(buf.isCleared()).toBe(true);
  });

  it('toString throws after clear', () => {
    const buf = new SecureBuffer('secret');
    buf.clear();
    expect(() => buf.toString()).toThrow('SecureBuffer has been cleared');
  });

  it('toBuffer throws after clear', () => {
    const buf = new SecureBuffer('secret');
    buf.clear();
    expect(() => buf.toBuffer()).toThrow('SecureBuffer has been cleared');
  });
});

describe('withSecureBuffer', () => {
  it('provides buffer to callback and returns result', async () => {
    const result = await withSecureBuffer('secret', (buf) => buf.toString());
    expect(result).toBe('secret');
  });

  it('clears buffer after callback completes', async () => {
    let captured: SecureBuffer | null = null;
    await withSecureBuffer('secret', (buf) => {
      captured = buf;
    });
    expect(captured!.isCleared()).toBe(true);
  });

  it('clears buffer even if callback throws', async () => {
    let captured: SecureBuffer | null = null;
    try {
      await withSecureBuffer('secret', (buf) => {
        captured = buf;
        throw new Error('oops');
      });
    } catch {
      // expected
    }
    expect(captured!.isCleared()).toBe(true);
  });

  it('works with async callbacks', async () => {
    const result = await withSecureBuffer('secret', async (buf) => {
      return buf.toString().toUpperCase();
    });
    expect(result).toBe('SECRET');
  });
});

describe('withSecureBufferSync', () => {
  it('provides buffer to callback and returns result', () => {
    const result = withSecureBufferSync('secret', (buf) => buf.toString());
    expect(result).toBe('secret');
  });

  it('clears buffer after callback completes', () => {
    let captured: SecureBuffer | null = null;
    withSecureBufferSync('secret', (buf) => {
      captured = buf;
    });
    expect(captured!.isCleared()).toBe(true);
  });

  it('clears buffer even if callback throws', () => {
    let captured: SecureBuffer | null = null;
    try {
      withSecureBufferSync('secret', (buf) => {
        captured = buf;
        throw new Error('oops');
      });
    } catch {
      // expected
    }
    expect(captured!.isCleared()).toBe(true);
  });
});
