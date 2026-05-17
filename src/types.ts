interface Memory {
  content: string;
  created: string;
  current: boolean;
  id: string;
  parentId: string | undefined;
  strength: number;
  type: string;
  updated: string;
  version: number;
}

interface MemoryLink {
  created: string;
  relation: string;
  sourceId: string;
  targetId: string;
  updated: string;
  weight: number;
}

interface SearchResult {
  memory: Memory;
  score: number;
}

interface RememberResult {
  id: string;
  parentId: string | undefined;
  version: number;
}

interface ListOptions {
  limit?: number;
  maxStrength?: number;
  minStrength?: number;
  type?: string;
}

interface SearchOptions {
  limit?: number;
  minStrength?: number;
  type?: string;
  weights?: {
    bm25?: number;
    vector?: number;
  };
}

interface RelatedOptions {
  limit?: number;
  minWeight?: number;
  relation?: string;
}

type EmbedFunction = (text: string) => Promise<number[]>;

export type {
  EmbedFunction,
  ListOptions,
  Memory,
  MemoryLink,
  RelatedOptions,
  RememberResult,
  SearchOptions,
  SearchResult,
};
