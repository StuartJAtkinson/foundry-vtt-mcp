import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface ChatLogToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class ChatLogTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: ChatLogToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger;
  }

  getToolDefinitions() {
    return [
      {
        name: 'read-chat-log',
        description:
          'Read recent chat messages from the active Foundry VTT game for session-recap automation. Returns a slim list of messages with speaker, timestamp, HTML-stripped content, and parsed roll data (formula, total, dice). All filters are optional; defaults to the last 3 hours of public messages. Useful for "what was that roll for?" lookups — pair with a per-player follow-up like "tell me what each of these rolls was for" when correlating to skill names.',
        inputSchema: {
          type: 'object',
          properties: {
            speakerName: {
              type: 'string',
              description:
                'Substring match (case-insensitive) against the message alias or content. Use a player or character name.',
            },
            sinceMinutesAgo: {
              type: 'number',
              description:
                'How far back to look, in minutes. Default 180 (3 hours). Max 1440 (24 hours).',
              default: 180,
              minimum: 1,
              maximum: 1440,
            },
            rollsOnly: {
              type: 'boolean',
              description:
                'If true, only return messages that contain a roll. Useful for "what checks did the party roll recently?" queries.',
              default: false,
            },
            limit: {
              type: 'number',
              description: 'Maximum messages to return. Default 50, max 500.',
              default: 50,
              minimum: 1,
              maximum: 500,
            },
          },
          required: [],
        },
      },
    ];
  }

  async handleReadChatLog(args: any): Promise<string> {
    const schema = z.object({
      speakerName: z.string().optional(),
      sinceMinutesAgo: z.number().min(1).max(1440).default(180),
      rollsOnly: z.boolean().default(false),
      limit: z.number().min(1).max(500).default(50),
    });

    try {
      const params = schema.parse(args ?? {});

      const response: any = await this.foundryClient.query(
        'foundry-mcp-bridge.read-chat-log',
        params
      );

      if (!response?.success) {
        const err = response?.error || 'Failed to read chat log';
        return `Chat log read failed: ${err}`;
      }

      const msgs = response.messages || [];
      if (msgs.length === 0) {
        return `No messages matched the filters (window: last ${params.sinceMinutesAgo} minutes${params.speakerName ? `, speaker "${params.speakerName}"` : ''}${params.rollsOnly ? ', rolls-only' : ''}).`;
      }

      const lines = msgs.map((m: any) => {
        const ts = new Date(m.timestamp).toISOString().replace('T', ' ').slice(0, 19);
        const flag = m.isRoll ? '🎲' : m.isWhisper ? '🤫' : '💬';
        const rollTxt =
          m.isRoll && m.rolls?.length
            ? ` [${m.rolls.map((r: any) => `${r.formula}=${r.total}`).join(', ')}]`
            : '';
        return `${flag} ${ts} ${m.speaker}${rollTxt}: ${m.content}`;
      });

      const header = `Found ${msgs.length} message${msgs.length === 1 ? '' : 's'} (window: last ${params.sinceMinutesAgo} minutes${params.speakerName ? `, speaker "${params.speakerName}"` : ''}${params.rollsOnly ? ', rolls-only' : ''}).\n`;
      return header + lines.join('\n');
    } catch (error) {
      this.logger.error('Error reading chat log', error);
      if (error instanceof z.ZodError) {
        return `Parameter error: ${error.errors.map(e => e.message).join(', ')}`;
      }
      throw error;
    }
  }
}
