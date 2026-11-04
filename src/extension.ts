import * as vscode from 'vscode';
import * as os from 'os';
import { ActivityEngine } from './ActivityEngine';
import { SyncClient } from './SyncClient';
import { ActivityStats } from './types';

const SECRET_KEY_TOKEN = 'grindsync.deviceToken';
const SECRET_KEY_DEVICE_ID = 'grindsync.deviceId';
const SECRET_KEY_USERNAME = 'grindsync.username';

let statusBarItem: vscode.StatusBarItem;
let activityEngine: ActivityEngine;
let syncClient: SyncClient;

let heartbeatTimer: NodeJS.Timeout | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let idleCheckTimer: NodeJS.Timeout | null = null;

export async function activate(context: vscode.ExtensionContext) {
  console.log('GrindSync Activity Tracker activating...');

  const config = vscode.workspace.getConfiguration('grindsync');
  const apiUrl = config.get<string>('apiUrl', 'https://grindsync.vercel.app');

  syncClient = new SyncClient(apiUrl);

  // Initialize Activity Engine with user settings
  activityEngine = new ActivityEngine({
    idleTimeoutSeconds: config.get<number>('idleTimeoutSeconds', 60),
    sessionTimeoutMinutes: config.get<number>('sessionTimeoutMinutes', 15),
    filterAiFormatterBursts: config.get<boolean>('filterAiFormatterBursts', true)
  });

  // Setup Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'grindsync.status';
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  // Load saved credentials from VS Code SecretStorage
  const savedToken = await context.secrets.get(SECRET_KEY_TOKEN);
  if (savedToken) {
    syncClient.setToken(savedToken);
    refreshBaselineStats();
  }

  // Update status bar when activity state changes
  activityEngine.onStateChange((state, stats) => {
    updateStatusBar(stats);
  });

  updateStatusBar(activityEngine.getStats());

  // ── Register VS Code Event Listeners ──────────────────────────

  // 1. Text Document Change: Primary signal for human typing
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Ignore output panels or internal git/diff documents
      if (event.document.uri.scheme !== 'file' && event.document.uri.scheme !== 'untitled') {
        return;
      }

      // Filter empty changes
      if (!event.contentChanges || event.contentChanges.length === 0) {
        return;
      }

      let totalAddedChars = 0;
      let totalDeletedChars = 0;
      let linesAdded = 0;
      let linesDeleted = 0;

      for (const change of event.contentChanges) {
        totalAddedChars += change.text.length;
        totalDeletedChars += change.rangeLength;
        linesAdded += (change.text.match(/\n/g) || []).length;
        linesDeleted += change.range.end.line - change.range.start.line;
      }

      // Sensible filtering: Detect massive AI code-gen or formatters (>1500 chars in single tick)
      const filterBursts = vscode.workspace.getConfiguration('grindsync').get<boolean>('filterAiFormatterBursts', true);
      if (filterBursts && totalAddedChars > 1500) {
        // Count as a single macro edit step, don't inflate artificial activity
        activityEngine.recordActivity(event.document.languageId, 1, linesAdded, linesDeleted);
        return;
      }

      const keystrokes = Math.max(1, Math.min(50, totalAddedChars + totalDeletedChars));
      activityEngine.recordActivity(event.document.languageId, keystrokes, linesAdded, linesDeleted);
    })
  );

  // 2. Window Focus changes
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((windowState) => {
      if (!windowState.focused) {
        // Window lost focus -> check idle immediately
        activityEngine.checkIdleThreshold(Date.now());
      }
    })
  );

  // 3. Active Editor changes (tracks active language)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document) {
        // Switching tabs does NOT artificially add time, but updates the active language tracker
        activityEngine.checkIdleThreshold(Date.now());
      }
    })
  );

  // ── Periodic Background Timers ─────────────────────────────────

  // 1. Idle Threshold Checker (every 5 seconds)
  idleCheckTimer = setInterval(() => {
    activityEngine.checkIdleThreshold(Date.now());
    updateStatusBar(activityEngine.getStats());
  }, 5000);

  // 2. Periodic Heartbeat (every 30s)
  const hbInterval = config.get<number>('heartbeatIntervalSeconds', 30) * 1000;
  heartbeatTimer = setInterval(async () => {
    if (!syncClient.hasToken()) return;
    const stats = activityEngine.getStats();
    const deviceId = (await context.secrets.get(SECRET_KEY_DEVICE_ID)) || 'unknown-device';

    await syncClient.sendHeartbeat({
      deviceId,
      deviceName: os.hostname(),
      sessionId: activityEngine.getSessionId(),
      state: stats.state,
      currentLanguage: stats.currentLanguage,
      clientTimestamp: Date.now()
    });
  }, hbInterval);

  // 3. Activity Batch Synchronization (every 60s)
  const syncInterval = config.get<number>('syncIntervalSeconds', 60) * 1000;
  syncTimer = setInterval(() => {
    flushAndSyncIntervals(context);
  }, syncInterval);

  // ── Register Commands ──────────────────────────────────────────

  // Command: Pair Account
  context.subscriptions.push(
    vscode.commands.registerCommand('grindsync.pair', async () => {
      const code = await vscode.window.showInputBox({
        prompt: 'Enter the 6-digit pairing code from GrindSync (Settings → Connected IDEs)',
        placeHolder: 'e.g. 849201',
        validateInput: (val) => (!val || val.trim().length < 6 ? 'Please enter a valid 6-digit code' : null)
      });

      if (!code) return;

      const deviceName = os.hostname();
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Pairing with GrindSync as "${deviceName}"...`,
          cancellable: false
        },
        async () => {
          const res = await syncClient.pair(code, deviceName);
          if (res.success && res.token) {
            await context.secrets.store(SECRET_KEY_TOKEN, res.token);
            if (res.deviceId) await context.secrets.store(SECRET_KEY_DEVICE_ID, res.deviceId);
            if (res.username) await context.secrets.store(SECRET_KEY_USERNAME, res.username);
            syncClient.setToken(res.token);

            vscode.window.showInformationMessage(
              `✨ Successfully paired with GrindSync (${res.username || 'Connected'})!`
            );
            refreshBaselineStats();
          } else {
            vscode.window.showErrorMessage(`GrindSync pairing failed: ${res.error || 'Invalid code'}`);
          }
        }
      );
    })
  );

  // Command: Disconnect Account
  context.subscriptions.push(
    vscode.commands.registerCommand('grindsync.disconnect', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to disconnect GrindSync from this device?',
        'Yes, Disconnect',
        'Cancel'
      );
      if (confirm === 'Yes, Disconnect') {
        await context.secrets.delete(SECRET_KEY_TOKEN);
        await context.secrets.delete(SECRET_KEY_DEVICE_ID);
        await context.secrets.delete(SECRET_KEY_USERNAME);
        syncClient.setToken(null);
        vscode.window.showInformationMessage('GrindSync disconnected from this device.');
        updateStatusBar(activityEngine.getStats());
      }
    })
  );

  // Command: Pause Tracking
  context.subscriptions.push(
    vscode.commands.registerCommand('grindsync.pause', () => {
      activityEngine.setPaused(true);
      vscode.window.showInformationMessage('⏸️ GrindSync tracking paused.');
    })
  );

  // Command: Resume Tracking
  context.subscriptions.push(
    vscode.commands.registerCommand('grindsync.resume', () => {
      activityEngine.setPaused(false);
      vscode.window.showInformationMessage('▶️ GrindSync tracking resumed.');
    })
  );

  // Command: Sync Now
  context.subscriptions.push(
    vscode.commands.registerCommand('grindsync.syncNow', async () => {
      await flushAndSyncIntervals(context, true);
    })
  );

  // Command: Open Dashboard
  context.subscriptions.push(
    vscode.commands.registerCommand('grindsync.openDashboard', () => {
      const cfg = vscode.workspace.getConfiguration('grindsync');
      const rootUrl = cfg.get<string>('apiUrl', 'https://grindsync.vercel.app');
      vscode.env.openExternal(vscode.Uri.parse(`${rootUrl}/settings/connected-ides`));
    })
  );

  // Command: Status Details Dialog
  context.subscriptions.push(
    vscode.commands.registerCommand('grindsync.status', async () => {
      const stats = activityEngine.getStats();
      const isAuth = syncClient.hasToken();
      const username = (await context.secrets.get(SECRET_KEY_USERNAME)) || 'Not Paired';

      const items: vscode.QuickPickItem[] = [
        {
          label: `GrindSync: ${isAuth ? `Connected (@${username})` : 'Not Paired'}`,
          description: isAuth ? 'Synced with account' : 'Click to pair',
          detail: `Status: ${stats.state} | Today: ${formatDuration(stats.todaySeconds)} | Current Language: ${stats.currentLanguage}`
        },
        {
          label: stats.isPaused ? '▶️ Resume Tracking' : '⏸️ Pause Tracking',
          description: stats.isPaused ? 'Unpause automatic activity detection' : 'Temporarily stop logging time'
        },
        {
          label: '🔄 Synchronize Activity Now',
          description: 'Flush pending intervals to GrindSync cloud'
        },
        {
          label: '🌐 Open Connected IDEs Dashboard',
          description: 'View leaderboard status, streaks, and connected devices'
        }
      ];

      if (isAuth) {
        items.push({
          label: '❌ Disconnect Device',
          description: 'Revoke this IDE token from GrindSync'
        });
      } else {
        items.push({
          label: '🔑 Enter Pairing Code',
          description: 'Connect this extension to GrindSync'
        });
      }

      const sel = await vscode.window.showQuickPick(items);
      if (!sel) return;

      if (sel.label.includes('Pairing Code')) vscode.commands.executeCommand('grindsync.pair');
      else if (sel.label.includes('Disconnect')) vscode.commands.executeCommand('grindsync.disconnect');
      else if (sel.label.includes('Pause')) vscode.commands.executeCommand('grindsync.pause');
      else if (sel.label.includes('Resume')) vscode.commands.executeCommand('grindsync.resume');
      else if (sel.label.includes('Synchronize')) vscode.commands.executeCommand('grindsync.syncNow');
      else if (sel.label.includes('Dashboard')) vscode.commands.executeCommand('grindsync.openDashboard');
    })
  );
}

async function flushAndSyncIntervals(context: vscode.ExtensionContext, notifyUser: boolean = false) {
  if (!syncClient.hasToken()) {
    if (notifyUser) {
      vscode.window.showWarningMessage('GrindSync is not paired yet. Click status bar to pair.');
    }
    return;
  }

  const flushed = activityEngine.flushIntervals();
  if (flushed.intervals.length === 0) {
    if (notifyUser) {
      vscode.window.showInformationMessage('All activity is already up to date!');
    }
    return;
  }

  const deviceId = (await context.secrets.get(SECRET_KEY_DEVICE_ID)) || 'unknown-device';
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const res = await syncClient.syncBatch({
    batchId,
    deviceId,
    deviceName: os.hostname(),
    sessionId: activityEngine.getSessionId(),
    clientTimestamp: Date.now(),
    intervals: flushed.intervals,
    languageBreakdown: flushed.languageBreakdown,
    totalActiveSeconds: flushed.totalActiveSeconds
  });

  if (res.success) {
    if (res.totalTodaySeconds) {
      activityEngine.setTodayBaselineSeconds(res.totalTodaySeconds);
    }
    if (notifyUser) {
      vscode.window.showInformationMessage(
        `Synced +${formatDuration(flushed.totalActiveSeconds)}! (XP: +${res.pointsAwarded || 0})`
      );
    }
  } else {
    // If sync failed, re-queue intervals so no time is lost
    activityEngine.reQueueIntervals(flushed.intervals);
    if (notifyUser) {
      vscode.window.showErrorMessage(`Sync failed: ${res.error || 'Will retry automatically'}`);
    }
  }
}

async function refreshBaselineStats() {
  if (!syncClient.hasToken()) return;
  const stats = await syncClient.getStats();
  if (stats.success && typeof stats.todaySeconds === 'number') {
    activityEngine.setTodayBaselineSeconds(stats.todaySeconds);
  }
}

function updateStatusBar(stats: ActivityStats) {
  if (!statusBarItem) return;

  const isAuth = syncClient?.hasToken() ?? false;
  if (!isAuth) {
    statusBarItem.text = `$(plug) GrindSync: Pair IDE`;
    statusBarItem.tooltip = 'Click to connect GrindSync account';
    return;
  }

  if (stats.isPaused) {
    statusBarItem.text = `$(debug-pause) GrindSync: Paused`;
    statusBarItem.tooltip = 'Tracking is paused. Click to resume.';
    return;
  }

  let stateIcon = '$(circle-slash)';
  if (stats.state === 'ACTIVE') stateIcon = '$(pulse)';
  else if (stats.state === 'IDLE') stateIcon = '$(clock)';

  const formatted = formatDuration(stats.todaySeconds);
  statusBarItem.text = `${stateIcon} GrindSync: ${formatted}`;
  statusBarItem.tooltip = `GrindSync Status: ${stats.state}\nToday's Verified Coding: ${formatted}\nActive Language: ${stats.currentLanguage}\nClick for options.`;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function deactivate() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (syncTimer) clearInterval(syncTimer);
  if (idleCheckTimer) clearInterval(idleCheckTimer);
  if (activityEngine) activityEngine.stopSession();
}
