import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface SceneToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class SceneTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: SceneToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'SceneTools' });
  }

  /**
   * Tool definitions for scene operations
   */
  getToolDefinitions() {
    return [
      {
        name: 'get-current-scene',
        description:
          'Get information about the currently active scene, including tokens and layout',
        inputSchema: {
          type: 'object',
          properties: {
            includeTokens: {
              type: 'boolean',
              description: 'Whether to include detailed token information (default: true)',
              default: true,
            },
            includeHidden: {
              type: 'boolean',
              description: 'Whether to include hidden tokens and elements (default: false)',
              default: false,
            },
          },
        },
      },
      {
        name: 'get-world-info',
        description: 'Get basic information about the Foundry world and system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'import-scene-with-walls',
        description:
          'Build line-of-sight for a map from Universal VTT (UVTT/dd2vtt/df2vtt) geometry: creates walls, doors and lights. Either creates a new scene (pass scene_name, and optionally image_path to an already-uploaded background) or adds the geometry to an existing scene (pass target_scene_id). The uvtt object is the parsed JSON from a .uvtt file or an auto-wall export (resolution + line_of_sight + portals + lights). Does NOT upload base64 images — use scene-express for that, then target the resulting scene by id.',
        inputSchema: {
          type: 'object',
          properties: {
            uvtt: {
              type: 'object',
              description:
                'Parsed Universal VTT JSON: { resolution:{map_size,map_origin,pixels_per_grid}, line_of_sight:[[{x,y}...]], objects_line_of_sight, portals:[{bounds:[{x,y},{x,y}],closed}], lights:[{position,range,color}] }. Coordinates in grid units.',
            },
            scene_name: {
              type: 'string',
              description: 'Name for a NEW scene. Required unless target_scene_id is given.',
            },
            image_path: {
              type: 'string',
              description:
                'Optional background image path/URL already servable by Foundry (relative to the data dir, or an absolute URL). Only used when creating a new scene.',
            },
            target_scene_id: {
              type: 'string',
              description:
                'Add walls/lights to this existing scene (id or exact name) instead of creating one.',
            },
          },
          required: ['uvtt'],
        },
      },
      {
        name: 'list-map-scenes',
        description:
          'Browse pre-walled maps: lists scenes available in Scene-type compendium packs (e.g. Levels sample maps, Baileywiki maps if the module is enabled). Returns {packId, entryId, name} for each — pass those to import-compendium-scene to pull one into the world with its walls/lights already baked in. Optional filter matches scene names (case-insensitive).',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              description: 'Optional case-insensitive substring to match scene names.',
            },
          },
        },
      },
      {
        name: 'import-compendium-scene',
        description:
          'Pull a pre-walled map into the world: instantiates a Scene from a compendium pack (packId + entryId from list-map-scenes). Embedded walls, doors, lights and tokens come along automatically — no wall-building needed. Optionally rename via name.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: {
              type: 'string',
              description: 'Compendium pack id (e.g. "levels.maps"), from list-map-scenes.',
            },
            entryId: {
              type: 'string',
              description: 'Scene entry id within the pack, from list-map-scenes.',
            },
            name: {
              type: 'string',
              description: 'Optional new name for the imported scene.',
            },
          },
          required: ['packId', 'entryId'],
        },
      },
    ];
  }

  async handleListMapScenes(args: any): Promise<any> {
    const schema = z.object({ filter: z.string().optional() });
    const parsed = schema.parse(args);
    this.logger.info('Listing compendium scenes', { filter: parsed.filter });
    try {
      return await this.foundryClient.query('foundry-mcp-bridge.listCompendiumScenes', parsed);
    } catch (error) {
      this.logger.error('Failed to list compendium scenes', error);
      throw new Error(
        `Failed to list map scenes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleImportCompendiumScene(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string(),
      entryId: z.string(),
      name: z.string().optional(),
    });
    const parsed = schema.parse(args);
    this.logger.info('Importing compendium scene', parsed);
    try {
      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.importCompendiumScene',
        parsed
      );
      if (result?.success) {
        return { ...result, message: result.message };
      }
      return {
        success: false,
        error: result?.error || 'compendium scene import returned no result',
        message: `❌ Import failed: ${result?.error || 'unknown error'}`,
      };
    } catch (error) {
      this.logger.error('Failed to import compendium scene', error);
      throw new Error(
        `Failed to import compendium scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleImportSceneWithWalls(args: any): Promise<any> {
    const schema = z
      .object({
        uvtt: z.record(z.any()),
        scene_name: z.string().optional(),
        image_path: z.string().optional(),
        target_scene_id: z.string().optional(),
      })
      .refine(a => !!a.scene_name || !!a.target_scene_id, {
        message: 'Provide scene_name (new scene) or target_scene_id (existing scene)',
      });
    const parsed = schema.parse(args);

    this.logger.info('Importing scene with walls', {
      scene_name: parsed.scene_name,
      target_scene_id: parsed.target_scene_id,
    });

    try {
      const result = await this.foundryClient.query(
        'foundry-mcp-bridge.importSceneWithWalls',
        parsed
      );
      if (result?.success) {
        return { ...result, message: result.message };
      }
      return {
        success: false,
        error: result?.error || 'scene import returned no result',
        message: `❌ Scene import failed: ${result?.error || 'unknown error'}`,
      };
    } catch (error) {
      this.logger.error('Failed to import scene with walls', error);
      throw new Error(
        `Failed to import scene with walls: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetCurrentScene(args: any): Promise<any> {
    const schema = z.object({
      includeTokens: z.boolean().default(true),
      includeHidden: z.boolean().default(false),
    });

    const { includeTokens, includeHidden } = schema.parse(args);

    this.logger.info('Getting current scene information', { includeTokens, includeHidden });

    try {
      const sceneData = await this.foundryClient.query('foundry-mcp-bridge.getActiveScene');

      this.logger.debug('Successfully retrieved scene data', {
        sceneId: sceneData.id,
        sceneName: sceneData.name,
        tokenCount: sceneData.tokens?.length || 0,
      });

      return this.formatSceneResponse(sceneData, includeTokens, includeHidden);
    } catch (error) {
      this.logger.error('Failed to get current scene', error);
      throw new Error(
        `Failed to get current scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetWorldInfo(_args: any): Promise<any> {
    this.logger.info('Getting world information');

    try {
      const worldData = await this.foundryClient.query('foundry-mcp-bridge.getWorldInfo');

      this.logger.debug('Successfully retrieved world data', {
        worldId: worldData.id,
        system: worldData.system,
      });

      return this.formatWorldResponse(worldData);
    } catch (error) {
      this.logger.error('Failed to get world information', error);
      throw new Error(
        `Failed to get world information: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private formatSceneResponse(sceneData: any, includeTokens: boolean, includeHidden: boolean): any {
    const response: any = {
      id: sceneData.id,
      name: sceneData.name,
      active: sceneData.active,
      dimensions: {
        width: sceneData.width,
        height: sceneData.height,
        padding: sceneData.padding,
      },
      hasBackground: !!sceneData.background,
      navigation: sceneData.navigation,
      elements: {
        walls: sceneData.walls || 0,
        lights: sceneData.lights || 0,
        sounds: sceneData.sounds || 0,
        notes: sceneData.notes?.length || 0,
      },
    };

    if (includeTokens && sceneData.tokens) {
      response.tokens = this.formatTokens(sceneData.tokens, includeHidden);
      response.tokenSummary = this.createTokenSummary(sceneData.tokens, includeHidden);
    }

    if (sceneData.notes && sceneData.notes.length > 0) {
      response.notes = sceneData.notes.map((note: any) => ({
        id: note.id,
        text: this.truncateText(note.text, 100),
        position: { x: note.x, y: note.y },
      }));
    }

    return response;
  }

  private formatTokens(tokens: any[], includeHidden: boolean): any[] {
    return tokens
      .filter(token => includeHidden || !token.hidden)
      .map(token => ({
        id: token.id,
        name: token.name,
        position: {
          x: token.x,
          y: token.y,
        },
        size: {
          width: token.width,
          height: token.height,
        },
        actorId: token.actorId,
        disposition: this.getDispositionName(token.disposition),
        hidden: token.hidden,
        hasImage: !!token.img,
      }));
  }

  private createTokenSummary(tokens: any[], includeHidden: boolean): any {
    const visibleTokens = includeHidden ? tokens : tokens.filter(t => !t.hidden);

    const summary = {
      total: visibleTokens.length,
      byDisposition: {
        friendly: 0,
        neutral: 0,
        hostile: 0,
        unknown: 0,
      },
      hasActors: 0,
      withoutActors: 0,
    };

    visibleTokens.forEach(token => {
      // Count by disposition
      const disposition = this.getDispositionName(token.disposition);
      if (disposition in summary.byDisposition) {
        summary.byDisposition[disposition as keyof typeof summary.byDisposition]++;
      } else {
        summary.byDisposition.unknown++;
      }

      // Count actor association
      if (token.actorId) {
        summary.hasActors++;
      } else {
        summary.withoutActors++;
      }
    });

    return summary;
  }

  private formatWorldResponse(worldData: any): any {
    return {
      id: worldData.id,
      title: worldData.title,
      system: {
        id: worldData.system,
        version: worldData.systemVersion,
      },
      foundry: {
        version: worldData.foundryVersion,
      },
      users: {
        total: worldData.users?.length || 0,
        active: worldData.users?.filter((u: any) => u.active).length || 0,
        gms: worldData.users?.filter((u: any) => u.isGM).length || 0,
        players: worldData.users?.filter((u: any) => !u.isGM).length || 0,
      },
      activeUsers:
        worldData.users
          ?.filter((u: any) => u.active)
          .map((u: any) => ({
            id: u.id,
            name: u.name,
            isGM: u.isGM,
          })) || [],
    };
  }

  private getDispositionName(disposition: number): string {
    switch (disposition) {
      case -1:
        return 'hostile';
      case 0:
        return 'neutral';
      case 1:
        return 'friendly';
      default:
        return 'unknown';
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}
