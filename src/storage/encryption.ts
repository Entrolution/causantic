/**
 * Encryption utilities for Causantic.
 *
 * Uses AES-256-GCM for authenticated encryption with Argon2id for key derivation.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/** Encryption algorithm */
const ALGORITHM = 'aes-256-gcm';

/** Key length for AES-256 */
const KEY_LENGTH = 32;

/** Salt length for key derivation */
const SALT_LENGTH = 16;

/** Nonce length for AES-GCM */
const NONCE_LENGTH = 12;

/** Auth tag length for AES-GCM */
const AUTH_TAG_LENGTH = 16;

/** Encrypted data format */
export interface EncryptedData {
  /** Salt for key derivation */
  salt: Buffer;
  /** Nonce for AES-GCM */
  nonce: Buffer;
  /** Authentication tag */
  authTag: Buffer;
  /** Encrypted content */
  ciphertext: Buffer;
}

/**
 * Derive an encryption key from a password using scrypt.
 * Using scrypt as it's available in Node.js crypto module.
 * For production, consider Argon2id.
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: 16384,  // CPU/memory cost
    r: 8,      // Block size
    p: 1,      // Parallelization
  });
}

/**
 * Encrypt data with AES-256-GCM.
 */
export function encrypt(plaintext: Buffer, password: string): EncryptedData {
  const salt = randomBytes(SALT_LENGTH);
  const nonce = randomBytes(NONCE_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return { salt, nonce, authTag, ciphertext };
}

/**
 * Decrypt data with AES-256-GCM.
 */
export function decrypt(encrypted: EncryptedData, password: string): Buffer {
  const key = deriveKey(password, encrypted.salt);

  const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce);
  decipher.setAuthTag(encrypted.authTag);

  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]);
}

/**
 * Encrypt a string and return base64-encoded result.
 */
export function encryptString(plaintext: string, password: string): string {
  const encrypted = encrypt(Buffer.from(plaintext, 'utf-8'), password);

  // Combine all parts into a single buffer
  const combined = Buffer.concat([
    encrypted.salt,
    encrypted.nonce,
    encrypted.authTag,
    encrypted.ciphertext,
  ]);

  return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded string.
 */
export function decryptString(encryptedBase64: string, password: string): string {
  const combined = Buffer.from(encryptedBase64, 'base64');

  // Extract parts
  let offset = 0;
  const salt = combined.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const nonce = combined.subarray(offset, offset + NONCE_LENGTH);
  offset += NONCE_LENGTH;
  const authTag = combined.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;
  const ciphertext = combined.subarray(offset);

  const decrypted = decrypt({ salt, nonce, authTag, ciphertext }, password);
  return decrypted.toString('utf-8');
}

/**
 * Serialize encrypted data to a buffer.
 */
export function serializeEncrypted(encrypted: EncryptedData): Buffer {
  return Buffer.concat([
    encrypted.salt,
    encrypted.nonce,
    encrypted.authTag,
    encrypted.ciphertext,
  ]);
}

/**
 * Deserialize encrypted data from a buffer.
 */
export function deserializeEncrypted(buffer: Buffer): EncryptedData {
  let offset = 0;
  const salt = buffer.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const nonce = buffer.subarray(offset, offset + NONCE_LENGTH);
  offset += NONCE_LENGTH;
  const authTag = buffer.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;
  const ciphertext = buffer.subarray(offset);

  return { salt, nonce, authTag, ciphertext };
}

/**
 * Generate a random encryption key (for testing or key management).
 */
export function generateKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Generate a random password-like string.
 */
export function generatePassword(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}
