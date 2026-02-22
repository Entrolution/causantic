export async function runHealthCheck(): Promise<void> {
  console.log('');
  console.log('Running health check...');

  try {
    const { vectorStore } = await import('../../../storage/vector-store.js');
    if (vectorStore && typeof vectorStore.count === 'function') {
      await vectorStore.count();
    }
    console.log('\u2713 Vector store OK');
  } catch (error) {
    console.log(`\u26a0 Vector store: ${(error as Error).message}`);
  }
}
