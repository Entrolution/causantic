/**
 * Project directory scanner.
 * Walks the project directory, filters by gitignore patterns,
 * and collects source files for tree-sitter parsing.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';

/** Supported language extensions. */
const SUPPORTED_EXTENSIONS = new Set([
  // TypeScript / JavaScript
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs',
  // Python
  '.py', '.pyi',
  // Java
  '.java',
  // C
  '.c', '.h',
  // C++
  '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx',
  // Rust
  '.rs',
  // Go
  '.go',
  // Ruby
  '.rb',
  // C#
  '.cs',
  // PHP
  '.php',
  // Bash / Shell
  '.sh', '.bash',
  // Regex-parsed languages (no tree-sitter WASM)
  '.scala', '.sc',
  '.kt', '.kts',
  '.swift',
  '.hs', '.lhs',
  '.lua',
  '.dart',
  '.zig',
  '.ex', '.exs',
  '.pl', '.pm',
  '.r', '.R',
]);

/** Directories always skipped regardless of gitignore. */
const ALWAYS_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.claude',
]);

/** Maximum files to scan (safety limit). */
const MAX_FILES = 10_000;

export interface ScanOptions {
  /** Additional extensions to include (e.g., ['.py', '.rs']). */
  extraExtensions?: string[];
  /** Additional directories to skip. */
  skipDirs?: string[];
  /** Maximum files to collect. Default: 10000. */
  maxFiles?: number;
}

export interface ScannedFile {
  /** Absolute path to the file. */
  absolutePath: string;
  /** Path relative to project root. */
  relativePath: string;
  /** File extension (e.g., '.ts'). */
  extension: string;
  /** File modification time (ms since epoch). */
  mtimeMs: number;
}

/**
 * Parse a .gitignore file into a list of patterns.
 * Returns simple patterns — not a full gitignore implementation,
 * but handles the common cases (directory patterns, negation skipped).
 */
function parseGitignore(projectRoot: string): Set<string> {
  const patterns = new Set<string>();
  const gitignorePath = join(projectRoot, '.gitignore');

  if (!existsSync(gitignorePath)) return patterns;

  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip comments, empty lines, negation patterns
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
      // Strip trailing slashes for directory patterns
      const pattern = trimmed.replace(/\/+$/, '');
      if (pattern) patterns.add(pattern);
    }
  } catch {
    // Can't read gitignore — continue without it
  }

  return patterns;
}

/**
 * Check if a directory or file name matches any gitignore pattern.
 * Simplified matcher: checks basename against patterns.
 */
function isIgnored(name: string, relativePath: string, patterns: Set<string>): boolean {
  if (patterns.has(name)) return true;
  // Check path-based patterns (e.g., "src/generated")
  for (const pattern of patterns) {
    if (pattern.includes('/') && relativePath.startsWith(pattern)) return true;
    // Glob patterns with wildcards
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (regex.test(name) || regex.test(relativePath)) return true;
    }
  }
  return false;
}

/**
 * Scan a project directory for source files.
 *
 * @param projectRoot - Absolute path to the project root
 * @param options - Scan options
 * @returns List of scanned source files, sorted by relative path
 */
export function scanProject(projectRoot: string, options: ScanOptions = {}): ScannedFile[] {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const skipDirs = new Set([...ALWAYS_SKIP, ...(options.skipDirs ?? [])]);
  const extensions = new Set([...SUPPORTED_EXTENSIONS, ...(options.extraExtensions ?? [])]);
  const gitignorePatterns = parseGitignore(projectRoot);
  const files: ScannedFile[] = [];

  function walk(dir: string): void {
    if (files.length >= maxFiles) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Permission denied or other read error
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return;

      const name = entry.name;
      const fullPath = join(dir, name);
      const relPath = relative(projectRoot, fullPath);

      if (entry.isDirectory()) {
        if (skipDirs.has(name)) continue;
        if (name.startsWith('.')) continue;
        if (isIgnored(name, relPath, gitignorePatterns)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(name);
        if (!extensions.has(ext)) continue;
        if (isIgnored(name, relPath, gitignorePatterns)) continue;

        try {
          const stat = statSync(fullPath);
          files.push({
            absolutePath: fullPath,
            relativePath: relPath,
            extension: ext,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // Can't stat file — skip
        }
      }
    }
  }

  walk(projectRoot);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}
