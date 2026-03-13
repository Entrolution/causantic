/**
 * Regex-based fallback parser for languages without tree-sitter WASM grammars.
 *
 * Extracts definitions and imports using line-by-line pattern matching.
 * Less accurate than tree-sitter but covers 80%+ of common definitions
 * for languages like Scala, Kotlin, Swift, Haskell, etc.
 */

import { readFileSync } from 'fs';
import type { Tag } from './parser.js';

/** Map from file extension to regex-parsed language name. */
export const REGEX_EXTENSIONS: Record<string, string> = {
  '.scala': 'scala',
  '.sc': 'scala',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.lua': 'lua',
  '.dart': 'dart',
  '.zig': 'zig',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.pl': 'perl',
  '.pm': 'perl',
  '.r': 'r',
  '.R': 'r',
};

interface PatternRule {
  regex: RegExp;
  kind: 'def' | 'ref';
  type: Tag['type'];
}

/** Comment line prefixes by language (used to skip comment-only lines). */
const COMMENT_PREFIXES: Record<string, string[]> = {
  scala: ['//', '*', '/*'],
  kotlin: ['//', '*', '/*'],
  swift: ['//', '*', '/*'],
  haskell: ['--', '{-'],
  lua: ['--'],
  dart: ['//', '*', '/*'],
  zig: ['//'],
  elixir: ['#'],
  perl: ['#'],
  r: ['#'],
};

const PATTERNS: Record<string, PatternRule[]> = {
  scala: [
    {
      regex: /(?:abstract\s+|sealed\s+|case\s+|final\s+)*class\s+(\w+)/,
      kind: 'def',
      type: 'class',
    },
    { regex: /(?:case\s+)?object\s+(\w+)/, kind: 'def', type: 'class' },
    { regex: /trait\s+(\w+)/, kind: 'def', type: 'interface' },
    { regex: /def\s+(\w+)/, kind: 'def', type: 'function' },
    { regex: /type\s+(\w+)/, kind: 'def', type: 'type' },
    { regex: /import\s+[\w.]+\.(\w+)/, kind: 'ref', type: 'import' },
  ],

  kotlin: [
    {
      regex: /(?:data\s+|sealed\s+|abstract\s+|open\s+|inner\s+|enum\s+)*class\s+(\w+)/,
      kind: 'def',
      type: 'class',
    },
    { regex: /(?:companion\s+)?object\s+(\w+)/, kind: 'def', type: 'class' },
    { regex: /interface\s+(\w+)/, kind: 'def', type: 'interface' },
    { regex: /fun\s+(?:<[^>]+>\s+)?(\w+)/, kind: 'def', type: 'function' },
    { regex: /typealias\s+(\w+)/, kind: 'def', type: 'type' },
    { regex: /import\s+[\w.]+\.(\w+)/, kind: 'ref', type: 'import' },
  ],

  swift: [
    {
      regex: /(?:public\s+|private\s+|internal\s+|open\s+|final\s+)*class\s+(\w+)/,
      kind: 'def',
      type: 'class',
    },
    { regex: /(?:public\s+|private\s+|internal\s+)*struct\s+(\w+)/, kind: 'def', type: 'class' },
    { regex: /(?:public\s+|private\s+|internal\s+)*enum\s+(\w+)/, kind: 'def', type: 'enum' },
    {
      regex: /(?:public\s+|private\s+|internal\s+)*protocol\s+(\w+)/,
      kind: 'def',
      type: 'interface',
    },
    {
      regex:
        /(?:public\s+|private\s+|internal\s+|open\s+|override\s+|static\s+|class\s+)*func\s+(\w+)/,
      kind: 'def',
      type: 'function',
    },
    { regex: /typealias\s+(\w+)/, kind: 'def', type: 'type' },
    { regex: /(?:public\s+|private\s+|internal\s+)*extension\s+(\w+)/, kind: 'def', type: 'class' },
    { regex: /import\s+(\w+)/, kind: 'ref', type: 'import' },
  ],

  haskell: [
    { regex: /^data\s+(\w+)/, kind: 'def', type: 'type' },
    { regex: /^newtype\s+(\w+)/, kind: 'def', type: 'type' },
    { regex: /^type\s+(\w+)/, kind: 'def', type: 'type' },
    { regex: /^class\s+(?:\([^)]*\)\s*=>\s*)?(\w+)/, kind: 'def', type: 'class' },
    { regex: /^(\w+)\s+::/, kind: 'def', type: 'function' },
    { regex: /^import\s+(?:qualified\s+)?([A-Z][\w.]*)/, kind: 'ref', type: 'import' },
  ],

  lua: [
    { regex: /(?:local\s+)?function\s+(\w[\w.]*)/, kind: 'def', type: 'function' },
    { regex: /(\w+)\s*=\s*function\s*\(/, kind: 'def', type: 'function' },
    { regex: /(?:local\s+)?(\w+)\s*=\s*require\s*[("']/, kind: 'ref', type: 'import' },
  ],

  dart: [
    {
      regex: /(?:abstract\s+|base\s+|sealed\s+|final\s+)*class\s+(\w+)/,
      kind: 'def',
      type: 'class',
    },
    { regex: /mixin\s+(\w+)/, kind: 'def', type: 'class' },
    { regex: /enum\s+(\w+)/, kind: 'def', type: 'enum' },
    { regex: /extension\s+(\w+)\s+on\b/, kind: 'def', type: 'class' },
    { regex: /typedef\s+(\w+)/, kind: 'def', type: 'type' },
    { regex: /(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*(?:async\s*)?\{/, kind: 'def', type: 'function' },
    { regex: /import\s+'[^']*\/(\w+)\.dart'/, kind: 'ref', type: 'import' },
  ],

  zig: [
    { regex: /(?:pub\s+)?fn\s+(\w+)/, kind: 'def', type: 'function' },
    { regex: /(?:pub\s+)?const\s+(\w+)\s*=\s*struct\b/, kind: 'def', type: 'class' },
    { regex: /(?:pub\s+)?const\s+(\w+)\s*=\s*enum\b/, kind: 'def', type: 'enum' },
    { regex: /(?:pub\s+)?const\s+(\w+)\s*=\s*union\b/, kind: 'def', type: 'class' },
    { regex: /(?:pub\s+)?const\s+(\w+)\s*=\s*@import\b/, kind: 'ref', type: 'import' },
  ],

  elixir: [
    { regex: /defmodule\s+([\w.]+)/, kind: 'def', type: 'class' },
    { regex: /defprotocol\s+([\w.]+)/, kind: 'def', type: 'interface' },
    { regex: /def\s+(\w+[?!]?)/, kind: 'def', type: 'function' },
    { regex: /defp\s+(\w+[?!]?)/, kind: 'def', type: 'function' },
    { regex: /defmacro\s+(\w+[?!]?)/, kind: 'def', type: 'function' },
    { regex: /defstruct\b/, kind: 'def', type: 'class' },
    { regex: /alias\s+([\w.]+)/, kind: 'ref', type: 'import' },
    { regex: /import\s+([\w.]+)/, kind: 'ref', type: 'import' },
  ],

  perl: [
    { regex: /sub\s+(\w+)/, kind: 'def', type: 'function' },
    { regex: /package\s+([\w:]+)/, kind: 'def', type: 'class' },
    { regex: /use\s+([\w:]+)/, kind: 'ref', type: 'import' },
  ],

  r: [
    { regex: /(\w+)\s*<-\s*function\s*\(/, kind: 'def', type: 'function' },
    { regex: /(\w+)\s*=\s*function\s*\(/, kind: 'def', type: 'function' },
    { regex: /(?:library|require)\s*\(\s*["']?(\w+)/, kind: 'ref', type: 'import' },
  ],
};

/**
 * Check if a line is a comment (heuristic: first non-whitespace matches a comment prefix).
 */
function isCommentLine(line: string, prefixes: string[]): boolean {
  const trimmed = line.trimStart();
  return prefixes.some((p) => trimmed.startsWith(p));
}

/**
 * Parse a source file using regex-based extraction.
 * Fallback for languages without tree-sitter WASM grammars.
 */
export function parseFileRegex(filePath: string, relativePath: string): Tag[] {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  const language = REGEX_EXTENSIONS[ext];
  if (!language) return [];

  const patterns = PATTERNS[language];
  if (!patterns) return [];

  let source: string;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const tags: Tag[] = [];
  const commentPrefixes = COMMENT_PREFIXES[language] ?? [];
  const lines = source.split('\n');
  const seen = new Set<string>(); // deduplicate within a file

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line.trim() || isCommentLine(line, commentPrefixes)) continue;

    for (const rule of patterns) {
      const match = line.match(rule.regex);
      if (!match || !match[1]) continue;

      const name = match[1];

      // Skip very short names (single char) and common keywords
      if (name.length < 2) continue;

      const key = `${rule.kind}:${name}:${rule.type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      tags.push({
        name,
        kind: rule.kind,
        line: i + 1,
        file: relativePath,
        type: rule.type,
      });

      // Only match the first pattern per line (avoid double-counting)
      break;
    }
  }

  return tags;
}

/**
 * Check if a file extension is supported by the regex parser.
 */
export function isRegexSupportedExtension(ext: string): boolean {
  return ext in REGEX_EXTENSIONS;
}

/**
 * Get the language name for a regex-supported extension.
 */
export function getRegexLanguageForExtension(ext: string): string | undefined {
  return REGEX_EXTENSIONS[ext];
}
