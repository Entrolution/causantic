/**
 * Lexical feature extraction for topic continuity classification.
 *
 * Extracted from eval/experiments/topic-continuity/lexical-features.ts
 * so production code does not import from experimental directories.
 *
 * Contains the pure text-analysis functions used by production edge detection.
 * Eval-only functions (that depend on TransitionFeatures) remain in the eval module.
 */

/** Patterns indicating explicit topic shift. */
const TOPIC_SHIFT_PATTERNS = [
  /^actually,?\s*(let'?s?|can we|could we)/i,
  /^(new|different|another)\s+(question|topic|issue)/i,
  /^switching\s+(to|gears)/i,
  /^(on|about)\s+a\s+(different|separate)\s+(note|topic)/i,
  /^(ok|okay),?\s*(so|now)\s+/i,
  /^moving\s+on/i,
  /^forget\s+(about\s+)?(that|this)/i,
  /^let'?s\s+(change|switch|move)/i,
  /^(unrelated|separate)\s*(question|topic|issue)?/i,
  /^(btw|by the way)/i,
];

/** Patterns indicating continuation of the previous topic. */
const CONTINUATION_PATTERNS = [
  /^(yes|no|right|correct|exactly)/i,
  /^(it|that|this)\s+(is|was|shows|works|doesn'?t)/i,
  /^(the|your)\s+(error|output|result|fix|solution)/i,
  /^(thanks|thank\s+you)/i,
  /^(ok|okay|got\s+it|makes\s+sense)/i,
  /^(but|however|although|though)/i,
  /^(also|additionally|and\s+also)/i,
  /^(what\s+about|how\s+about)/i,
  /^(can you|could you)\s+(also|explain|show)/i,
  /^(I\s+(see|understand|get\s+it))/i,
];

/** Common file extensions for file path detection. */
const FILE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyi',
  'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'json', 'yaml', 'yml', 'toml',
  'md', 'txt', 'html', 'css', 'scss',
  'sh', 'bash', 'zsh',
  'sql', 'graphql',
  'dockerfile', 'makefile',
];

/** Pattern to match file paths. */
const FILE_PATH_PATTERN = new RegExp(
  `(?:^|\\s|["\`'(])([\\w./-]+\\.(?:${FILE_EXTENSIONS.join('|')}))(?:["\`')]|\\s|$|:)`,
  'gi',
);

/** Pattern to match directory paths. */
const DIR_PATH_PATTERN = /(?:^|\s|["`'(])((?:\/|\.\/|\.\.\/|~\/)?[\w.-]+(?:\/[\w.-]+)+)(?:["`')]|\s|$|:)/gi;

/** Stop words to exclude from keyword extraction. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'it', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which', 'who',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'same',
  'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there',
  'then', 'if', 'else', 'because', 'while', 'although', 'though', 'after',
  'before', 'until', 'unless', 'since', 'let', 'me', 'my', 'your', 'its',
  'our', 'their', 'about', 'into', 'over', 'under', 'again', 'further',
  'once', 'during', 'out', 'up', 'down', 'off', 'between', 'through',
]);

/**
 * Check if text contains topic-shift markers.
 */
export function hasTopicShiftMarker(text: string): boolean {
  const trimmed = text.trim();
  return TOPIC_SHIFT_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Check if text contains continuation markers.
 */
export function hasContinuationMarker(text: string): boolean {
  const trimmed = text.trim();
  return CONTINUATION_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Extract file paths from text.
 */
export function extractFilePaths(text: string): Set<string> {
  const paths = new Set<string>();

  // Match explicit file paths with extensions
  let match: RegExpExecArray | null;
  const filePattern = new RegExp(FILE_PATH_PATTERN.source, 'gi');
  while ((match = filePattern.exec(text)) !== null) {
    paths.add(normalizeFilePath(match[1]));
  }

  // Match directory paths
  const dirPattern = new RegExp(DIR_PATH_PATTERN.source, 'gi');
  while ((match = dirPattern.exec(text)) !== null) {
    paths.add(normalizeFilePath(match[1]));
  }

  return paths;
}

/**
 * Normalize a file path for comparison.
 */
function normalizeFilePath(path: string): string {
  // Remove leading ./ and convert to lowercase for comparison
  return path.replace(/^\.\//, '').toLowerCase();
}

/**
 * Compute overlap between two sets.
 * Returns Jaccard coefficient: |A ∩ B| / |A ∪ B|.
 */
function setOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Compute file path overlap between two texts.
 */
export function computeFilePathOverlap(textA: string, textB: string): number {
  const pathsA = extractFilePaths(textA);
  const pathsB = extractFilePaths(textB);
  return setOverlap(pathsA, pathsB);
}

/**
 * Extract significant keywords from text.
 */
export function extractKeywords(text: string): Set<string> {
  const keywords = new Set<string>();

  // Split on non-alphanumeric, convert to lowercase
  const tokens = text.toLowerCase().split(/[^a-z0-9_]+/);

  for (const token of tokens) {
    // Skip short tokens, stop words, and pure numbers
    if (token.length < 3) continue;
    if (STOP_WORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;

    keywords.add(token);
  }

  return keywords;
}

/**
 * Compute keyword overlap between two texts.
 */
export function computeKeywordOverlap(textA: string, textB: string): number {
  const keywordsA = extractKeywords(textA);
  const keywordsB = extractKeywords(textB);
  return setOverlap(keywordsA, keywordsB);
}
