export function nextAgentPollDelay(unchangedPolls: number, consecutiveFailures = 0) {
  if (consecutiveFailures > 0) return Math.min(20_000, 2_000 * 2 ** Math.min(consecutiveFailures, 4));
  if (unchangedPolls >= 15) return 8_000;
  if (unchangedPolls >= 5) return 4_000;
  return 2_000;
}
