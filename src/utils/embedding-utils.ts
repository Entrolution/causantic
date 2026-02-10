/**
 * Shared embedding serialization utilities.
 * Used by vector-store and embedding-cache for SQLite BLOB storage.
 */

/**
 * Serialize an embedding to a Buffer for SQLite storage.
 *
 * Uses Float32Array for efficient storage (4 bytes per dimension).
 * A 1024-dimension embedding uses 4KB of storage.
 *
 * @param embedding - Array of floating point values
 * @returns Buffer containing Float32Array binary representation
 */
export function serializeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * Deserialize an embedding from a SQLite Buffer.
 *
 * Reconstructs the Float32Array from the raw buffer bytes,
 * handling byte offset alignment properly.
 *
 * @param buffer - Buffer from SQLite BLOB column
 * @returns Array of floating point values
 */
export function deserializeEmbedding(buffer: Buffer): number[] {
  const float32 = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / Float32Array.BYTES_PER_ELEMENT
  );
  return Array.from(float32);
}
