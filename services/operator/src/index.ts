#!/usr/bin/env bun
/**
 * DMR-X Kubernetes Operator
 * 
 * This operator manages:
 * - MCP Server instances
 * - Federation configuration
 * - Workflow orchestration
 * - Tool search indices
 */

export { Operator } from './operator';
export type {
  OperatorConfig,
  MCPServerSpec,
  FederationSpec,
  WorkflowSpec,
  ToolSearchIndexSpec,
} from './operator';

// CLI entry point
if (require.main === module || process.argv[1]?.includes('operator')) {
  const { Operator } = require('./operator');
  const { logger } = require('@dmr-x/utils');

  const main = async () => {
    logger.info('Starting DMR-X Kubernetes Operator');

    const operator = new Operator({
      namespace: process.env.DMRX_NAMESPACE || 'default',
    });

    await operator.start();

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down operator...');
      await operator.stop();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Keep the process running
    await new Promise(() => {});
  };

  main().catch((error) => {
    logger.error('Failed to start operator:', error);
    process.exit(1);
  });
}
