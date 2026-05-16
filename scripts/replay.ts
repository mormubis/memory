#!/usr/bin/env npx tsx
/**
 * E2E replay: reads real echecs opencode conversations, extracts
 * user+assistant text, splits on 2-min gaps, feeds each chunk to a
 * background opencode session that stores chess domain memories via MCP.
 *
 * Uses conversation timestamps as the memory clock — so decay and
 * reinforcement happen at the real pace the conversations occurred.
 * Gaps >= 30 min between chunks advance the clock, triggering natural
 * synaptic downscaling (weak memories decay during "idle" periods).
 *
 * Usage: npx tsx scripts/replay.ts
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { createOpencode } from '@opencode-ai/sdk';

import type { OpencodeClient } from '@opencode-ai/sdk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MCP_SCRIPT = resolve(__dirname, 'mcp.ts');
const OPENCODE_DB = `${process.env.HOME}/.local/share/opencode/opencode.db`;

// --- sessions to replay ---

const SESSIONS = [
  {
    id: 'ses_1f3abe854ffej012scXpwINUbW',
    title: 'Type redesign for @echecs/tournament v3.0.0',
  },
  {
    id: 'ses_241ae2bb2ffeUfb1jQUrZNnqf0',
    title: 'Tournament debugging: 204 players pairings issue',
  },
  {
    id: 'ses_2e8c5ec53ffeM22VfKabLD880j',
    title: 'Tournament tiebreaker libraries',
  },
  {
    id: 'ses_1dd14be28ffeEiEUAOQ2sQ5fH0',
    title: 'FIDE endorsement requirements checklist',
  },
  {
    id: 'ses_21be75bd1ffev51jdwM9s7Rj5C',
    title: '@echecs/endorsement CLI package for FIDE Swiss',
  },
];

// chunk split: 2 min gap
const GAP_CHUNK_MS = 2 * 60 * 1000;

// session break: 30 min gap — triggers clock advancement for decay
const GAP_SESSION_MS = 30 * 60 * 1000;

// max content per message
const MAX_MSG_LEN = 600;

// --- extraction prompt ---

const EXTRACTION_SYSTEM = `You are building a chess knowledge base by reading a real software development conversation.

Your job is to identify chess domain knowledge and store it using the memory_remember tool. Then link related memories using memory_link.

## Memory types — use exactly these strings as the "type" argument:
- rule — a chess rule that affects implementation (castling, en passant, fifty-move, draw by repetition, promotion, insufficient material)
- entity — a named system, organization, library, or product (FIDE, lichess, Stockfish, @echecs/pgn, @echecs/tournament, @echecs/elo, @echecs/trf)
- standard — a format or protocol (PGN, FEN, SAN, UCI, TRF, FIDE Swiss pairing rules, Buchholz, Sonneborn-Berger)
- decision — an architectural choice made in this codebase (e.g. "positions are represented as FEN strings", "RangeError for domain errors")
- constraint — an external requirement (e.g. "FIDE requires Buchholz as primary tiebreaker in Swiss", "bye score must be 1 point for FIDE endorsement")
- pattern — a recurring implementation convention (e.g. "ESM-only NodeNext resolution", "sideEffects: false on all packages", "vitest for testing")

## How to process the conversation:
1. Read through the conversation chunk
2. For each distinct piece of chess domain knowledge, call memory_remember with the appropriate type and a clear standalone statement as content
3. Store every mention, even if you stored something similar before — the system handles deduplication and frequency signals
4. Do NOT store: implementation details irrelevant to chess domain (variable names, test boilerplate, git commands, error messages unrelated to chess rules)
5. After storing all memories from this chunk, call memory_link between related memories using the IDs returned by memory_remember
6. Use relation "related_to" for general connections, "requires" when one thing depends on another, "implements" when an entity realizes a standard or rule

## Critical: store every mention
If Buchholz is mentioned 5 times, call memory_remember 5 times. Frequency is the signal — repeated concepts accumulate strength automatically.

## Important: do NOT call memory_set_clock
The clock is managed by the replay system, not by you. Only use memory_remember, memory_link, memory_search, and memory_stats.`;

// --- opencode db helpers ---

interface MessageRow {
  role: string;
  text: string;
  time_created: number;
}

function loadMessages(
  ocDb: BetterSqlite3.Database,
  sessionId: string,
): MessageRow[] {
  return ocDb
    .prepare(
      `
    SELECT
      json_extract(m.data, '$.role') as role,
      json_extract(p.data, '$.text') as text,
      p.time_created
    FROM part p
    JOIN message m ON p.message_id = m.id
    WHERE m.session_id = ?
      AND json_extract(p.data, '$.type') = 'text'
      AND json_extract(p.data, '$.text') IS NOT NULL
      AND json_extract(m.data, '$.role') IN ('user', 'assistant')
      AND length(json_extract(p.data, '$.text')) > 20
    ORDER BY p.time_created
  `,
    )
    .all(sessionId) as MessageRow[];
}

interface Chunk {
  messages: MessageRow[];
  startTime: number; // ms timestamp of first message
  endTime: number; // ms timestamp of last message
}

function splitIntoChunks(messages: MessageRow[]): Chunk[] {
  if (messages.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: MessageRow[] = [messages[0]!];

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1]!;
    const curr = messages[i]!;
    const gap = curr.time_created - prev.time_created;

    if (gap >= GAP_CHUNK_MS) {
      chunks.push({
        endTime: prev.time_created,
        messages: current,
        startTime: current[0]!.time_created,
      });
      current = [curr];
    } else {
      current.push(curr);
    }
  }

  if (current.length > 0) {
    chunks.push({
      endTime: current[current.length - 1]!.time_created,
      messages: current,
      startTime: current[0]!.time_created,
    });
  }

  return chunks;
}

function formatChunk(
  chunk: Chunk,
  sessionTitle: string,
  chunkIndex: number,
  totalChunks: number,
): string {
  const header = `--- chunk ${chunkIndex + 1}/${totalChunks} from "${sessionTitle}" ---\n\n`;
  const body = chunk.messages
    .map((m) => {
      const role = m.role === 'user' ? 'user' : 'assistant';
      const text =
        m.text.length > MAX_MSG_LEN
          ? m.text.slice(0, MAX_MSG_LEN) + '...'
          : m.text;
      return `[${role}] ${text}`;
    })
    .join('\n\n');
  return header + body;
}

function formatTime(ms: number): string {
  return new Date(ms).toISOString();
}

function formatGap(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h${remainMins > 0 ? `${remainMins}m` : ''}`;
}

// --- clock control via raw fetch to MCP tool ---

async function setClockViaMcp(
  client: OpencodeClient,
  sessionId: string,
  time: Date,
): Promise<void> {
  // call memory_set_clock by sending a prompt that instructs the agent
  // to call the tool — but that's wasteful. instead, we use the opencode
  // session prompt with a direct instruction.
  await client.session.prompt({
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: 'text',
          text: `call memory_set_clock with time "${time.toISOString()}" — just call the tool, no other output needed`,
        },
      ],
    },
  });
}

// --- main ---

async function main(): Promise<void> {
  const ocDb = new BetterSqlite3(OPENCODE_DB, { readonly: true });

  console.log('starting opencode with memory MCP...');
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

  console.log(`opencode ready at ${server.url}`);

  for (const session of SESSIONS) {
    console.log(`\n=== ${session.title} ===`);

    const messages = loadMessages(ocDb, session.id);
    if (messages.length === 0) {
      console.log('  no messages, skipping');
      continue;
    }

    const chunks = splitIntoChunks(messages);
    console.log(`  ${messages.length} messages -> ${chunks.length} chunks`);

    // one extraction session per source conversation
    const newSession = await client.session.create({
      body: { title: `extraction: ${session.title}` },
    });
    const sessionId = newSession.data?.id;
    if (!sessionId) {
      console.log('  failed to create session');
      continue;
    }

    console.log(`  session ${sessionId}`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;

      // --- clock management ---
      // set clock to the chunk's start time
      const chunkTime = new Date(chunk.startTime);
      try {
        await setClockViaMcp(client, sessionId, chunkTime);
      } catch {
        console.log(`  clock set failed for chunk ${i + 1}`);
      }

      // detect session break (30+ min gap from previous chunk)
      if (i > 0) {
        const prevChunk = chunks[i - 1]!;
        const gap = chunk.startTime - prevChunk.endTime;
        if (gap >= GAP_SESSION_MS) {
          console.log(
            `  --- session break: ${formatGap(gap)} idle (${formatTime(prevChunk.endTime)} -> ${formatTime(chunk.startTime)}) ---`,
          );
        }
      }

      const text = formatChunk(chunk, session.title, i, chunks.length);

      console.log(
        `  chunk ${i + 1}/${chunks.length} (${chunk.messages.length} msgs, ${formatTime(chunk.startTime)})`,
      );

      try {
        await client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: 'text', text }],
            ...(i === 0 ? { system: EXTRACTION_SYSTEM } : {}),
          },
        });
      } catch (err) {
        console.log(`  chunk ${i + 1} error: ${err}`);
      }
    }

    console.log(`  done`);
  }

  ocDb.close();
  server.close();
  console.log('\nreplay complete. run: npx tsx scripts/verify.ts');
}

main().catch(console.error);
