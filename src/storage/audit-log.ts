/**
 * Audit logging for database access.
 *
 * Logs database operations when encryption.auditLog is enabled.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../config/loader.js';
import { resolvePath } from '../config/memory-config.js';

const AUDIT_LOG_PATH = '~/.causantic/audit.log';

/** Audit log entry actions */
export type AuditAction = 'open' | 'close' | 'query' | 'failed' | 'key-access' | 'key-rotate';

/** Audit log entry */
export interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  details?: string;
  pid?: number;
}

/**
 * Log an audit entry.
 * Only logs if encryption.auditLog is enabled in config.
 */
export function logAudit(action: AuditAction, details?: string): void {
  const config = loadConfig();
  if (!config.encryption?.auditLog) {
    return;
  }

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    details,
    pid: process.pid,
  };

  const logPath = resolvePath(AUDIT_LOG_PATH);
  const line = JSON.stringify(entry) + '\n';

  try {
    appendFileSync(logPath, line);
  } catch {
    // Silently fail - don't break operations due to audit log issues
  }
}

/**
 * Read recent audit log entries.
 * @param limit Maximum number of entries to return (default 10)
 */
export function readAuditLog(limit = 10): AuditEntry[] {
  const logPath = resolvePath(AUDIT_LOG_PATH);

  if (!existsSync(logPath)) {
    return [];
  }

  try {
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Get last N entries
    const recentLines = lines.slice(-limit);

    return recentLines.map((line) => JSON.parse(line) as AuditEntry);
  } catch {
    return [];
  }
}

/**
 * Format audit entries for display.
 */
export function formatAuditEntries(entries: AuditEntry[]): string {
  if (entries.length === 0) {
    return 'No audit entries found.';
  }

  const lines = entries.map((entry) => {
    const time = entry.timestamp;
    const action = entry.action.padEnd(12);
    const details = entry.details ?? '';
    return `${time} ${action} ${details}`;
  });

  return lines.join('\n');
}
