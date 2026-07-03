// Web build: the iPad's offline SQLite cache (expo-sqlite) doesn't run in a
// browser, and isn't needed there — the web app talks to the server directly.
// This in-memory stub satisfies the same async API so db code is a no-op on web.
const stub = {
  execAsync: async (_sql: string) => {},
  runAsync: async (_sql: string, ..._args: any[]) => ({ changes: 0, lastInsertRowId: 0 }),
  getAllAsync: async <T = any>(_sql: string, ..._args: any[]): Promise<T[]> => [],
  getFirstAsync: async <T = any>(_sql: string, ..._args: any[]): Promise<T | null> => null,
};

export async function db(): Promise<any> {
  return stub;
}
