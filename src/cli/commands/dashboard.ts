import type { Command } from '../types.js';

export const dashboardCommand: Command = {
  name: 'dashboard',
  description: 'Launch the web dashboard',
  usage: 'ecm dashboard [--port <port>]',
  handler: async (args) => {
    const portIndex = args.indexOf('--port');
    const port = portIndex >= 0 ? parseInt(args[portIndex + 1], 10) || 3333 : 3333;
    const { startDashboard } = await import('../../dashboard/server.js');
    await startDashboard(port);
  },
};
