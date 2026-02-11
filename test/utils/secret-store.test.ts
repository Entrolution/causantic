/**
 * Tests for cross-platform secret storage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import {
  KeychainStore,
  LibsecretStore,
  EncryptedFileStore,
  EnvStore,
  CompositeStore,
  createSecretStore,
} from '../../src/utils/secret-store.js';

describe('EnvStore', () => {
  const store = new EnvStore();

  afterEach(() => {
    delete process.env.CAUSANTIC_ANTHROPIC_KEY;
    delete process.env.ANTHROPIC;
  });

  it('is always available', () => {
    expect(store.isAvailable()).toBe(true);
  });

  it('has type "environment"', () => {
    expect(store.type).toBe('environment');
  });

  it('returns prefixed env var first', async () => {
    process.env.CAUSANTIC_ANTHROPIC_KEY = 'prefixed-value';
    process.env.ANTHROPIC = 'direct-value';

    const result = await store.get('anthropic');
    expect(result).toBe('prefixed-value');
  });

  it('falls back to uppercase key', async () => {
    process.env.ANTHROPIC = 'direct-value';

    const result = await store.get('anthropic');
    expect(result).toBe('direct-value');
  });

  it('returns null when no env var found', async () => {
    const result = await store.get('nonexistent_unique_key_12345');
    expect(result).toBeNull();
  });

  it('throws on set', async () => {
    await expect(store.set('key', 'value')).rejects.toThrow('Cannot set environment variables');
  });

  it('throws on delete', async () => {
    await expect(store.delete('key')).rejects.toThrow('Cannot delete environment variables');
  });
});

describe('EncryptedFileStore', () => {
  const testDir = join(tmpdir(), 'causantic-test-secrets');
  const testFile = join(testDir, 'test-secrets.enc');
  let store: EncryptedFileStore;

  beforeEach(() => {
    // Use a constructor that bypasses resolvePath
    store = new EncryptedFileStore(testFile);
    store.setPassword('test-password-123');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (existsSync(testFile)) unlinkSync(testFile);
    } catch {
      // ignore cleanup errors
    }
  });

  it('is always available', () => {
    expect(store.isAvailable()).toBe(true);
  });

  it('has type "encrypted-file"', () => {
    expect(store.type).toBe('encrypted-file');
  });

  it('returns null for non-existent key on empty store', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeNull();
  });

  it('can set and get a secret', async () => {
    await store.set('api-key', 'sk-ant-12345');
    const result = await store.get('api-key');
    expect(result).toBe('sk-ant-12345');
  });

  it('preserves multiple keys', async () => {
    await store.set('key1', 'value1');
    await store.set('key2', 'value2');

    expect(await store.get('key1')).toBe('value1');
    expect(await store.get('key2')).toBe('value2');
  });

  it('overwrites existing key', async () => {
    await store.set('key', 'old-value');
    await store.set('key', 'new-value');
    expect(await store.get('key')).toBe('new-value');
  });

  it('deletes a key and returns true', async () => {
    await store.set('key', 'value');
    const deleted = await store.delete('key');
    expect(deleted).toBe(true);
    expect(await store.get('key')).toBeNull();
  });

  it('returns false when deleting non-existent key', async () => {
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('handles special characters in values', async () => {
    const special = 'p@$$w0rd!#%&*()_+-=[]{}|;:,.<>?';
    await store.set('special', special);
    expect(await store.get('special')).toBe(special);
  });

  it('throws when no password is set', async () => {
    const noPasswordStore = new EncryptedFileStore(testFile);
    // Clear the env var
    const original = process.env.CAUSANTIC_SECRET_PASSWORD;
    delete process.env.CAUSANTIC_SECRET_PASSWORD;
    try {
      await expect(noPasswordStore.set('key', 'value')).rejects.toThrow('No password set');
    } finally {
      if (original !== undefined) {
        process.env.CAUSANTIC_SECRET_PASSWORD = original;
      }
    }
  });

  it('uses CAUSANTIC_SECRET_PASSWORD env var as fallback', async () => {
    const noPasswordStore = new EncryptedFileStore(join(testDir, 'env-secrets.enc'));
    const original = process.env.CAUSANTIC_SECRET_PASSWORD;
    process.env.CAUSANTIC_SECRET_PASSWORD = 'env-password';
    try {
      await noPasswordStore.set('key', 'value');
      expect(await noPasswordStore.get('key')).toBe('value');
    } finally {
      if (original === undefined) {
        delete process.env.CAUSANTIC_SECRET_PASSWORD;
      } else {
        process.env.CAUSANTIC_SECRET_PASSWORD = original;
      }
      try {
        unlinkSync(join(testDir, 'env-secrets.enc'));
      } catch { /* ignore */ }
    }
  });

  it('returns null on decryption with wrong password', async () => {
    await store.set('key', 'value');

    const wrongStore = new EncryptedFileStore(testFile);
    wrongStore.setPassword('wrong-password');
    const result = await wrongStore.get('key');
    expect(result).toBeNull();
  });
});

describe('KeychainStore', () => {
  it('has type "keychain"', () => {
    const store = new KeychainStore();
    expect(store.type).toBe('keychain');
  });

  it('isAvailable depends on platform and security CLI', () => {
    const store = new KeychainStore();
    // Just verify it returns a boolean without throwing
    expect(typeof store.isAvailable()).toBe('boolean');
  });
});

describe('LibsecretStore', () => {
  it('has type "libsecret"', () => {
    const store = new LibsecretStore();
    expect(store.type).toBe('libsecret');
  });

  it('isAvailable depends on platform and secret-tool', () => {
    const store = new LibsecretStore();
    expect(typeof store.isAvailable()).toBe('boolean');
  });
});

describe('CompositeStore', () => {
  it('has type "composite"', () => {
    const mockStore: any = { type: 'mock', isAvailable: () => true, get: vi.fn(), set: vi.fn(), delete: vi.fn() };
    const store = new CompositeStore([mockStore]);
    expect(store.type).toBe('composite');
  });

  it('get tries stores in order and returns first non-null', async () => {
    const store1: any = {
      type: 'first',
      isAvailable: () => true,
      get: vi.fn().mockResolvedValue(null),
    };
    const store2: any = {
      type: 'second',
      isAvailable: () => true,
      get: vi.fn().mockResolvedValue('found'),
    };

    const composite = new CompositeStore([store1, store2]);
    const result = await composite.get('key');

    expect(result).toBe('found');
    expect(store1.get).toHaveBeenCalledWith('key');
    expect(store2.get).toHaveBeenCalledWith('key');
  });

  it('get skips unavailable stores', async () => {
    const unavailable: any = {
      type: 'unavailable',
      isAvailable: () => false,
      get: vi.fn(),
    };
    const available: any = {
      type: 'available',
      isAvailable: () => true,
      get: vi.fn().mockResolvedValue('value'),
    };

    const composite = new CompositeStore([unavailable, available]);
    const result = await composite.get('key');

    expect(result).toBe('value');
    expect(unavailable.get).not.toHaveBeenCalled();
  });

  it('get returns null when no store has the key', async () => {
    const store1: any = {
      type: 'empty',
      isAvailable: () => true,
      get: vi.fn().mockResolvedValue(null),
    };

    const composite = new CompositeStore([store1]);
    expect(await composite.get('key')).toBeNull();
  });

  it('get catches errors from individual stores', async () => {
    const failing: any = {
      type: 'failing',
      isAvailable: () => true,
      get: vi.fn().mockRejectedValue(new Error('kaboom')),
    };
    const working: any = {
      type: 'working',
      isAvailable: () => true,
      get: vi.fn().mockResolvedValue('value'),
    };

    const composite = new CompositeStore([failing, working]);
    expect(await composite.get('key')).toBe('value');
  });

  it('set delegates to writeStore', async () => {
    const readStore: any = {
      type: 'read',
      isAvailable: () => true,
      get: vi.fn(),
    };
    const writeStore: any = {
      type: 'write',
      isAvailable: () => true,
      set: vi.fn().mockResolvedValue(undefined),
    };

    const composite = new CompositeStore([readStore, writeStore], writeStore);
    await composite.set('key', 'value');

    expect(writeStore.set).toHaveBeenCalledWith('key', 'value');
  });

  it('set throws if writeStore is unavailable', async () => {
    const writeStore: any = {
      type: 'write',
      isAvailable: () => false,
      set: vi.fn(),
    };

    const composite = new CompositeStore([writeStore], writeStore);
    await expect(composite.set('key', 'value')).rejects.toThrow('not available');
  });

  it('isAvailable returns true if any store is available', () => {
    const unavailable: any = { type: 'a', isAvailable: () => false };
    const available: any = { type: 'b', isAvailable: () => true };

    const composite = new CompositeStore([unavailable, available]);
    expect(composite.isAvailable()).toBe(true);
  });

  it('isAvailable returns false if no stores are available', () => {
    const store: any = { type: 'a', isAvailable: () => false };
    const composite = new CompositeStore([store]);
    expect(composite.isAvailable()).toBe(false);
  });

  it('delete delegates to writeStore', async () => {
    const writeStore: any = {
      type: 'write',
      isAvailable: () => true,
      delete: vi.fn().mockResolvedValue(true),
    };

    const composite = new CompositeStore([writeStore], writeStore);
    expect(await composite.delete('key')).toBe(true);
  });

  it('delete returns false if writeStore unavailable', async () => {
    const writeStore: any = {
      type: 'write',
      isAvailable: () => false,
      delete: vi.fn(),
    };

    const composite = new CompositeStore([writeStore], writeStore);
    expect(await composite.delete('key')).toBe(false);
  });
});

describe('createSecretStore', () => {
  it('returns a composite store', () => {
    const store = createSecretStore({ password: 'test' });
    expect(store.type).toBe('composite');
    expect(store.isAvailable()).toBe(true);
  });
});
