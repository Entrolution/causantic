/**
 * Cross-platform secret storage abstraction.
 *
 * Supports:
 * - macOS: Keychain (via security CLI)
 * - Linux: libsecret (via secret-tool CLI)
 * - Fallback: Encrypted file storage
 *
 * Usage:
 *   const store = await SecretStore.create();
 *   await store.set('anthropic', 'sk-ant-...');
 *   const key = await store.get('anthropic');
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { resolvePath } from '../config/memory-config.js';

const SERVICE_NAME = 'causantic';
const ENCRYPTED_FILE_PATH = '~/.causantic/.secrets.enc';

/** Secret store interface */
export interface SecretStore {
  /** Get a secret by key name */
  get(key: string): Promise<string | null>;
  /** Set a secret */
  set(key: string, value: string): Promise<void>;
  /** Delete a secret */
  delete(key: string): Promise<boolean>;
  /** Check if the store is available */
  isAvailable(): boolean;
  /** Get the store type name */
  readonly type: string;
}

/**
 * macOS Keychain secret store.
 */
class KeychainStore implements SecretStore {
  readonly type = 'keychain';

  isAvailable(): boolean {
    if (process.platform !== 'darwin') {
      return false;
    }
    try {
      execFileSync('which', ['security'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      const result = execFileSync(
        'security',
        ['find-generic-password', '-a', key, '-s', SERVICE_NAME, '-w'],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      return result.trim();
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    // Delete existing entry if present
    try {
      execFileSync(
        'security',
        ['delete-generic-password', '-a', key, '-s', SERVICE_NAME],
        { stdio: ['pipe', 'ignore', 'ignore'] }
      );
    } catch {
      // Ignore - entry may not exist
    }

    // Add new entry — uses execFileSync to avoid shell interpretation of special chars
    execFileSync(
      'security',
      ['add-generic-password', '-a', key, '-s', SERVICE_NAME, '-w', value],
      { encoding: 'utf-8' }
    );
  }

  async delete(key: string): Promise<boolean> {
    try {
      execFileSync(
        'security',
        ['delete-generic-password', '-a', key, '-s', SERVICE_NAME],
        { stdio: ['pipe', 'ignore', 'ignore'] }
      );
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Linux libsecret store (GNOME Keyring / KDE Wallet via secret-tool).
 */
class LibsecretStore implements SecretStore {
  readonly type = 'libsecret';

  isAvailable(): boolean {
    if (process.platform !== 'linux') {
      return false;
    }
    try {
      const result = spawnSync('which', ['secret-tool'], { encoding: 'utf-8' });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      const result = spawnSync(
        'secret-tool',
        ['lookup', 'service', SERVICE_NAME, 'account', key],
        { encoding: 'utf-8' }
      );
      if (result.status === 0 && result.stdout) {
        return result.stdout.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const result = spawnSync(
      'secret-tool',
      ['store', '--label', `${SERVICE_NAME}:${key}`, 'service', SERVICE_NAME, 'account', key],
      {
        input: value,
        encoding: 'utf-8',
      }
    );
    if (result.status !== 0) {
      throw new Error(`Failed to store secret: ${result.stderr}`);
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const result = spawnSync(
        'secret-tool',
        ['clear', 'service', SERVICE_NAME, 'account', key],
        { encoding: 'utf-8' }
      );
      return result.status === 0;
    } catch {
      return false;
    }
  }
}

/**
 * Encrypted file-based secret store (fallback).
 * Uses AES-256-GCM with password-derived key.
 */
class EncryptedFileStore implements SecretStore {
  readonly type = 'encrypted-file';
  private password: string | null = null;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = resolvePath(filePath ?? ENCRYPTED_FILE_PATH);
  }

  isAvailable(): boolean {
    return true; // Always available as fallback
  }

  setPassword(password: string): void {
    this.password = password;
  }

  private ensurePassword(): string {
    if (!this.password) {
      // Check environment variable
      const envPassword = process.env.CAUSANTIC_SECRET_PASSWORD;
      if (envPassword) {
        this.password = envPassword;
      } else {
        throw new Error(
          'No password set for encrypted file store. ' +
          'Set CAUSANTIC_SECRET_PASSWORD environment variable or call setPassword().'
        );
      }
    }
    return this.password;
  }

  private deriveKey(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, 32);
  }

  private loadSecrets(): Record<string, string> {
    if (!existsSync(this.filePath)) {
      return {};
    }

    const password = this.ensurePassword();
    const fileContent = readFileSync(this.filePath);

    // Format: salt (16) + nonce (12) + authTag (16) + ciphertext
    const salt = fileContent.subarray(0, 16);
    const nonce = fileContent.subarray(16, 28);
    const authTag = fileContent.subarray(28, 44);
    const ciphertext = fileContent.subarray(44);

    const key = this.deriveKey(password, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf-8'));
  }

  private saveSecrets(secrets: Record<string, string>): void {
    const password = this.ensurePassword();
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const key = this.deriveKey(password, salt);

    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const plaintext = Buffer.from(JSON.stringify(secrets), 'utf-8');

    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write: salt + nonce + authTag + ciphertext
    const output = Buffer.concat([salt, nonce, authTag, ciphertext]);
    writeFileSync(this.filePath, output);
  }

  async get(key: string): Promise<string | null> {
    try {
      const secrets = this.loadSecrets();
      return secrets[key] ?? null;
    } catch (error) {
      if ((error as Error).message.includes('No password set')) {
        throw error;
      }
      // Decryption failed - wrong password or corrupted file
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    let secrets: Record<string, string> = {};
    try {
      secrets = this.loadSecrets();
    } catch {
      // Start fresh if file doesn't exist or can't be decrypted
    }
    secrets[key] = value;
    this.saveSecrets(secrets);
  }

  async delete(key: string): Promise<boolean> {
    try {
      const secrets = this.loadSecrets();
      if (key in secrets) {
        delete secrets[key];
        this.saveSecrets(secrets);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Environment variable store (read-only for compatibility).
 */
class EnvStore implements SecretStore {
  readonly type = 'environment';
  private readonly prefix: string;

  constructor(prefix = 'CAUSANTIC_') {
    this.prefix = prefix;
  }

  isAvailable(): boolean {
    return true;
  }

  async get(key: string): Promise<string | null> {
    // Try with prefix first, then without
    const prefixedKey = `${this.prefix}${key.toUpperCase()}_KEY`;
    const directKey = key.toUpperCase();

    return process.env[prefixedKey] ?? process.env[directKey] ?? null;
  }

  async set(_key: string, _value: string): Promise<void> {
    throw new Error('Cannot set environment variables at runtime');
  }

  async delete(_key: string): Promise<boolean> {
    throw new Error('Cannot delete environment variables at runtime');
  }
}

/**
 * Composite secret store that tries multiple backends in order.
 */
class CompositeStore implements SecretStore {
  readonly type = 'composite';
  private stores: SecretStore[];
  private writeStore: SecretStore;

  constructor(stores: SecretStore[], writeStore?: SecretStore) {
    this.stores = stores;
    this.writeStore = writeStore ?? stores[0];
  }

  isAvailable(): boolean {
    return this.stores.some((s) => s.isAvailable());
  }

  async get(key: string): Promise<string | null> {
    for (const store of this.stores) {
      if (!store.isAvailable()) continue;
      try {
        const value = await store.get(key);
        if (value !== null) {
          return value;
        }
      } catch {
        // Try next store
      }
    }
    return null;
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.writeStore.isAvailable()) {
      throw new Error(`Write store (${this.writeStore.type}) is not available`);
    }
    return this.writeStore.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    if (!this.writeStore.isAvailable()) {
      return false;
    }
    return this.writeStore.delete(key);
  }
}

/**
 * Create the default secret store for the current platform.
 *
 * Order of preference:
 * 1. Environment variables (read-only, always checked first)
 * 2. macOS Keychain (darwin)
 * 3. Linux libsecret (linux with secret-tool)
 * 4. Encrypted file (fallback)
 */
export function createSecretStore(options?: {
  encryptedFilePath?: string;
  password?: string;
}): SecretStore {
  const stores: SecretStore[] = [];

  // Always check environment variables first
  stores.push(new EnvStore());

  // Platform-specific secure stores
  const keychain = new KeychainStore();
  if (keychain.isAvailable()) {
    stores.push(keychain);
  }

  const libsecret = new LibsecretStore();
  if (libsecret.isAvailable()) {
    stores.push(libsecret);
  }

  // Encrypted file fallback
  const encryptedFile = new EncryptedFileStore(options?.encryptedFilePath);
  if (options?.password) {
    encryptedFile.setPassword(options.password);
  }
  stores.push(encryptedFile);

  // Determine write store (first non-env store that's available)
  const writeStore = stores.find((s) => s.type !== 'environment' && s.isAvailable());

  return new CompositeStore(stores, writeStore);
}

/**
 * Get API key from the secret store or environment variable.
 * Convenience function that matches the old keychain.ts API.
 */
export async function getApiKey(keyName: string): Promise<string | null> {
  const store = createSecretStore();
  return store.get(keyName);
}

// Export store implementations for testing
export { KeychainStore, LibsecretStore, EncryptedFileStore, EnvStore, CompositeStore };
