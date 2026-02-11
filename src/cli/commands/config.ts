import type { Command } from '../types.js';
import { loadConfig, validateExternalConfig } from '../../config/loader.js';
import { createSecretStore } from '../../utils/secret-store.js';
import { promptUser } from '../utils.js';

export const configCommand: Command = {
  name: 'config',
  description: 'Manage configuration',
  usage: 'causantic config <show|validate|set-key|get-key>',
  handler: async (args) => {
    const subcommand = args[0];

    switch (subcommand) {
      case 'show': {
        const config = loadConfig();
        console.log(JSON.stringify(config, null, 2));
        break;
      }
      case 'validate': {
        const config = loadConfig();
        const errors = validateExternalConfig(config);
        if (errors.length === 0) {
          console.log('Configuration is valid.');
        } else {
          console.error('Configuration errors:');
          for (const error of errors) {
            console.error(`  - ${error}`);
          }
          process.exit(3);
        }
        break;
      }
      case 'set-key': {
        const keyName = args[1];
        if (!keyName) {
          console.error('Error: Key name required');
          console.log('Usage: causantic config set-key <name>');
          process.exit(2);
        }
        const value = await promptUser(`Enter value for ${keyName}: `);
        const store = createSecretStore();
        await store.set(keyName, value);
        console.log(`Key ${keyName} stored.`);
        break;
      }
      case 'get-key': {
        const keyName = args[1];
        if (!keyName) {
          console.error('Error: Key name required');
          console.log('Usage: causantic config get-key <name>');
          process.exit(2);
        }
        const store = createSecretStore();
        const value = await store.get(keyName);
        if (value) {
          console.log(value);
        } else {
          console.error(`Key ${keyName} not found.`);
          process.exit(1);
        }
        break;
      }
      default:
        console.error('Error: Unknown subcommand');
        console.log('Usage: causantic config <show|validate|set-key|get-key>');
        process.exit(2);
    }
  },
};
