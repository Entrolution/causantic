/**
 * Tests for the init CLI command handler.
 *
 * All step functions are internal to init.ts — we test through initCommand.handler().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';

// ── Mock dependencies before importing the command ──────────────────────────

vi.mock('node:fs');
vi.mock('node:os');

vi.mock('../../../src/storage/db.js', () => ({
  getDb: vi.fn(),
  storeDbKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/storage/chunk-store.js', () => ({
  getChunkCount: vi.fn().mockReturnValue(0),
}));

vi.mock('../../../src/utils/secret-store.js', () => ({
  createSecretStore: vi.fn(),
}));

vi.mock('../../../src/cli/utils.js', () => ({
  promptPassword: vi.fn(),
  promptYesNo: vi.fn().mockResolvedValue(false),
  promptUser: vi.fn().mockResolvedValue('n'),
}));

vi.mock('../../../src/maintenance/scheduler.js', () => ({
  runTask: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
}));

vi.mock('../../../src/storage/vector-store.js', () => ({
  vectorStore: { count: vi.fn().mockResolvedValue(0) },
}));

vi.mock('../../../src/storage/encryption.js', () => ({
  generatePassword: vi.fn().mockReturnValue('mock-password-32-chars-long!!!!'),
}));

vi.mock('../../../src/cli/skill-templates.js', () => ({
  CAUSANTIC_SKILLS: [{ dirName: 'causantic-test-skill', content: '# Test Skill Content' }],
  getMinimalClaudeMdBlock: vi
    .fn()
    .mockReturnValue(
      '<!-- CAUSANTIC_MEMORY_START -->\n## Memory (Causantic)\nMemory block\n<!-- CAUSANTIC_MEMORY_END -->',
    ),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { initCommand } from '../../../src/cli/commands/init.js';
import { getDb } from '../../../src/storage/db.js';
import { promptYesNo } from '../../../src/cli/utils.js';

const mockFs = vi.mocked(fs);
const mockOs = vi.mocked(os);
const mockGetDb = vi.mocked(getDb);
const mockPromptYesNo = vi.mocked(promptYesNo);

// ── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_HOME = '/mock/home';
const CAUSANTIC_DIR = `${MOCK_HOME}/.causantic`;
const CLAUDE_CONFIG_PATH = `${MOCK_HOME}/.claude/settings.json`;

/** Build a mock database object that satisfies getDb() consumers. */
function createMockDb() {
  return {
    prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ 1: 1 }) }),
  };
}

/** Build a minimal valid Claude Code settings.json. */
function makeClaudeConfig(
  mcpServers: Record<string, unknown> = {},
  hooks?: Record<string, unknown[]>,
) {
  return JSON.stringify({ mcpServers, ...(hooks ? { hooks } : {}) }, null, 2);
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  // Default: stdin is NOT a TTY (skips encryption, ingest, project mcp patching)
  Object.defineProperty(process.stdin, 'isTTY', {
    value: false,
    writable: true,
    configurable: true,
  });

  // Baseline fs mocks
  mockFs.existsSync.mockReturnValue(true);
  mockFs.mkdirSync.mockReturnValue(undefined as any);
  mockFs.writeFileSync.mockReturnValue(undefined);
  mockFs.readFileSync.mockReturnValue(makeClaudeConfig());
  mockFs.readdirSync.mockReturnValue([] as any);

  // Baseline os mocks
  mockOs.homedir.mockReturnValue(MOCK_HOME);
  mockOs.userInfo.mockReturnValue({ username: 'testuser' } as any);

  // Database mock
  mockGetDb.mockReturnValue(createMockDb() as any);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('initCommand', () => {
  it('has correct name, description, and usage', () => {
    expect(initCommand.name).toBe('init');
    expect(initCommand.description).toContain('Initialize');
    expect(initCommand.usage).toContain('--skip-mcp');
    expect(initCommand.usage).toContain('--skip-encryption');
    expect(initCommand.usage).toContain('--skip-ingest');
  });

  // ── checkNodeVersion ────────────────────────────────────────────────────

  describe('checkNodeVersion', () => {
    it('prints success message with current Node version', async () => {
      await initCommand.handler(['--skip-mcp']);

      const nodeVersion = process.versions.node;
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(nodeVersion));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('\u2713'));
      expect(process.exit).not.toHaveBeenCalledWith(1);
    });
  });

  // ── createDirectoryStructure ────────────────────────────────────────────

  describe('createDirectoryStructure', () => {
    it('creates directories when they do not exist', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s === CAUSANTIC_DIR || s === `${CAUSANTIC_DIR}/vectors`) return false;
        // Return true for claude config and other paths
        return true;
      });

      await initCommand.handler(['--skip-mcp']);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(CAUSANTIC_DIR, { recursive: true });
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(`${CAUSANTIC_DIR}/vectors`, {
        recursive: true,
      });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Created ${CAUSANTIC_DIR}`));
    });

    it('skips creation when directories already exist', async () => {
      // Default existsSync returns true
      await initCommand.handler(['--skip-mcp']);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Directory exists: ${CAUSANTIC_DIR}`),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Directory exists: ${CAUSANTIC_DIR}/vectors`),
      );
    });
  });

  // ── initializeDatabase ──────────────────────────────────────────────────

  describe('initializeDatabase', () => {
    it('succeeds when getDb returns a working database', async () => {
      await initCommand.handler(['--skip-mcp']);

      expect(mockGetDb).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database initialized'));
      expect(process.exit).not.toHaveBeenCalledWith(1);
    });

    it('exits(1) when getDb throws an error', async () => {
      mockGetDb.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      await initCommand.handler(['--skip-mcp']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database error'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('DB connection failed'));
      // process.exit is mocked so execution continues
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('reports encryption status when encryption was enabled', async () => {
      // Enable TTY, make setupEncryption run and return true
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      mockPromptYesNo.mockResolvedValue(true);

      // setupEncryption checks dbPath existence
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        // DB file does not exist yet (skip migration path)
        if (s === `${CAUSANTIC_DIR}/memory.db`) return false;
        // config.json does not exist (fresh install)
        if (s === `${CAUSANTIC_DIR}/config.json`) return false;
        return true;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) return makeClaudeConfig();
        return '';
      });

      await initCommand.handler([]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database initialized'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('(encrypted)'));
    });
  });

  // ── configureMcp ────────────────────────────────────────────────────────

  describe('configureMcp', () => {
    it('warns when Claude config file not found', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) return false;
        return true;
      });

      await initCommand.handler([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Claude Code config not found'),
      );
    });

    it('migrates old "memory" key to "causantic"', async () => {
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({ memory: { command: 'npx', args: ['causantic', 'serve'] } });
        }
        return '';
      });

      await initCommand.handler([]);

      // Should have written config with causantic key
      const writeCalls = mockFs.writeFileSync.mock.calls.filter(
        (c) => String(c[0]) === CLAUDE_CONFIG_PATH,
      );
      expect(writeCalls.length).toBeGreaterThan(0);
      const written = JSON.parse(writeCalls[0][1] as string);
      expect(written.mcpServers.causantic).toBeDefined();
      expect(written.mcpServers.memory).toBeUndefined();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Migrated config: memory'));
    });

    it('updates causantic config from npx to absolute paths', async () => {
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({ causantic: { command: 'npx', args: ['causantic', 'serve'] } });
        }
        return '';
      });

      await initCommand.handler([]);

      const writeCalls = mockFs.writeFileSync.mock.calls.filter(
        (c) => String(c[0]) === CLAUDE_CONFIG_PATH,
      );
      expect(writeCalls.length).toBeGreaterThan(0);
      const written = JSON.parse(writeCalls[0][1] as string);
      expect(written.mcpServers.causantic.command).toBe(process.execPath);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Updated Causantic config to use absolute paths'),
      );
    });

    it('skips when causantic is already configured with correct paths', async () => {
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['some/path', 'serve'] },
          });
        }
        return '';
      });

      await initCommand.handler([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Causantic already configured in Claude Code'),
      );
    });

    it('prompts to add causantic when not present and user accepts', async () => {
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) return makeClaudeConfig({});
        return '';
      });
      mockPromptYesNo.mockResolvedValue(true);

      await initCommand.handler([]);

      expect(mockPromptYesNo).toHaveBeenCalledWith(
        'Add Causantic to Claude Code MCP config?',
        true,
      );
      const writeCalls = mockFs.writeFileSync.mock.calls.filter(
        (c) => String(c[0]) === CLAUDE_CONFIG_PATH,
      );
      expect(writeCalls.length).toBeGreaterThan(0);
      const written = JSON.parse(writeCalls[0][1] as string);
      expect(written.mcpServers.causantic).toBeDefined();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Added Causantic to Claude Code config'),
      );
    });

    it('does not add causantic when user declines', async () => {
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) return makeClaudeConfig({});
        return '';
      });
      mockPromptYesNo.mockResolvedValue(false);

      await initCommand.handler([]);

      // The write calls for the config should only be for hooks, not for MCP server addition
      const writeCalls = mockFs.writeFileSync.mock.calls.filter(
        (c) => String(c[0]) === CLAUDE_CONFIG_PATH,
      );
      // Hooks still write to the file, but none of the writes should contain causantic in mcpServers
      for (const call of writeCalls) {
        const written = JSON.parse(call[1] as string);
        if (written.mcpServers) {
          expect(written.mcpServers.causantic).toBeUndefined();
        }
      }
    });

    it('handles unparseable config gracefully', async () => {
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) return 'not valid json {{{';
        return '';
      });

      await initCommand.handler([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Could not parse Claude Code config'),
      );
    });
  });

  // ── configureHooks ──────────────────────────────────────────────────────

  describe('configureHooks', () => {
    it('adds hooks when not present', async () => {
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['x', 'serve'] },
          });
        }
        return '';
      });

      await initCommand.handler([]);

      const writeCalls = mockFs.writeFileSync.mock.calls.filter(
        (c) => String(c[0]) === CLAUDE_CONFIG_PATH,
      );
      // Find the write that includes hooks
      const hooksWrite = writeCalls.find((c) => {
        const parsed = JSON.parse(c[1] as string);
        return parsed.hooks;
      });
      expect(hooksWrite).toBeDefined();
      const written = JSON.parse(hooksWrite![1] as string);
      expect(written.hooks.PreCompact).toBeDefined();
      expect(written.hooks.SessionStart).toBeDefined();
      expect(written.hooks.SessionEnd).toBeDefined();
      expect(written.hooks.PreCompact[0].hooks[0].command).toContain('hook pre-compact');
      expect(written.hooks.SessionStart[0].hooks[0].command).toContain('hook session-start');
      expect(written.hooks.SessionEnd[0].hooks[0].command).toContain('hook session-end');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Configured 3 Claude Code hooks'),
      );
    });

    it('skips when hooks are already configured', async () => {
      const existingHooks = {
        PreCompact: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'node /some/path causantic hook pre-compact' }],
          },
        ],
        SessionStart: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'node /some/path causantic hook session-start' }],
          },
        ],
        SessionEnd: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'node /some/path causantic hook session-end' }],
          },
        ],
      };
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return JSON.stringify(
            {
              mcpServers: { causantic: { command: process.execPath, args: ['x', 'serve'] } },
              hooks: existingHooks,
            },
            null,
            2,
          );
        }
        return '';
      });

      await initCommand.handler([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Claude Code hooks already configured'),
      );
    });

    it('handles unreadable config gracefully', async () => {
      // First readFileSync call (for configureMcp) returns valid JSON
      // Second call (for configureHooks) throws
      let callCount = 0;
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          callCount++;
          if (callCount <= 1)
            return makeClaudeConfig({
              causantic: { command: process.execPath, args: ['x', 'serve'] },
            });
          throw new Error('Read error');
        }
        return '';
      });

      await initCommand.handler([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Could not configure Claude Code hooks'),
      );
    });
  });

  // ── installSkillsAndClaudeMd ────────────────────────────────────────────

  describe('installSkillsAndClaudeMd', () => {
    it('installs skills to ~/.claude/skills/', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        // Skill dir does not exist yet
        if (s.includes('skills/causantic-test-skill')) return false;
        return true;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['x', 'serve'] },
          });
        }
        // CLAUDE.md exists with existing content
        if (s.includes('CLAUDE.md')) return '# My Claude Config\n';
        return '';
      });

      await initCommand.handler([]);

      const skillDirCreate = mockFs.mkdirSync.mock.calls.find((c) =>
        String(c[0]).includes('causantic-test-skill'),
      );
      expect(skillDirCreate).toBeDefined();

      const skillWrite = mockFs.writeFileSync.mock.calls.find((c) =>
        String(c[0]).includes('SKILL.md'),
      );
      expect(skillWrite).toBeDefined();
      expect(skillWrite![1]).toBe('# Test Skill Content');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Installed 1 Causantic skills'),
      );
    });

    it('creates CLAUDE.md when it does not exist', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.includes('CLAUDE.md')) return false;
        return true;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['x', 'serve'] },
          });
        }
        return '';
      });

      await initCommand.handler([]);

      const claudeMdWrite = mockFs.writeFileSync.mock.calls.find((c) =>
        String(c[0]).includes('CLAUDE.md'),
      );
      expect(claudeMdWrite).toBeDefined();
      expect(claudeMdWrite![1]).toContain('CAUSANTIC_MEMORY_START');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Added Causantic reference to CLAUDE.md'),
      );
    });

    it('updates existing CLAUDE.md section when markers are present', async () => {
      const existingClaudeMd =
        '# Config\n<!-- CAUSANTIC_MEMORY_START -->\nOld content\n<!-- CAUSANTIC_MEMORY_END -->\n# Other';

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['x', 'serve'] },
          });
        }
        if (s.includes('CLAUDE.md')) return existingClaudeMd;
        return '';
      });

      await initCommand.handler([]);

      const claudeMdWrite = mockFs.writeFileSync.mock.calls.find((c) =>
        String(c[0]).includes('CLAUDE.md'),
      );
      expect(claudeMdWrite).toBeDefined();
      const content = claudeMdWrite![1] as string;
      expect(content).toContain('# Config\n');
      expect(content).toContain('CAUSANTIC_MEMORY_START');
      expect(content).not.toContain('Old content');
      expect(content).toContain('# Other');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Updated CLAUDE.md with skill references'),
      );
    });

    it('appends to existing CLAUDE.md when no markers are present', async () => {
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['x', 'serve'] },
          });
        }
        if (s.includes('CLAUDE.md')) return '# My Claude Config\n';
        return '';
      });

      await initCommand.handler([]);

      const claudeMdWrite = mockFs.writeFileSync.mock.calls.find((c) =>
        String(c[0]).includes('CLAUDE.md'),
      );
      expect(claudeMdWrite).toBeDefined();
      const content = claudeMdWrite![1] as string;
      expect(content).toContain('# My Claude Config');
      expect(content).toContain('CAUSANTIC_MEMORY_START');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Added Causantic reference to CLAUDE.md'),
      );
    });
  });

  // ── runHealthCheck ──────────────────────────────────────────────────────

  describe('runHealthCheck', () => {
    it('reports vector store OK', async () => {
      await initCommand.handler(['--skip-mcp']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Vector store OK'));
    });

    it('reports vector store error without exiting', async () => {
      const { vectorStore } = await import('../../../src/storage/vector-store.js');
      vi.mocked(vectorStore.count).mockRejectedValueOnce(new Error('Vector file missing'));

      await initCommand.handler(['--skip-mcp']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Vector store:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Vector file missing'));
      // Should NOT exit — health check is non-fatal
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ── Handler orchestration / flags ───────────────────────────────────────

  describe('handler orchestration', () => {
    it('--skip-mcp skips MCP configuration, hooks, and skills', async () => {
      await initCommand.handler(['--skip-mcp']);

      // Should not attempt to read Claude config for MCP
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Claude Code config found'),
      );
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Claude Code config not found'),
      );
      // Should not install skills
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Installed'));
      // Should still run health check and db init
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database initialized'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Vector store OK'));
    });

    it('--skip-encryption skips encryption setup even with TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

      await initCommand.handler(['--skip-mcp', '--skip-encryption', '--skip-ingest']);

      // Should not prompt for encryption
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Enable database encryption'),
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database initialized'));
    });

    it('skips encryption when stdin is not a TTY', async () => {
      // Default: isTTY is false
      await initCommand.handler(['--skip-mcp']);

      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Enable database encryption'),
      );
    });

    it('skips batch ingest when stdin is not a TTY', async () => {
      await initCommand.handler([]);

      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Existing Claude Code sessions found'),
      );
    });

    it('--skip-ingest skips batch ingest even with TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

      // Need MCP config to be parseable for the full path
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['x', 'serve'] },
          });
        }
        if (s.includes('CLAUDE.md')) return '';
        return '';
      });

      // patchProjectMcpFiles needs this
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.includes('.claude/projects')) return false;
        return true;
      });

      await initCommand.handler(['--skip-ingest', '--skip-encryption']);

      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Existing Claude Code sessions found'),
      );
    });

    it('prints setup header and completion message', async () => {
      await initCommand.handler(['--skip-mcp']);

      expect(console.log).toHaveBeenCalledWith('Causantic - Setup');
      expect(console.log).toHaveBeenCalledWith('=================');
      expect(console.log).toHaveBeenCalledWith('Setup complete!');
    });

    it('prints batch-ingest next step when not interactive', async () => {
      await initCommand.handler(['--skip-mcp']);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('npx causantic batch-ingest'),
      );
    });

    it('prints restart next step when interactive ingest ran', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

      await initCommand.handler(['--skip-mcp', '--skip-encryption']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Restart Claude Code'));
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('What did we work on recently'),
      );
    });

    it('full run with all flags skips mcp, encryption, and ingest', async () => {
      await initCommand.handler(['--skip-mcp', '--skip-encryption', '--skip-ingest']);

      // Should still run core steps
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Node.js'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database initialized'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Vector store OK'));
      expect(console.log).toHaveBeenCalledWith('Setup complete!');
    });
  });

  // ── setupEncryption ─────────────────────────────────────────────────────

  describe('setupEncryption', () => {
    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    it('skips when user declines encryption prompt', async () => {
      mockPromptYesNo.mockResolvedValue(false);

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.includes('memory.db')) return false;
        return true;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['x', 'serve'] },
          });
        }
        if (s.includes('CLAUDE.md')) return '';
        return '';
      });

      // patchProjectMcpFiles - no projects dir
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.includes('memory.db')) return false;
        if (s.includes('.claude/projects') && !s.includes('settings')) return false;
        return true;
      });

      await initCommand.handler(['--skip-ingest']);

      // Database init message should NOT say (encrypted)
      expect(console.log).toHaveBeenCalledWith('\u2713 Database initialized');
    });

    it('enables encryption when user accepts (no existing db)', async () => {
      // First call to promptYesNo = "Enable encryption?" -> yes
      // Subsequent calls might be for other prompts -> false
      let _promptCount = 0;
      mockPromptYesNo.mockImplementation(async (msg: string) => {
        _promptCount++;
        if (msg.includes('Enable encryption')) return true;
        return false;
      });

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.includes('memory.db')) return false;
        if (s.includes('config.json') && s.includes('.causantic')) return false;
        if (s.includes('.claude/projects') && !s.includes('settings')) return false;
        return true;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s === CLAUDE_CONFIG_PATH) {
          return makeClaudeConfig({
            causantic: { command: process.execPath, args: ['x', 'serve'] },
          });
        }
        if (s.includes('CLAUDE.md')) return '';
        return '';
      });

      await initCommand.handler(['--skip-ingest']);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Key stored in system keychain'),
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Encryption enabled'));
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Database initialized (encrypted)'),
      );
    });
  });
});
