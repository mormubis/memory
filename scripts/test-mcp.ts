#!/usr/bin/env npx tsx
/**
 * Quick test: verify the MCP server connects and tools work via opencode SDK.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOpencode } from '@opencode-ai/sdk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MCP_SCRIPT = resolve(__dirname, 'mcp.ts');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('starting opencode...');
  const { client, server } = await createOpencode({
    config: {
      mcp: {
        'echecs-memory': {
          type: 'local',
          command: ['npx', 'tsx', MCP_SCRIPT],
          enabled: true,
        },
      },
    },
  });

  console.log('server:', server.url);

  // wait for MCP to initialize
  console.log('waiting for MCP to initialize...');
  await sleep(5000);

  // check MCP status via raw fetch
  const mcpRes = await fetch(`${server.url}/mcp`);
  const mcpStatus = await mcpRes.json();
  console.log('mcp status:', JSON.stringify(mcpStatus, null, 2));

  // create session
  const session = await client.session.create({ body: { title: 'mcp-test' } });
  const sessionId = session.data?.id;
  console.log('session:', sessionId);

  if (!sessionId) {
    console.log('failed to create session');
    server.close();
    return;
  }

  // prompt
  console.log('sending prompt...');
  const result = await client.session.prompt({
    path: { id: sessionId },
    body: {
      system:
        'You have memory MCP tools available. Call memory_stats first, then call memory_remember with type "rule" and content "castling requires the king to not be in check". Report the results.',
      parts: [
        {
          type: 'text',
          text: 'use the memory MCP tools: call memory_stats then store a test rule',
        },
      ],
    },
  });

  // print all parts
  const parts = result.data?.parts ?? [];
  console.log(`\nresponse: ${parts.length} parts`);
  for (const part of parts) {
    if (part.type === 'text') {
      console.log(`\n[text] ${part.text}`);
    } else if (part.type === 'tool') {
      console.log(`\n[tool] ${part.name} (${part.state})`);
      if (part.input) console.log('  input:', JSON.stringify(part.input).slice(0, 200));
      if (part.output) console.log('  output:', JSON.stringify(part.output).slice(0, 200));
    } else {
      console.log(`\n[${part.type}]`);
    }
  }

  // check db
  console.log('\n--- db check ---');
  const dbCheck = await fetch(`${server.url}/mcp`);
  console.log('mcp still alive:', dbCheck.ok);

  server.close();
}

main().catch(console.error);
