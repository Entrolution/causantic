/**
 * Deterministic entity extraction from chunk content.
 *
 * Pure function — no LLM, no database access. Extracts mentions of
 * people, channels, meetings, organizations, and URLs using regex patterns.
 *
 * Only extracts from [User] and [Assistant] blocks; skips [Thinking] blocks
 * and code blocks (triple-backtick fencing) to reduce noise.
 */

export type EntityType = 'person' | 'channel' | 'meeting' | 'organization' | 'url';

export interface EntityMention {
  entityType: EntityType;
  mentionForm: string;
  normalizedName: string;
  confidence: number;
}

/** Words that look like names in "X said" patterns but aren't. */
const BLOCKLIST = new Set([
  // Pronouns
  'i', 'he', 'she', 'we', 'they', 'you', 'it',
  'me', 'him', 'her', 'us', 'them',
  'my', 'his', 'our', 'their', 'your', 'its',
  // Articles / determiners
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  // Common sentence starters / conjunctions
  'but', 'and', 'or', 'so', 'if', 'when', 'then', 'also',
  'just', 'now', 'here', 'there', 'what', 'who', 'how', 'why',
  'which', 'where', 'some', 'all', 'any', 'each', 'every',
  'not', 'no', 'yes', 'maybe', 'perhaps',
  // Common words that appear capitalized at start of sentences
  'however', 'therefore', 'meanwhile', 'otherwise', 'furthermore',
  'additionally', 'finally', 'first', 'second', 'third', 'next', 'last',
  // Tool/system words often capitalized
  'error', 'warning', 'note', 'todo', 'fixme', 'hack',
  'true', 'false', 'null', 'undefined', 'none',
]);

/** Meeting-related keywords. */
const MEETING_KEYWORDS = /\b(standup|stand-up|retro|retrospective|1:1|one-on-one|sync|daily|weekly|sprint\s+review|sprint\s+planning|kick-?off|all-?hands)\b/gi;

/** Email regex. */
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

/** URL regex — matches http/https URLs. */
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

/** @mention pattern (Slack/Discord style). */
const AT_MENTION_PATTERN = /@([a-zA-Z][a-zA-Z0-9._-]{0,30})\b/g;

/** #channel pattern. */
const CHANNEL_PATTERN = /#([a-zA-Z][a-zA-Z0-9_-]{0,50})\b/g;

/** "X said" / "with X" / "from X" patterns — capitalized proper nouns. */
const CONTEXTUAL_NAME_PATTERN = /\b([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)\s+(?:said|says|mentioned|asked|replied|suggested|noted|reported|confirmed|explained|wrote|responded)\b/g;
const WITH_FROM_PATTERN = /\b(?:with|from|by|to|cc|cc'd|cced)\s+([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)\b/g;

/**
 * Strip code blocks (triple-backtick fenced) from text.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/**
 * Extract only [User] and [Assistant] blocks, skipping [Thinking] blocks.
 * If no block markers found, returns the full text (non-session content).
 */
function extractRelevantBlocks(text: string): string {
  // Check if text has block markers
  if (!text.includes('[User]') && !text.includes('[Assistant]')) {
    return text;
  }

  const blocks: string[] = [];
  // Split on block headers
  const parts = text.split(/(\[(?:User|Assistant|Thinking)\])/);

  let inRelevantBlock = false;
  for (const part of parts) {
    if (part === '[User]' || part === '[Assistant]') {
      inRelevantBlock = true;
      continue;
    }
    if (part === '[Thinking]') {
      inRelevantBlock = false;
      continue;
    }
    if (inRelevantBlock) {
      blocks.push(part);
    }
  }

  return blocks.join('\n');
}

/**
 * Extract entities from chunk text.
 *
 * Returns deduplicated entity mentions with types, normalized names, and confidence scores.
 */
export function extractEntities(text: string): EntityMention[] {
  // Pre-process: skip thinking blocks and code blocks
  const relevant = extractRelevantBlocks(text);
  const cleaned = stripCodeBlocks(relevant);

  const mentions: EntityMention[] = [];
  const seen = new Set<string>(); // "type:normalized" dedup key

  function addMention(mention: EntityMention): void {
    const key = `${mention.entityType}:${mention.normalizedName}`;
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push(mention);
  }

  // @mentions → person
  for (const match of cleaned.matchAll(AT_MENTION_PATTERN)) {
    const name = match[1];
    addMention({
      entityType: 'person',
      mentionForm: `@${name}`,
      normalizedName: name.toLowerCase(),
      confidence: 0.95,
    });
  }

  // #channels → channel
  for (const match of cleaned.matchAll(CHANNEL_PATTERN)) {
    const name = match[1];
    // Skip common non-channel uses of # (hex colors, markdown headers handled by context)
    if (/^[0-9a-fA-F]{3,8}$/.test(name)) continue;
    addMention({
      entityType: 'channel',
      mentionForm: `#${name}`,
      normalizedName: name.toLowerCase(),
      confidence: 0.95,
    });
  }

  // Email addresses → person
  for (const match of cleaned.matchAll(EMAIL_PATTERN)) {
    const email = match[0];
    addMention({
      entityType: 'person',
      mentionForm: email,
      normalizedName: email.toLowerCase(),
      confidence: 0.9,
    });
  }

  // URLs → url
  for (const match of cleaned.matchAll(URL_PATTERN)) {
    const url = match[0];
    addMention({
      entityType: 'url',
      mentionForm: url,
      normalizedName: url,
      confidence: 1.0,
    });
  }

  // "X said" / "with X" patterns → person (lower confidence)
  for (const pattern of [CONTEXTUAL_NAME_PATTERN, WITH_FROM_PATTERN]) {
    pattern.lastIndex = 0; // Reset stateful regex
    for (const match of cleaned.matchAll(pattern)) {
      const name = match[1];
      const normalized = name.toLowerCase();
      // Check blocklist for each word in the name
      const words = normalized.split(/\s+/);
      if (words.some((w) => BLOCKLIST.has(w))) continue;
      addMention({
        entityType: 'person',
        mentionForm: name,
        normalizedName: normalized,
        confidence: 0.6,
      });
    }
  }

  // Meeting keywords → meeting
  MEETING_KEYWORDS.lastIndex = 0;
  for (const match of cleaned.matchAll(MEETING_KEYWORDS)) {
    const keyword = match[1];
    addMention({
      entityType: 'meeting',
      mentionForm: keyword,
      normalizedName: keyword.toLowerCase().replace(/\s+/g, '-'),
      confidence: 0.7,
    });
  }

  return mentions;
}
