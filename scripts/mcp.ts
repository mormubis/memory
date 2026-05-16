#!/usr/bin/env npx tsx
/**
 * MCP server wrapping the memory library.
 *
 * Exposes memory operations as MCP tools so opencode can consolidate
 * echecs memories via the memory_* tool set.
 *
 * Usage: npx tsx scripts/mcp.ts
 * Config in opencode: add as stdio MCP server pointing to this script.
 */

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { createMemory } from '../src/index.js';

// --- memory store ---

const memory = createMemory({
  path: './echecs-memory.db',
  similarityThreshold: 0.85,
  decayRate: 0.99,
  evictionThreshold: 0.05,
  defaultStrength: 0.2,
  typeStrength: {
    constraint: 0.7,
    decision: 0.7,
    entity: 0.5,
    pattern: 0.5,
    rule: 0.6,
    standard: 0.6,
  },
});

// --- MCP server ---

const server = new McpServer({
  name: 'echecs-memory',
  version: '0.1.0',
});

// 1. memory_remember — insert a memory
server.registerTool(
  'memory_remember',
  {
    title: 'Remember',
    description: 'Store a chess domain memory. Strength is determined by the type.',
    inputSchema: z.object({
      type: z.string().describe('Memory type: rule, entity, standard, decision, constraint, or pattern'),
      content: z.string().describe('The knowledge to store — a clear standalone statement'),
    }),
  },
  async ({ type, content }) => {
    try {
      const result = await memory.remember(type, content);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ id: result.id, version: result.version, parentId: result.parentId }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 2. memory_search — semantic search
server.registerTool(
  'memory_search',
  {
    title: 'Search Memories',
    description: 'Semantic search over stored memories using vector + BM25 hybrid search',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().int().positive().optional().describe('Max results (default 10)'),
      type: z.string().optional().describe('Filter by memory type'),
    }),
  },
  async ({ query, limit, type }) => {
    try {
      const results = await memory.search(query, { limit: limit ?? 10, type });
      const mapped = results.map((r) => ({
        id: r.memory.id,
        type: r.memory.type,
        content: r.memory.content.slice(0, 300),
        strength: r.memory.strength,
        score: r.score,
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(mapped) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 3. memory_list — list current memories
server.registerTool(
  'memory_list',
  {
    title: 'List Memories',
    description: 'List current (non-evicted) memories, optionally filtered',
    inputSchema: z.object({
      type: z.string().optional().describe('Filter by memory type'),
      limit: z.number().int().positive().optional().describe('Max results'),
      minStrength: z.number().min(0).max(1).optional().describe('Minimum strength filter'),
    }),
  },
  ({ type, limit, minStrength }) => {
    try {
      const results = memory.list({ type, limit, minStrength });
      const mapped = results.map((m) => ({
        id: m.id,
        type: m.type,
        content: m.content.slice(0, 200),
        strength: m.strength,
        version: m.version,
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(mapped) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 4. memory_get — get specific memory
server.registerTool(
  'memory_get',
  {
    title: 'Get Memory',
    description: 'Retrieve a specific memory by ID (reinforces its strength)',
    inputSchema: z.object({
      id: z.string().describe('Memory ID'),
    }),
  },
  ({ id }) => {
    try {
      const m = memory.get(id);
      if (!m) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(null) }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(m) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 5. memory_link — create a link between memories
server.registerTool(
  'memory_link',
  {
    title: 'Link Memories',
    description: 'Create a directional link between two memories',
    inputSchema: z.object({
      sourceId: z.string().describe('Source memory ID'),
      targetId: z.string().describe('Target memory ID'),
      relation: z.string().describe('Relation label, e.g. "related", "supports", "contradicts"'),
      weight: z.number().min(0).max(1).optional().describe('Link weight (default 1.0)'),
    }),
  },
  ({ sourceId, targetId, relation, weight }) => {
    try {
      memory.link(sourceId, targetId, relation, weight);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 6. memory_related — get linked memories
server.registerTool(
  'memory_related',
  {
    title: 'Related Memories',
    description: 'Get memories linked to the given ID',
    inputSchema: z.object({
      id: z.string().describe('Memory ID'),
      relation: z.string().optional().describe('Filter by relation type'),
    }),
  },
  ({ id, relation }) => {
    try {
      const links = memory.related(id, { relation });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(links) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 7. memory_forget — hard delete a memory
server.registerTool(
  'memory_forget',
  {
    title: 'Forget Memory',
    description: 'Hard delete a memory and its vector/links',
    inputSchema: z.object({
      id: z.string().describe('Memory ID to delete'),
    }),
  },
  ({ id }) => {
    try {
      memory.forget(id);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true }) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 8. memory_history — version chain for a memory
server.registerTool(
  'memory_history',
  {
    title: 'Memory History',
    description: 'Get the full version chain for a memory (newest to oldest)',
    inputSchema: z.object({
      id: z.string().describe('Memory ID'),
    }),
  },
  ({ id }) => {
    try {
      const chain = memory.history(id);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(chain) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 9. memory_stats — overview statistics
server.registerTool(
  'memory_stats',
  {
    title: 'Memory Stats',
    description: 'Overview statistics: count, type breakdown, strength distribution',
    inputSchema: z.object({}),
  },
  () => {
    try {
      const all = memory.list();
      const total = all.length;

      const byType: Record<string, number> = {};
      const buckets = { '0-0.2': 0, '0.2-0.5': 0, '0.5-0.8': 0, '0.8-1.0': 0 };
      let strengthSum = 0;

      for (const m of all) {
        byType[m.type] = (byType[m.type] ?? 0) + 1;
        strengthSum += m.strength;

        if (m.strength < 0.2) buckets['0-0.2']++;
        else if (m.strength < 0.5) buckets['0.2-0.5']++;
        else if (m.strength < 0.8) buckets['0.5-0.8']++;
        else buckets['0.8-1.0']++;
      }

      const avgStrength = total > 0 ? strengthSum / total : 0;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ total, byType, avgStrength, byStrengthBucket: buckets }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `error: ${err}` }],
        isError: true,
      };
    }
  },
);

// --- start ---

const transport = new StdioServerTransport();
await server.connect(transport);
