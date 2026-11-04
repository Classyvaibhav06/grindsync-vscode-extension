import { ActivityInterval, ActivityState, ActivityStats } from './types';

export interface ActivityEngineConfig {
  idleTimeoutSeconds: number; // default 60
  sessionTimeoutMinutes: number; // default 15
  filterAiFormatterBursts: boolean;
}

export class ActivityEngine {
  private state: ActivityState = 'STOPPED';
  private currentSessionId: string = '';
  private sessionStartTime: number = 0;
  private lastActivityTime: number = 0;
  private currentLanguage: string = 'plaintext';
  private isPaused: boolean = false;

  // Active interval aggregation
  private currentIntervalStart: number = 0;
  private currentIntervalKeystrokes: number = 0;
  private currentIntervalLinesAdded: number = 0;
  private currentIntervalLinesDeleted: number = 0;

  // Completed intervals waiting for sync
  private completedIntervals: ActivityInterval[] = [];

  // Accumulated durations
  private totalSessionSeconds: number = 0;
  private todaySeconds: number = 0;
  private languageBreakdown: Record<string, number> = {};

  private config: ActivityEngineConfig;
  private onStateChangeCallback?: (state: ActivityState, stats: ActivityStats) => void;

  constructor(config: ActivityEngineConfig) {
    this.config = config;
    this.startNewSession();
  }

  public updateConfig(config: Partial<ActivityEngineConfig>) {
    this.config = { ...this.config, ...config };
  }

  public onStateChange(cb: (state: ActivityState, stats: ActivityStats) => void) {
    this.onStateChangeCallback = cb;
  }

  public getSessionId(): string {
    return this.currentSessionId;
  }

  public getState(): ActivityState {
    return this.state;
  }

  public isTrackingPaused(): boolean {
    return this.isPaused;
  }

  public setPaused(paused: boolean) {
    if (this.isPaused === paused) return;
    this.isPaused = paused;
    if (paused) {
      this.closeCurrentInterval(Date.now());
      this.transitionState('IDLE');
    } else {
      this.recordActivity(this.currentLanguage, 0, 0, 0);
    }
  }

  public startNewSession() {
    this.closeCurrentInterval(Date.now());
    this.currentSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.sessionStartTime = Date.now();
    this.lastActivityTime = Date.now();
    this.totalSessionSeconds = 0;
    this.languageBreakdown = {};
    this.state = 'IDLE';
    this.notify();
  }

  /**
   * Primary Signal: Record document edit / typing activity
   */
  public recordActivity(
    language: string,
    keystrokes: number = 1,
    linesAdded: number = 0,
    linesDeleted: number = 0,
    timestamp: number = Date.now()
  ) {
    if (this.isPaused) return;

    const now = timestamp;
    this.currentLanguage = language || this.currentLanguage || 'plaintext';

    // Check if session timed out (> 15 mins since last activity)
    const sessionTimeoutMs = this.config.sessionTimeoutMinutes * 60 * 1000;
    if (this.lastActivityTime > 0 && now - this.lastActivityTime > sessionTimeoutMs) {
      this.startNewSession();
    }

    if (this.state === 'IDLE' || this.state === 'STOPPED') {
      // Transition from IDLE to ACTIVE -> Start a new interval
      this.transitionState('ACTIVE');
      this.currentIntervalStart = now;
      this.currentIntervalKeystrokes = keystrokes;
      this.currentIntervalLinesAdded = linesAdded;
      this.currentIntervalLinesDeleted = linesDeleted;
    } else if (this.state === 'ACTIVE') {
      // If language changed mid-flight, flush the current interval for previous language and start fresh
      if (this.currentLanguage !== language && this.currentIntervalStart > 0) {
        this.closeCurrentInterval(now);
        this.currentLanguage = language;
        this.currentIntervalStart = now;
      }
      this.currentIntervalKeystrokes += keystrokes;
      this.currentIntervalLinesAdded += linesAdded;
      this.currentIntervalLinesDeleted += linesDeleted;
    }

    this.lastActivityTime = now;
    this.notify();
  }

  /**
   * Evaluates idle thresholds (invoked periodically by timer)
   */
  public checkIdleThreshold(now: number = Date.now()) {
    if (this.isPaused) return;

    const idleTimeoutMs = this.config.idleTimeoutSeconds * 1000;
    const timeSinceLastActivity = now - this.lastActivityTime;

    if (this.state === 'ACTIVE' && timeSinceLastActivity >= idleTimeoutMs) {
      // Inactivity threshold exceeded -> Cap active interval at lastActivityTime
      this.closeCurrentInterval(this.lastActivityTime);
      this.transitionState('IDLE');
    }
  }

  private closeCurrentInterval(cutoffTime: number) {
    if (this.currentIntervalStart <= 0) return;

    const end = Math.max(cutoffTime, this.currentIntervalStart);
    const durationSeconds = Math.round((end - this.currentIntervalStart) / 1000);

    if (durationSeconds > 0) {
      const interval: ActivityInterval = {
        id: `int_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        startTime: this.currentIntervalStart,
        endTime: end,
        durationSeconds,
        language: this.currentLanguage,
        keystrokeCount: this.currentIntervalKeystrokes,
        linesAdded: this.currentIntervalLinesAdded,
        linesDeleted: this.currentIntervalLinesDeleted
      };

      this.completedIntervals.push(interval);
      this.totalSessionSeconds += durationSeconds;
      this.todaySeconds += durationSeconds;
      this.languageBreakdown[this.currentLanguage] =
        (this.languageBreakdown[this.currentLanguage] || 0) + durationSeconds;
    }

    this.currentIntervalStart = 0;
    this.currentIntervalKeystrokes = 0;
    this.currentIntervalLinesAdded = 0;
    this.currentIntervalLinesDeleted = 0;
  }

  /**
   * Drain completed intervals for network synchronization
   */
  public flushIntervals(): {
    intervals: ActivityInterval[];
    totalActiveSeconds: number;
    languageBreakdown: Record<string, number>;
  } {
    // If currently ACTIVE, close interval up to now and immediately open next interval
    const now = Date.now();
    if (this.state === 'ACTIVE' && this.currentIntervalStart > 0) {
      this.closeCurrentInterval(now);
      this.currentIntervalStart = now;
      this.lastActivityTime = now;
    }

    const intervalsToSync = [...this.completedIntervals];
    this.completedIntervals = [];

    const totalActiveSeconds = intervalsToSync.reduce((acc, i) => acc + i.durationSeconds, 0);

    const breakdown: Record<string, number> = {};
    for (const i of intervalsToSync) {
      breakdown[i.language] = (breakdown[i.language] || 0) + i.durationSeconds;
    }

    return {
      intervals: intervalsToSync,
      totalActiveSeconds,
      languageBreakdown: breakdown
    };
  }

  /**
   * Re-queue intervals if sync failed
   */
  public reQueueIntervals(intervals: ActivityInterval[]) {
    this.completedIntervals = [...intervals, ...this.completedIntervals];
  }

  public getStats(): ActivityStats {
    let activeBonus = 0;
    if (this.state === 'ACTIVE' && this.currentIntervalStart > 0) {
      activeBonus = Math.max(0, Math.round((Date.now() - this.currentIntervalStart) / 1000));
    }

    return {
      sessionSeconds: this.totalSessionSeconds + activeBonus,
      todaySeconds: this.todaySeconds + activeBonus,
      currentLanguage: this.currentLanguage,
      state: this.state,
      isPaused: this.isPaused
    };
  }

  public setTodayBaselineSeconds(secs: number) {
    this.todaySeconds = Math.max(this.todaySeconds, secs);
    this.notify();
  }

  public stopSession() {
    this.closeCurrentInterval(Date.now());
    this.transitionState('STOPPED');
  }

  private transitionState(newState: ActivityState) {
    if (this.state !== newState) {
      this.state = newState;
      this.notify();
    }
  }

  private notify() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.state, this.getStats());
    }
  }
}
