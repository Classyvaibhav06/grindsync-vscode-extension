export type ActivityState = 'ACTIVE' | 'IDLE' | 'STOPPED';

export interface ActivityInterval {
  id: string; // unique interval/batch identifier
  startTime: number; // Unix timestamp ms
  endTime: number; // Unix timestamp ms
  durationSeconds: number;
  language: string;
  keystrokeCount: number;
  linesAdded: number;
  linesDeleted: number;
}

export interface ActivityStats {
  sessionSeconds: number;
  todaySeconds: number;
  currentLanguage: string;
  state: ActivityState;
  isPaused: boolean;
}

export interface SyncBatchPayload {
  batchId: string;
  deviceId: string;
  deviceName: string;
  sessionId: string;
  clientTimestamp: number;
  intervals: ActivityInterval[];
  languageBreakdown: Record<string, number>; // language -> seconds
  totalActiveSeconds: number;
}

export interface HeartbeatPayload {
  deviceId: string;
  deviceName: string;
  sessionId: string;
  state: ActivityState;
  currentLanguage: string;
  clientTimestamp: number;
}

export interface PairResponse {
  success: boolean;
  token?: string;
  deviceId?: string;
  userId?: string;
  username?: string;
  error?: string;
}
