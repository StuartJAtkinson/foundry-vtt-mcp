/**
 * token-manipulation tool tests — focused on the delete-actors skill (id
 * and/or name forwarding, plus the empty-payload guard).
 */

import { describe, it, expect, vi } from 'vitest';
import { TokenManipulationTools } from './token-manipulation.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({ success: true })));
  const logger: any = { info: vi.fn(), error: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  return { tools: new TokenManipulationTools({ foundryClient, logger }), query };
}

describe('TokenManipulationTools.getToolDefinitions — delete-actors', () => {
  it('advertises actorIds and names inputs', () => {
    const def = makeTools()
      .tools.getToolDefinitions()
      .find(d => d.name === 'delete-actors');
    expect(def).toBeDefined();
    const props = def!.inputSchema.properties as any;
    expect(props.actorIds.type).toBe('array');
    expect(props.names.type).toBe('array');
    // ponytail: neither field is required — names alone or ids alone must work
    expect(def!.inputSchema.required ?? []).toEqual([]);
  });
});

describe('TokenManipulationTools.handleDeleteActors', () => {
  it('forwards actorIds to the bridge', async () => {
    const { tools, query } = makeTools();
    const ids = ['5I2cTXYVXBRtn1ux', 'ueg7gW0WASRXdzdb'];
    const result = await tools.handleDeleteActors({ actorIds: ids });
    expect(result).toEqual({ success: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteActors', {
      actorIds: ids,
      names: undefined,
    });
  });

  it('forwards names to the bridge', async () => {
    const { tools, query } = makeTools();
    await tools.handleDeleteActors({ names: ['New Actor', 'New Actor'] });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteActors', {
      actorIds: undefined,
      names: ['New Actor', 'New Actor'],
    });
  });

  it('accepts both actorIds and names together', async () => {
    const { tools, query } = makeTools();
    await tools.handleDeleteActors({ actorIds: ['a1'], names: ['New Actor'] });
    const call = query.mock.calls[0][1] as any;
    expect(call.actorIds).toEqual(['a1']);
    expect(call.names).toEqual(['New Actor']);
  });

  it('rejects an empty payload without forwarding', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleDeleteActors({});
    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
