/**
 * Tests for encryption features.
 */

import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  generatePassword,
  serializeEncrypted,
  deserializeEncrypted,
} from '../../src/storage/encryption.js';
import {
  SecureBuffer,
  withSecureBuffer,
  withSecureBufferSync,
} from '../../src/utils/secure-buffer.js';

describe('encryption', () => {
  describe('encrypt/decrypt', () => {
    it('encrypts and decrypts a buffer', () => {
      const plaintext = Buffer.from('Hello, World!', 'utf-8');
      const password = 'test-password';

      const encrypted = encrypt(plaintext, password);
      const decrypted = decrypt(encrypted, password);

      expect(decrypted.toString('utf-8')).toBe('Hello, World!');
    });

    it('produces different ciphertext for same input (random nonce)', () => {
      const plaintext = Buffer.from('Hello', 'utf-8');
      const password = 'test-password';

      const encrypted1 = encrypt(plaintext, password);
      const encrypted2 = encrypt(plaintext, password);

      // Ciphertext should be different due to random nonce
      expect(encrypted1.ciphertext.equals(encrypted2.ciphertext)).toBe(false);
    });

    it('fails with wrong password', () => {
      const plaintext = Buffer.from('Secret data', 'utf-8');
      const encrypted = encrypt(plaintext, 'correct-password');

      expect(() => {
        decrypt(encrypted, 'wrong-password');
      }).toThrow();
    });

    it('detects tampering (authenticated encryption)', () => {
      const plaintext = Buffer.from('Important data', 'utf-8');
      const password = 'test-password';
      const encrypted = encrypt(plaintext, password);

      // Tamper with ciphertext
      encrypted.ciphertext[0] ^= 0xff;

      expect(() => {
        decrypt(encrypted, password);
      }).toThrow();
    });
  });

  describe('encryptString/decryptString', () => {
    it('encrypts and decrypts a string', () => {
      const plaintext = 'Secret message';
      const password = 'password123';

      const encrypted = encryptString(plaintext, password);
      const decrypted = decryptString(encrypted, password);

      expect(decrypted).toBe(plaintext);
    });

    it('returns base64-encoded result', () => {
      const encrypted = encryptString('test', 'password');
      // Should be valid base64
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    });
  });

  describe('serialize/deserialize', () => {
    it('serializes and deserializes encrypted data', () => {
      const plaintext = Buffer.from('Test data', 'utf-8');
      const password = 'test';
      const encrypted = encrypt(plaintext, password);

      const serialized = serializeEncrypted(encrypted);
      const deserialized = deserializeEncrypted(serialized);

      expect(deserialized.salt.equals(encrypted.salt)).toBe(true);
      expect(deserialized.nonce.equals(encrypted.nonce)).toBe(true);
      expect(deserialized.authTag.equals(encrypted.authTag)).toBe(true);
      expect(deserialized.ciphertext.equals(encrypted.ciphertext)).toBe(true);

      // Verify we can still decrypt
      const decrypted = decrypt(deserialized, password);
      expect(decrypted.toString('utf-8')).toBe('Test data');
    });
  });

  describe('generatePassword', () => {
    it('generates password of requested length', () => {
      const password = generatePassword(16);
      expect(password.length).toBe(16);
    });

    it('generates random passwords', () => {
      const p1 = generatePassword(32);
      const p2 = generatePassword(32);
      expect(p1).not.toBe(p2);
    });

    it('uses default length of 32', () => {
      const password = generatePassword();
      expect(password.length).toBe(32);
    });
  });
});

describe('SecureBuffer', () => {
  it('holds string data', () => {
    const buffer = new SecureBuffer('secret');
    expect(buffer.toString()).toBe('secret');
  });

  it('holds Buffer data', () => {
    const buffer = new SecureBuffer(Buffer.from('secret', 'utf-8'));
    expect(buffer.toString()).toBe('secret');
  });

  it('reports length', () => {
    const buffer = new SecureBuffer('hello');
    expect(buffer.length).toBe(5);
  });

  it('clears memory when clear() is called', () => {
    const buffer = new SecureBuffer('secret-data');
    expect(buffer.isCleared()).toBe(false);

    buffer.clear();

    expect(buffer.isCleared()).toBe(true);
    expect(() => buffer.toString()).toThrow('SecureBuffer has been cleared');
  });

  it('can be cleared multiple times safely', () => {
    const buffer = new SecureBuffer('test');
    buffer.clear();
    buffer.clear(); // Should not throw
    expect(buffer.isCleared()).toBe(true);
  });

  it('prevents access to buffer after clearing', () => {
    const buffer = new SecureBuffer('password');
    buffer.clear();

    expect(() => buffer.toString()).toThrow();
    expect(() => buffer.toBuffer()).toThrow();
  });
});

describe('withSecureBuffer', () => {
  it('provides buffer to function and clears after', async () => {
    let capturedBuffer: SecureBuffer | null = null;

    await withSecureBuffer('secret', (buf) => {
      capturedBuffer = buf;
      expect(buf.toString()).toBe('secret');
    });

    expect(capturedBuffer!.isCleared()).toBe(true);
  });

  it('clears buffer even if function throws', async () => {
    let capturedBuffer: SecureBuffer | null = null;

    try {
      await withSecureBuffer('secret', (buf) => {
        capturedBuffer = buf;
        throw new Error('test error');
      });
    } catch {
      // Expected
    }

    expect(capturedBuffer!.isCleared()).toBe(true);
  });

  it('returns function result', async () => {
    const result = await withSecureBuffer('data', (buf) => {
      return buf.toString().toUpperCase();
    });

    expect(result).toBe('DATA');
  });
});

describe('withSecureBufferSync', () => {
  it('provides buffer synchronously and clears after', () => {
    let capturedBuffer: SecureBuffer | null = null;

    withSecureBufferSync('secret', (buf) => {
      capturedBuffer = buf;
      expect(buf.toString()).toBe('secret');
    });

    expect(capturedBuffer!.isCleared()).toBe(true);
  });

  it('clears buffer even if function throws', () => {
    let capturedBuffer: SecureBuffer | null = null;

    try {
      withSecureBufferSync('secret', (buf) => {
        capturedBuffer = buf;
        throw new Error('test error');
      });
    } catch {
      // Expected
    }

    expect(capturedBuffer!.isCleared()).toBe(true);
  });
});
