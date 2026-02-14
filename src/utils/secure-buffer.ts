/**
 * Secure buffer utilities for handling sensitive data.
 *
 * Provides memory protection by zeroing buffers when done.
 */

/**
 * Secure buffer that zeros memory when cleared.
 *
 * Use for encryption keys, passwords, and other sensitive data that
 * should not linger in memory after use.
 *
 * @example
 * ```typescript
 * const keyBuffer = new SecureBuffer(secretKey);
 * try {
 *   db.pragma(`key = '${keyBuffer.toString()}'`);
 * } finally {
 *   keyBuffer.clear();
 * }
 * ```
 */
export class SecureBuffer {
  private buffer: Buffer;
  private cleared = false;

  constructor(data: string | Buffer) {
    this.buffer = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data, 'utf-8');
  }

  /**
   * Get the buffer contents as a string.
   * @throws Error if buffer has been cleared
   */
  toString(encoding: BufferEncoding = 'utf-8'): string {
    if (this.cleared) {
      throw new Error('SecureBuffer has been cleared');
    }
    return this.buffer.toString(encoding);
  }

  /**
   * Get a copy of the raw buffer.
   * @throws Error if buffer has been cleared
   */
  toBuffer(): Buffer {
    if (this.cleared) {
      throw new Error('SecureBuffer has been cleared');
    }
    return Buffer.from(this.buffer);
  }

  /**
   * Check if the buffer has been cleared.
   */
  isCleared(): boolean {
    return this.cleared;
  }

  /**
   * Get the length of the buffer.
   */
  get length(): number {
    return this.buffer.length;
  }

  /**
   * Zero the buffer memory and mark as cleared.
   * Safe to call multiple times.
   */
  clear(): void {
    if (!this.cleared) {
      // Overwrite with zeros
      this.buffer.fill(0);
      this.cleared = true;
    }
  }
}

/**
 * Execute a function with a secure buffer, ensuring cleanup.
 *
 * @example
 * ```typescript
 * await withSecureBuffer(password, (buf) => {
 *   db.pragma(`key = '${buf.toString()}'`);
 * });
 * // Buffer is automatically cleared
 * ```
 */
export async function withSecureBuffer<T>(
  data: string | Buffer,
  fn: (buffer: SecureBuffer) => T | Promise<T>,
): Promise<T> {
  const buffer = new SecureBuffer(data);
  try {
    return await fn(buffer);
  } finally {
    buffer.clear();
  }
}

/**
 * Synchronous version of withSecureBuffer.
 */
export function withSecureBufferSync<T>(data: string | Buffer, fn: (buffer: SecureBuffer) => T): T {
  const buffer = new SecureBuffer(data);
  try {
    return fn(buffer);
  } finally {
    buffer.clear();
  }
}
