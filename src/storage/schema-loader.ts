/**
 * Schema SQL loading and statement splitting.
 *
 * Extracted from db.ts for clarity. Handles reading schema.sql and splitting
 * it into individual statements, respecting BEGIN...END blocks (triggers).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load and parse the schema SQL file into individual statements.
 *
 * Splits on semicolons at line ends, but keeps BEGIN...END blocks (triggers)
 * intact as single statements.
 */
export function loadSchemaStatements(): string[] {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  return splitStatements(schema);
}

/**
 * Split SQL text into individual statements, respecting BEGIN...END blocks.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inTrigger = false;

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();

    // Skip pure comment lines when starting a new statement
    if (!current && trimmed.startsWith('--')) continue;

    current += (current ? '\n' : '') + line;

    // Detect entering a trigger body
    if (/\bBEGIN\s*$/i.test(trimmed)) {
      inTrigger = true;
    }

    // Detect end of trigger (END; on its own line)
    if (inTrigger && /^END\s*;/i.test(trimmed)) {
      inTrigger = false;
      statements.push(current.trim());
      current = '';
      continue;
    }

    // Outside triggers, a semicolon at end of line ends the statement
    if (!inTrigger && trimmed.endsWith(';')) {
      const stmt = current.trim().replace(/;$/, '').trim();
      if (stmt) statements.push(stmt);
      current = '';
    }
  }

  // Handle any trailing statement
  if (current.trim()) {
    const stmt = current.trim().replace(/;$/, '').trim();
    if (stmt) statements.push(stmt);
  }

  return statements;
}
