/**
 * Tests for the legacy keychain module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../src/utils/secret-store.js', () => ({
  createSecretStore: vi.fn(),
  getApiKey: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { getFromKeychain, setInKeychain, deleteFromKeychain, getApiKey } from '../../src/utils/keychain.js';
import { getApiKey as getApiKeyFromStore } from '../../src/utils/secret-store.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getFromKeychain', () => {
  it('returns trimmed password on success', () => {
    vi.mocked(execSync).mockReturnValue('my-secret-key\n');

    const result = getFromKeychain('ANTHROPIC_API_KEY');

    expect(result).toBe('my-secret-key');
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('find-generic-password'),
      expect.any(Object)
    );
  });

  it('returns null on error', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('The specified item could not be found');
    });

    expect(getFromKeychain('MISSING_KEY')).toBeNull();
  });

  it('uses correct service name and account', () => {
    vi.mocked(execSync).mockReturnValue('value');

    getFromKeychain('MY_KEY');

    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain('-a "MY_KEY"');
    expect(cmd).toContain('-s "causantic"');
  });
});

describe('setInKeychain', () => {
  it('deletes existing entry then adds new one', () => {
    vi.mocked(execSync).mockReturnValue('' as any);

    setInKeychain('MY_KEY', 'my-value');

    expect(execSync).toHaveBeenCalledTimes(2);
    const deleteCmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(deleteCmd).toContain('delete-generic-password');

    const addCmd = vi.mocked(execSync).mock.calls[1][0] as string;
    expect(addCmd).toContain('add-generic-password');
  });

  it('ignores error when deleting non-existent entry', () => {
    vi.mocked(execSync)
      .mockImplementationOnce(() => { throw new Error('not found'); })
      .mockReturnValueOnce('' as any);

    expect(() => setInKeychain('MY_KEY', 'value')).not.toThrow();
    expect(execSync).toHaveBeenCalledTimes(2);
  });
});

describe('deleteFromKeychain', () => {
  it('returns true on successful delete', () => {
    vi.mocked(execSync).mockReturnValue('' as any);

    expect(deleteFromKeychain('MY_KEY')).toBe(true);
  });

  it('returns false when entry not found', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });

    expect(deleteFromKeychain('MY_KEY')).toBe(false);
  });
});

describe('getApiKey', () => {
  it('returns env var if present', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'env-key';

    try {
      expect(getApiKey('ANTHROPIC_API_KEY')).toBe('env-key');
      expect(execSync).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = original;
      }
    }
  });

  it('falls back to keychain when env var missing', () => {
    const original = process.env.TEST_KEY_NAME;
    delete process.env.TEST_KEY_NAME;

    vi.mocked(execSync).mockReturnValue('keychain-value\n');

    try {
      expect(getApiKey('TEST_KEY_NAME')).toBe('keychain-value');
    } finally {
      if (original !== undefined) {
        process.env.TEST_KEY_NAME = original;
      }
    }
  });

  it('returns null when neither available', () => {
    const original = process.env.NONEXISTENT_KEY;
    delete process.env.NONEXISTENT_KEY;

    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });

    try {
      expect(getApiKey('NONEXISTENT_KEY')).toBeNull();
    } finally {
      if (original !== undefined) {
        process.env.NONEXISTENT_KEY = original;
      }
    }
  });
});
