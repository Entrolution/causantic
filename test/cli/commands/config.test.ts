/**
 * Tests for the config CLI command handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the command
vi.mock('../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
  validateExternalConfig: vi.fn(),
}));

vi.mock('../../../src/utils/secret-store.js', () => ({
  createSecretStore: vi.fn(),
}));

vi.mock('../../../src/cli/utils.js', () => ({
  promptUser: vi.fn(),
}));

import { configCommand } from '../../../src/cli/commands/config.js';
import { loadConfig, validateExternalConfig } from '../../../src/config/loader.js';
import { createSecretStore } from '../../../src/utils/secret-store.js';
import { promptUser } from '../../../src/cli/utils.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockValidateExternalConfig = vi.mocked(validateExternalConfig);
const mockCreateSecretStore = vi.mocked(createSecretStore);
const mockPromptUser = vi.mocked(promptUser);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

describe('configCommand', () => {
  it('has correct name and usage', () => {
    expect(configCommand.name).toBe('config');
    expect(configCommand.usage).toContain('show');
    expect(configCommand.usage).toContain('validate');
    expect(configCommand.usage).toContain('set-key');
    expect(configCommand.usage).toContain('get-key');
  });

  describe('show subcommand', () => {
    it('prints the loaded config as JSON', async () => {
      const fakeConfig = { encryption: { enabled: false }, clustering: { threshold: 0.09 } };
      mockLoadConfig.mockReturnValue(fakeConfig as ReturnType<typeof loadConfig>);

      await configCommand.handler(['show']);

      expect(mockLoadConfig).toHaveBeenCalledOnce();
      expect(console.log).toHaveBeenCalledWith(JSON.stringify(fakeConfig, null, 2));
    });
  });

  describe('validate subcommand', () => {
    it('prints success when config is valid', async () => {
      const fakeConfig = {} as ReturnType<typeof loadConfig>;
      mockLoadConfig.mockReturnValue(fakeConfig);
      mockValidateExternalConfig.mockReturnValue([]);

      await configCommand.handler(['validate']);

      expect(mockValidateExternalConfig).toHaveBeenCalledWith(fakeConfig);
      expect(console.log).toHaveBeenCalledWith('Configuration is valid.');
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('prints errors and exits with code 3 when config is invalid', async () => {
      const fakeConfig = {} as ReturnType<typeof loadConfig>;
      mockLoadConfig.mockReturnValue(fakeConfig);
      mockValidateExternalConfig.mockReturnValue([
        'clustering.threshold must be between 0 and 1 (exclusive)',
        'traversal.maxDepth must be at least 1',
      ]);

      await configCommand.handler(['validate']);

      expect(console.error).toHaveBeenCalledWith('Configuration errors:');
      expect(console.error).toHaveBeenCalledWith(
        '  - clustering.threshold must be between 0 and 1 (exclusive)',
      );
      expect(console.error).toHaveBeenCalledWith('  - traversal.maxDepth must be at least 1');
      expect(process.exit).toHaveBeenCalledWith(3);
    });
  });

  describe('set-key subcommand', () => {
    it('prompts for value and stores it', async () => {
      const mockStore = {
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn(),
        delete: vi.fn(),
        isAvailable: vi.fn(),
        type: 'test',
      };
      mockCreateSecretStore.mockReturnValue(mockStore);
      mockPromptUser.mockResolvedValue('my-secret-value');

      await configCommand.handler(['set-key', 'anthropic']);

      expect(mockPromptUser).toHaveBeenCalledWith('Enter value for anthropic: ');
      expect(mockStore.set).toHaveBeenCalledWith('anthropic', 'my-secret-value');
      expect(console.log).toHaveBeenCalledWith('Key anthropic stored.');
    });

    it('exits with code 2 when key name is missing', async () => {
      await configCommand.handler(['set-key']);

      expect(console.error).toHaveBeenCalledWith('Error: Key name required');
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });

  describe('get-key subcommand', () => {
    it('prints the value when key is found', async () => {
      const mockStore = {
        get: vi.fn().mockResolvedValue('found-value'),
        set: vi.fn(),
        delete: vi.fn(),
        isAvailable: vi.fn(),
        type: 'test',
      };
      mockCreateSecretStore.mockReturnValue(mockStore);

      await configCommand.handler(['get-key', 'anthropic']);

      expect(mockStore.get).toHaveBeenCalledWith('anthropic');
      expect(console.log).toHaveBeenCalledWith('found-value');
    });

    it('prints error and exits with code 1 when key is not found', async () => {
      const mockStore = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        delete: vi.fn(),
        isAvailable: vi.fn(),
        type: 'test',
      };
      mockCreateSecretStore.mockReturnValue(mockStore);

      await configCommand.handler(['get-key', 'nonexistent']);

      expect(console.error).toHaveBeenCalledWith('Key nonexistent not found.');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('exits with code 2 when key name is missing', async () => {
      await configCommand.handler(['get-key']);

      expect(console.error).toHaveBeenCalledWith('Error: Key name required');
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });

  describe('unknown subcommand', () => {
    it('prints error and exits with code 2', async () => {
      await configCommand.handler(['unknown']);

      expect(console.error).toHaveBeenCalledWith('Error: Unknown subcommand');
      expect(process.exit).toHaveBeenCalledWith(2);
    });

    it('handles no subcommand provided', async () => {
      await configCommand.handler([]);

      expect(console.error).toHaveBeenCalledWith('Error: Unknown subcommand');
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });
});
