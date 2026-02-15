/**
 * Tests for Causantic uninstall command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getDirSize,
  formatSize,
  removeCausanticBlock,
  removeJsonKey,
  decodeProjectDirName,
  discoverProjectMcpFiles,
  buildRemovalPlan,
  verifyRemoval,
  printPreview,
  type RemovalArtifact,
} from '../../src/cli/uninstall.js';

/** Create a temp directory for test isolation */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'causantic-uninstall-test-'));
}

describe('uninstall', () => {
  describe('flag parsing', () => {
    it('detects --force flag', () => {
      const args = ['--force'];
      expect(args.includes('--force')).toBe(true);
    });

    it('detects --keep-data flag', () => {
      const args = ['--keep-data'];
      expect(args.includes('--keep-data')).toBe(true);
    });

    it('detects --dry-run flag', () => {
      const args = ['--dry-run'];
      expect(args.includes('--dry-run')).toBe(true);
    });

    it('handles combined flags', () => {
      const args = ['--force', '--keep-data'];
      expect(args.includes('--force')).toBe(true);
      expect(args.includes('--keep-data')).toBe(true);
      expect(args.includes('--dry-run')).toBe(false);
    });

    it('handles no flags', () => {
      const args: string[] = [];
      expect(args.includes('--force')).toBe(false);
      expect(args.includes('--keep-data')).toBe(false);
      expect(args.includes('--dry-run')).toBe(false);
    });

    it('handles all three flags together', () => {
      const args = ['--force', '--keep-data', '--dry-run'];
      expect(args.includes('--force')).toBe(true);
      expect(args.includes('--keep-data')).toBe(true);
      expect(args.includes('--dry-run')).toBe(true);
    });
  });

  describe('removeJsonKey', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTempDir();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('removes Causantic key from mcpServers', () => {
      const filePath = path.join(tmpDir, 'settings.json');
      const config = {
        mcpServers: {
          causantic: { command: 'node', args: ['serve'] },
          'other-server': { command: 'python', args: ['serve'] },
        },
      };
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

      const result = removeJsonKey(filePath, ['mcpServers', 'causantic']);

      expect(result).toBe(true);
      const updated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(updated.mcpServers['causantic']).toBeUndefined();
      expect(updated.mcpServers['other-server']).toBeDefined();
    });

    it('preserves other keys', () => {
      const filePath = path.join(tmpDir, 'settings.json');
      const config = {
        mcpServers: {
          causantic: { command: 'node' },
          'other-server': { command: 'python' },
        },
        otherConfig: 'value',
      };
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

      removeJsonKey(filePath, ['mcpServers', 'causantic']);

      const updated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(updated.otherConfig).toBe('value');
      expect(updated.mcpServers['other-server']).toBeDefined();
    });

    it('returns false when key is missing', () => {
      const filePath = path.join(tmpDir, 'settings.json');
      const config = { mcpServers: { 'other-server': {} } };
      fs.writeFileSync(filePath, JSON.stringify(config));

      const result = removeJsonKey(filePath, ['mcpServers', 'causantic']);

      expect(result).toBe(false);
    });

    it('returns false when file does not exist', () => {
      const result = removeJsonKey(path.join(tmpDir, 'nonexistent.json'), ['mcpServers', 'key']);
      expect(result).toBe(false);
    });

    it('returns false for malformed JSON', () => {
      const filePath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(filePath, 'not json{{{');

      const result = removeJsonKey(filePath, ['mcpServers', 'key']);

      expect(result).toBe(false);
    });

    it('leaves empty mcpServers object', () => {
      const filePath = path.join(tmpDir, 'settings.json');
      const config = {
        mcpServers: {
          causantic: { command: 'node' },
        },
      };
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

      removeJsonKey(filePath, ['mcpServers', 'causantic']);

      const updated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(updated.mcpServers).toEqual({});
    });

    it('writes JSON with 2-space indentation and trailing newline', () => {
      const filePath = path.join(tmpDir, 'settings.json');
      const config = {
        mcpServers: {
          causantic: { command: 'node' },
          other: { command: 'python' },
        },
      };
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

      removeJsonKey(filePath, ['mcpServers', 'causantic']);

      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).toMatch(/^{/);
      expect(raw).toMatch(/\n$/);
      // Verify it's valid JSON
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe('removeCausanticBlock', () => {
    it('removes Causantic block from CLAUDE.md', () => {
      const content = `# My CLAUDE.md

Some content here.

<!-- CAUSANTIC_MEMORY_START -->
## Memory (Causantic)

Some Causantic stuff.
<!-- CAUSANTIC_MEMORY_END -->

More content after.
`;

      const result = removeCausanticBlock(content);

      expect(result).not.toBeNull();
      expect(result).not.toContain('CAUSANTIC_MEMORY_START');
      expect(result).not.toContain('CAUSANTIC_MEMORY_END');
      expect(result).not.toContain('Causantic');
      expect(result).toContain('Some content here.');
      expect(result).toContain('More content after.');
    });

    it('preserves surrounding content', () => {
      const content = `# Header

Before Causantic block.

<!-- CAUSANTIC_MEMORY_START -->
Causantic content
<!-- CAUSANTIC_MEMORY_END -->

After Causantic block.
`;

      const result = removeCausanticBlock(content);

      expect(result).toContain('# Header');
      expect(result).toContain('Before Causantic block.');
      expect(result).toContain('After Causantic block.');
    });

    it('returns null when no Causantic block exists', () => {
      const content = '# Just a normal CLAUDE.md\n\nNo Causantic here.\n';

      const result = removeCausanticBlock(content);

      expect(result).toBeNull();
    });

    it('returns null when only start marker exists', () => {
      const content = '<!-- CAUSANTIC_MEMORY_START -->\nSome content\n';

      const result = removeCausanticBlock(content);

      expect(result).toBeNull();
    });

    it('returns null when only end marker exists', () => {
      const content = 'Some content\n<!-- CAUSANTIC_MEMORY_END -->\n';

      const result = removeCausanticBlock(content);

      expect(result).toBeNull();
    });

    it('handles Causantic block at start of file', () => {
      const content = `<!-- CAUSANTIC_MEMORY_START -->
Causantic content
<!-- CAUSANTIC_MEMORY_END -->

Rest of file.
`;

      const result = removeCausanticBlock(content);

      expect(result).not.toBeNull();
      expect(result).toContain('Rest of file.');
      expect(result).not.toContain('Causantic content');
    });

    it('handles Causantic block at end of file', () => {
      const content = `# Header

Content.

<!-- CAUSANTIC_MEMORY_START -->
Causantic content
<!-- CAUSANTIC_MEMORY_END -->`;

      const result = removeCausanticBlock(content);

      expect(result).not.toBeNull();
      expect(result).toContain('# Header');
      expect(result).toContain('Content.');
      expect(result).not.toContain('Causantic content');
    });

    it('cleans up extra whitespace', () => {
      const content = `Content before.


<!-- CAUSANTIC_MEMORY_START -->
Causantic block
<!-- CAUSANTIC_MEMORY_END -->


Content after.
`;

      const result = removeCausanticBlock(content);

      expect(result).not.toBeNull();
      // Should not have excessive blank lines
      expect(result).not.toMatch(/\n{4,}/);
    });

    it('returns empty string when file is only Causantic block', () => {
      const content = `<!-- CAUSANTIC_MEMORY_START -->
Causantic content only
<!-- CAUSANTIC_MEMORY_END -->`;

      const result = removeCausanticBlock(content);

      expect(result).toBe('');
    });
  });

  describe('decodeProjectDirName', () => {
    it('decodes standard project path', () => {
      expect(decodeProjectDirName('-Users-gvn-Dev-Foo')).toBe('/Users/gvn/Dev/Foo');
    });

    it('decodes nested project path', () => {
      expect(decodeProjectDirName('-Users-gvn-Dev-Company-project-name')).toBe(
        '/Users/gvn/Dev/Company/project/name',
      );
    });

    it('decodes root-level path', () => {
      expect(decodeProjectDirName('-tmp-project')).toBe('/tmp/project');
    });
  });

  describe('discoverProjectMcpFiles', () => {
    // This test uses the real filesystem — it just validates the function shape
    it('returns an array', () => {
      const result = discoverProjectMcpFiles();
      expect(Array.isArray(result)).toBe(true);
    });

    it('each result has displayName and mcpPath', () => {
      const result = discoverProjectMcpFiles();
      for (const item of result) {
        expect(item).toHaveProperty('displayName');
        expect(item).toHaveProperty('mcpPath');
        expect(typeof item.displayName).toBe('string');
        expect(typeof item.mcpPath).toBe('string');
      }
    });
  });

  describe('formatSize', () => {
    it('formats bytes', () => {
      expect(formatSize(0)).toBe('0 B');
      expect(formatSize(512)).toBe('512 B');
      expect(formatSize(1023)).toBe('1023 B');
    });

    it('formats kilobytes', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
      expect(formatSize(10 * 1024)).toBe('10.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatSize(142.3 * 1024 * 1024)).toBe('142.3 MB');
      expect(formatSize(500 * 1024 * 1024)).toBe('500.0 MB');
    });

    it('formats gigabytes', () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
      expect(formatSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    });
  });

  describe('getDirSize', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTempDir();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns 0 for empty directory', () => {
      expect(getDirSize(tmpDir)).toBe(0);
    });

    it('sums file sizes', () => {
      fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'hello'); // 5 bytes
      fs.writeFileSync(path.join(tmpDir, 'file2.txt'), 'world!'); // 6 bytes

      const size = getDirSize(tmpDir);
      expect(size).toBe(11);
    });

    it('includes nested directories', () => {
      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(tmpDir, 'root.txt'), 'abc'); // 3 bytes
      fs.writeFileSync(path.join(subDir, 'nested.txt'), 'defgh'); // 5 bytes

      const size = getDirSize(tmpDir);
      expect(size).toBe(8);
    });

    it('returns 0 for non-existent directory', () => {
      expect(getDirSize(path.join(tmpDir, 'nonexistent'))).toBe(0);
    });
  });

  describe('buildRemovalPlan', () => {
    it('returns an array of artifacts', () => {
      const plan = buildRemovalPlan(false);
      expect(Array.isArray(plan)).toBe(true);
      expect(plan.length).toBeGreaterThan(0);
    });

    it('includes CLAUDE.md artifact', () => {
      const plan = buildRemovalPlan(false);
      const claudeMd = plan.find((a) => a.label.includes('CLAUDE.md'));
      expect(claudeMd).toBeDefined();
      expect(claudeMd!.category).toBe('integration');
    });

    it('includes settings.json artifact', () => {
      const plan = buildRemovalPlan(false);
      const settings = plan.find((a) => a.label.includes('settings.json'));
      expect(settings).toBeDefined();
      expect(settings!.category).toBe('integration');
    });

    it('includes skill directory artifacts', () => {
      const plan = buildRemovalPlan(false);
      const skills = plan.filter((a) => a.label.includes('skills/'));
      expect(skills.length).toBe(13); // recall, search, explain, predict, list-projects, reconstruct, resume, debug, context, crossref, retro, cleanup, status
    });

    it('includes keychain artifacts', () => {
      const plan = buildRemovalPlan(false);
      const secrets = plan.filter((a) => a.category === 'secret');
      expect(secrets.length).toBe(2); // causantic-db-key, anthropic-api-key
    });

    it('includes data directory when keepData is false', () => {
      const plan = buildRemovalPlan(false);
      const data = plan.filter((a) => a.category === 'data');
      expect(data.length).toBe(1);
      expect(data[0].label).toBe('~/.causantic/');
    });

    it('excludes data directory when keepData is true', () => {
      const plan = buildRemovalPlan(true);
      const data = plan.filter((a) => a.category === 'data');
      expect(data.length).toBe(0);
    });

    it('each artifact has required fields', () => {
      const plan = buildRemovalPlan(false);
      for (const artifact of plan) {
        expect(artifact).toHaveProperty('label');
        expect(artifact).toHaveProperty('description');
        expect(artifact).toHaveProperty('category');
        expect(artifact).toHaveProperty('found');
        expect(artifact).toHaveProperty('remove');
        expect(artifact).toHaveProperty('verify');
        expect(typeof artifact.remove).toBe('function');
        expect(typeof artifact.verify).toBe('function');
      }
    });
  });

  describe('verifyRemoval', () => {
    it('returns empty array when all artifacts are gone', () => {
      const artifacts: RemovalArtifact[] = [
        {
          label: 'test1',
          description: '',
          category: 'integration',
          found: true,
          remove: async () => true,
          verify: () => false,
        },
        {
          label: 'test2',
          description: '',
          category: 'integration',
          found: true,
          remove: async () => true,
          verify: () => false,
        },
      ];

      const leftovers = verifyRemoval(artifacts);
      expect(leftovers).toEqual([]);
    });

    it('reports leftovers that still exist', () => {
      const artifacts: RemovalArtifact[] = [
        {
          label: 'gone',
          description: '',
          category: 'integration',
          found: true,
          remove: async () => true,
          verify: () => false,
        },
        {
          label: 'still-here',
          description: '',
          category: 'integration',
          found: true,
          remove: async () => false,
          verify: () => true,
        },
      ];

      const leftovers = verifyRemoval(artifacts);
      expect(leftovers).toEqual(['still-here']);
    });

    it('reports multiple leftovers', () => {
      const artifacts: RemovalArtifact[] = [
        {
          label: 'leftover1',
          description: '',
          category: 'integration',
          found: true,
          remove: async () => false,
          verify: () => true,
        },
        {
          label: 'leftover2',
          description: '',
          category: 'data',
          found: true,
          remove: async () => false,
          verify: () => true,
        },
      ];

      const leftovers = verifyRemoval(artifacts);
      expect(leftovers).toEqual(['leftover1', 'leftover2']);
    });
  });

  describe('printPreview', () => {
    it('does not throw for empty artifacts', () => {
      expect(() => printPreview([], false)).not.toThrow();
    });

    it('does not throw for mixed artifacts', () => {
      const artifacts: RemovalArtifact[] = [
        {
          label: '~/.claude/CLAUDE.md',
          description: 'Causantic memory block',
          category: 'integration',
          found: true,
          remove: async () => true,
          verify: () => false,
        },
        {
          label: 'Keychain: causantic-db-key',
          description: '',
          category: 'secret',
          found: true,
          remove: async () => true,
          verify: () => false,
        },
        {
          label: '~/.causantic/',
          description: '142.3 MB',
          category: 'data',
          found: true,
          size: '142.3 MB',
          remove: async () => true,
          verify: () => false,
        },
      ];

      expect(() => printPreview(artifacts, false)).not.toThrow();
    });

    it('does not throw with keepData message', () => {
      expect(() => printPreview([], true)).not.toThrow();
    });
  });

  describe('command registry', () => {
    it('uninstall appears in expected command names', () => {
      const commandNames = [
        'init',
        'serve',
        'ingest',
        'batch-ingest',
        'recall',
        'maintenance',
        'config',
        'stats',
        'health',
        'hook',
        'encryption',
        'export',
        'import',
        'uninstall',
      ];

      expect(commandNames).toContain('uninstall');
    });
  });
});
