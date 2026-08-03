// Web build: activity tracking is iPad-only (offline buffer).
// On web, every action hits the server directly and is already audit-logged.

export async function trackActivity(
  _action: string, _entityType: string, _entityId?: string,
  _screen?: string, _metadata?: Record<string, any>,
): Promise<void> {}

export async function activityCount(): Promise<number> { return 0; }

export async function flushActivity(
  _apiFn: (path: string, init: any) => Promise<any>,
): Promise<void> {}
