/**
 * Shared bootstrap function for all entry points.
 *
 * Ensures user config files and env vars are loaded into the
 * runtime config cache exactly once. Idempotent — safe to call
 * multiple times (last call wins).
 */

import { initRuntimeConfig, type MemoryConfig } from './memory-config.js';
import { loadConfig, toRuntimeConfig, type LoadConfigOptions } from './loader.js';

/**
 * Load configuration from all sources and initialize the runtime cache.
 *
 * Call this once at startup in every entry point (MCP server, dashboard,
 * hooks, CLI commands) instead of manually chaining
 * `initRuntimeConfig(toRuntimeConfig(loadConfig()))`.
 *
 * @returns The resolved MemoryConfig for callers that need it directly.
 */
export function bootstrap(options?: LoadConfigOptions): MemoryConfig {
  const config = toRuntimeConfig(loadConfig(options));
  initRuntimeConfig(config);
  return config;
}
