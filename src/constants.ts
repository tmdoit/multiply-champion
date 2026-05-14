export const APP_CONFIG = {
  timerSecondsPerTask: 10,
  feedbackPauseMs: 1800,
  successFlashMs: 500,
  pathCount: 10,
  factsPerPath: 10,
  stepsPerFact: 3,
  stepsPerStar: 10,
  pathTotalSteps: 30
} as const;

export const STORAGE_KEYS = {
  childName: "multiply.localChildName",
  progress: "multiply.localProgress"
} as const;
