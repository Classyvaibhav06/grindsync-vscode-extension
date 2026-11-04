import { ActivityEngine } from '../src/ActivityEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log('--- Running GrindSync ActivityEngine Test Suite ---');

// 1. Initial State
const engine = new ActivityEngine({
  idleTimeoutSeconds: 60,
  sessionTimeoutMinutes: 15,
  filterAiFormatterBursts: true,
});

assert(engine.getState() === 'IDLE', 'Initial engine state should be IDLE');

// 2. Transition to ACTIVE on document change (simulate 10 seconds of editing)
const t0 = Date.now();
engine.recordActivity('typescript', 5, 2, 0);
assert(engine.getState() === 'ACTIVE', 'Engine should transition to ACTIVE on typing');

// Simulate 10s of sustained typing
const t10 = t0 + 10000;
engine.recordActivity('typescript', 12, 1, 0, t10);

// 3. Idle detection after timeout (65 seconds after last edit at t10)
const futureTime = t10 + 65000;
engine.checkIdleThreshold(futureTime);
assert(engine.getState() === 'IDLE', 'Engine should transition to IDLE after 60s inactivity');

// 4. Drain & Flush intervals
const flushed = engine.flushIntervals();
assert(flushed.intervals.length >= 1, 'Flushed intervals should contain at least 1 record');
assert(flushed.languageBreakdown['typescript'] !== undefined, 'Language breakdown should track typescript');
console.log('Flushed interval summary:', flushed);

// 5. Manual pause & resume
engine.setPaused(true);
assert(engine.isTrackingPaused() === true, 'Engine should be paused');
engine.recordActivity('typescript', 10, 5, 0);
assert(engine.getState() === 'IDLE', 'Typing while paused should not transition to ACTIVE');

engine.setPaused(false);
engine.recordActivity('typescript', 10, 5, 0);
assert(engine.getState() === 'ACTIVE', 'Typing after unpausing should resume ACTIVE state');

console.log('🎉 ALL ACTIVITY ENGINE TESTS PASSED!');
