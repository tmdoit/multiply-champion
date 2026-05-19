export const APP_CONFIG = {
  timerSecondsPerTask: 10,
  feedbackPauseMs: 1800,
  successFlashMs: 500,
  pathCount: 10,
  factsPerPath: 10
} as const;

export const STORAGE_KEYS = {
  progress: "multiply.localProgress"
} as const;
