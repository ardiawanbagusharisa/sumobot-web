interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{ success: boolean; results?: T[] }>;
  all<T = Record<string, unknown>>(): Promise<{ success: boolean; results: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean }>>;
}

interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | string): Promise<unknown>;
  get(key: string): Promise<unknown>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    REPLAYS: R2Bucket;
  };
}
