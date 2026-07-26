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
      {
        name: 'munch-ddb',
        description:
          "Run ddb-importer's Muncher to bulk-import compendium content from D&D Beyond (this presses ddb-importer's own Muncher buttons via its api — content lands in ddb-importer's configured compendiums with its Iconizer icons and downloaded images intact). type is one of: monsters, spells, items, vehicles. monsters/spells/vehicles munch according to ddb-importer's own Muncher settings (source filters, update-existing, etc. — set those in the Muncher UI). items can optionally be scoped to specific D&D Beyond item ids. Requires ddb-importer installed/active with a valid CobaltSession in its settings. NOTE: a full monsters/items munch is long-running (minutes) and hits D&D Beyond hard; progress shows in ddb-importer's own UI.",
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['monsters', 'spells', 'items', 'vehicles'],
              description: 'Which content type to munch.',
            },
            ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Optional D&D Beyond ids to scope the munch (items only).',
            },
          },
          required: ['type'],
        },
      },
    ];
  }

  async handleMunchDDB(args: any): Promise<any> {
    const schema = z.object({
      type: z.enum(['monsters', 'spells', 'items', 'vehicles']),
      ids: z.array(z.number()).optional(),
    });
    const parsed = schema.parse(args);

    this.logger.info('Munching DDB content', parsed);

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.munchDDB', parsed);
      if (result?.success) {
        return { ...result, message: result.message };
      }
      return {
        success: false,
        error: result?.error || 'ddb-importer Muncher did not return a result',
        message: `❌ Munch failed: ${result?.error || 'unknown error'}`,
      };
    } catch (error) {
      this.errorHandler.handleToolError(error, 'munch-ddb', 'DDB content munch');
    }
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
