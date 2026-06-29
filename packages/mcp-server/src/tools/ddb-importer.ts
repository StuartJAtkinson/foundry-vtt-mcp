import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import { ErrorHandler } from '../utils/error-handler.js';

export interface DDBImporterToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

// ponytail: Phase 3 unblock — one specific tool. Add a generic macro/module-api
// dispatcher here only if more importer entry points actually surface.
export class DDBImporterTools {
  private foundryClient: FoundryClient;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  constructor({ foundryClient, logger }: DDBImporterToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DDBImporterTools' });
    this.errorHandler = new ErrorHandler(this.logger);
  }

  getToolDefinitions() {
    return [
      {
        name: 'import-ddb-character',
        description:
          "Import a D&D Beyond character by id into Foundry using ddb-importer. Requires the ddb-importer module to be installed and active, AND a valid CobaltSession in ddb-importer's settings (this is separate from any cobalt held by ddb-bridge's proxy). Returns the created actor id and name on success.",
        inputSchema: {
          type: 'object',
          properties: {
            characterId: {
              type: 'string',
              description:
                'D&D Beyond character id (the number from the character sheet URL, e.g. "166577342")',
            },
          },
          required: ['characterId'],
        },
      },
    ];
  }

  async handleImportDDBCharacter(args: any): Promise<any> {
    const schema = z.object({
      characterId: z.string().min(1, 'characterId is required'),
    });
    const { characterId } = schema.parse(args);

    this.logger.info('Importing DDB character', { characterId });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.importDDBCharacter', {
        characterId,
      });

      if (result?.success) {
        return {
          success: true,
          actorId: result.actorId,
          actorName: result.actorName,
          message: `✅ Imported "${result.actorName}" (id ${result.actorId})`,
        };
      }
      return {
        success: false,
        error: result?.error || 'ddb-importer did not return a result',
        message: `❌ Import failed: ${result?.error || 'unknown error'}`,
      };
    } catch (error) {
      this.errorHandler.handleToolError(error, 'import-ddb-character', 'DDB character import');
    }
  }
}
