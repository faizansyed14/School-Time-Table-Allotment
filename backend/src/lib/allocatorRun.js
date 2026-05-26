/** Tracks the active CP-SAT Python child process for cancel + status. */
let active = null;
let userCancelled = false;

function clearActive() {
  active = null;
}

function registerRun(child, timeLimitSeconds) {
  userCancelled = false;
  active = {
    child,
    startedAt: Date.now(),
    timeLimitSeconds: timeLimitSeconds || 90,
  };
  child.on('close', () => {
    if (active?.child === child) clearActive();
  });
}

function wasUserCancelled() {
  return userCancelled;
}

function isRunning() {
  return active != null && active.child && !active.child.killed;
}

function getStatus() {
  if (!isRunning()) return { running: false };
  return {
    running: true,
    startedAt: active.startedAt,
    timeLimitSeconds: active.timeLimitSeconds,
    elapsedMs: Date.now() - active.startedAt,
  };
}

function cancelRun() {
  userCancelled = true;
  if (!active?.child || active.child.killed) {
    clearActive();
    return false;
  }
  try {
    active.child.kill('SIGTERM');
    setTimeout(() => {
      if (active?.child && !active.child.killed) active.child.kill('SIGKILL');
    }, 2000);
  } catch (_) { /* ignore */ }
  clearActive();
  return true;
}

module.exports = {
  registerRun, isRunning, getStatus, cancelRun, clearActive, wasUserCancelled,
};
