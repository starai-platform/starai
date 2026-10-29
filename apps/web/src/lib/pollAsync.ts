/** Serial polling: slow requests never overlap; stopping aborts the active read. */
export function pollAsync(
  refresh: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  immediate = false,
  pauseWhenHidden = true,
  maxConsecutiveFailures = 5,
  onError?: (error: unknown, consecutiveFailures: number) => void,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let running = false;
  let consecutiveFailures = 0;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(tick, delay);
  };

  const tick = async () => {
    if (controller.signal.aborted) return;
    if (pauseWhenHidden && typeof document !== "undefined" && document.hidden) {
      schedule(intervalMs);
      return;
    }
    running = true;
    try {
      await refresh(controller.signal);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      onError?.(error, consecutiveFailures);
      // Keep retrying transient failures, but stop a permanently broken poll.
      if (consecutiveFailures >= maxConsecutiveFailures) {
        controller.abort();
        return;
      }
    } finally {
      running = false;
      if (!controller.signal.aborted) schedule(intervalMs);
    }
  };

  const resumeWhenVisible = () => {
    if (!controller.signal.aborted && !document.hidden && !running) schedule(0);
  };
  if (pauseWhenHidden && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", resumeWhenVisible);
  }

  timer = setTimeout(tick, immediate ? 0 : intervalMs);
  return () => {
    controller.abort();
    clearTimeout(timer);
    if (pauseWhenHidden && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    }
  };
}
