import { createSecretStore } from '../../../utils/secret-store.js';
import { promptPassword, promptYesNo } from '../../utils.js';

export async function offerApiKeySetup(): Promise<void> {
  console.log('');
  console.log('Cluster labeling uses Claude Haiku to generate human-readable');
  console.log('descriptions for topic clusters.');

  if (!(await promptYesNo('Add Anthropic API key for cluster labeling?'))) return;

  const apiKey = await promptPassword('Enter Anthropic API key: ');

  if (apiKey && apiKey.startsWith('sk-ant-')) {
    const store = createSecretStore();
    await store.set('anthropic-api-key', apiKey);
    console.log('\u2713 API key stored in system keychain');

    // Set in env so update-clusters can use it for labeling
    process.env.ANTHROPIC_API_KEY = apiKey;
  } else if (apiKey) {
    console.log('\u26a0 Invalid API key format (should start with sk-ant-)');
    console.log('  You can add it later with: causantic config set-key anthropic-api-key');
  } else {
    console.log('  Skipping — clusters will be unlabeled.');
    console.log('  Add a key later with: causantic config set-key anthropic-api-key');
  }
}
