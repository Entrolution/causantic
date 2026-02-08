/**
 * macOS Keychain integration for secure API key storage.
 */

import { execSync } from 'child_process';

const SERVICE_NAME = 'semansiation';

/**
 * Get a secret from the macOS Keychain.
 * @param account - The account/key name (e.g., 'ANTHROPIC_API_KEY')
 * @returns The secret value, or null if not found
 */
export function getFromKeychain(account: string): string | null {
  try {
    const result = execSync(
      `security find-generic-password -a "${account}" -s "${SERVICE_NAME}" -w 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Store a secret in the macOS Keychain.
 * @param account - The account/key name (e.g., 'ANTHROPIC_API_KEY')
 * @param secret - The secret value to store
 */
export function setInKeychain(account: string, secret: string): void {
  // Delete existing entry if present (ignore errors)
  try {
    execSync(
      `security delete-generic-password -a "${account}" -s "${SERVICE_NAME}" 2>/dev/null`
    );
  } catch {
    // Ignore - entry may not exist
  }

  // Add new entry
  execSync(
    `security add-generic-password -a "${account}" -s "${SERVICE_NAME}" -w "${secret}"`,
    { encoding: 'utf-8' }
  );
}

/**
 * Delete a secret from the macOS Keychain.
 * @param account - The account/key name to delete
 * @returns true if deleted, false if not found
 */
export function deleteFromKeychain(account: string): boolean {
  try {
    execSync(
      `security delete-generic-password -a "${account}" -s "${SERVICE_NAME}" 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get API key from Keychain or environment variable.
 * Checks environment variable first, then falls back to Keychain.
 * @param keyName - The key name (e.g., 'ANTHROPIC_API_KEY')
 * @returns The API key, or null if not found
 */
export function getApiKey(keyName: string): string | null {
  // Check environment variable first
  const envValue = process.env[keyName];
  if (envValue) {
    return envValue;
  }

  // Fall back to Keychain
  return getFromKeychain(keyName);
}
