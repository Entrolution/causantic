import type { Command } from '../types.js';
import { runTask, runAllTasks, getStatus, runDaemon } from '../../maintenance/scheduler.js';

export const maintenanceCommand: Command = {
  name: 'maintenance',
  description: 'Run maintenance tasks',
  usage: 'ecm maintenance <run|status|daemon> [task]',
  handler: async (args) => {
    const subcommand = args[0];

    switch (subcommand) {
      case 'run': {
        const taskName = args[1];
        if (taskName === 'all') {
          console.log('Running all maintenance tasks...');
          const results = await runAllTasks();
          for (const [name, result] of results) {
            const status = result.success ? 'OK' : 'FAILED';
            console.log(`  ${name}: ${status} - ${result.message}`);
          }
        } else if (taskName) {
          const result = await runTask(taskName);
          const status = result.success ? 'OK' : 'FAILED';
          console.log(`${taskName}: ${status} - ${result.message}`);
        } else {
          console.error('Error: Task name required');
          console.log('Usage: ecm maintenance run <task|all>');
          console.log('Tasks: scan-projects, update-clusters, prune-graph, refresh-labels, vacuum');
          process.exit(2);
        }
        break;
      }
      case 'status': {
        const status = getStatus();
        console.log('Maintenance Task Status:');
        console.log('');
        for (const task of status) {
          console.log(`${task.name}:`);
          console.log(`  Schedule: ${task.schedule}`);
          if (task.lastRun) {
            const runStatus = task.lastRun.success ? 'OK' : 'FAILED';
            console.log(`  Last run: ${task.lastRun.endTime} (${runStatus})`);
          } else {
            console.log(`  Last run: Never`);
          }
          if (task.nextRun) {
            console.log(`  Next run: ${task.nextRun.toISOString()}`);
          }
          console.log('');
        }
        break;
      }
      case 'daemon': {
        const controller = new AbortController();
        process.on('SIGINT', () => controller.abort());
        process.on('SIGTERM', () => controller.abort());
        await runDaemon(controller.signal);
        break;
      }
      default:
        console.error('Error: Unknown subcommand');
        console.log('Usage: ecm maintenance <run|status|daemon>');
        process.exit(2);
    }
  },
};
