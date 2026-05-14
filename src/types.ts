export type Screen = "home" | "game" | "results";

export type FactKey = `${number}x${number}`;

export type FactPhase = "review" | "new";

export type FactProgress = Record<FactKey, number>;

export type PathSummary = {
  multiplier: number;
  label: string;
  steps: number;
  totalSteps: number;
  stars: number;
  masteredFacts: number;
  totalFacts: number;
  unlocked: boolean;
  completed: boolean;
  active: boolean;
};

export type SessionTask = {
  left: number;
  right: number;
  answer: number;
  key: FactKey;
  phase: FactPhase;
  stepBefore: number;
};

export type GameState = {
  pathMultiplier: number;
  queue: SessionTask[];
  currentIndex: number;
  input: string;
  feedback: { type: "correct" | "wrong"; text: string } | null;
  waitingForNext: boolean;
  pendingQueue: SessionTask[] | null;
  pendingIndex: number | null;
  feedbackDelayMs: number;
  startedAt: number;
  taskStartedAt: number;
  remainingMs: number;
  solvedCount: number;
  mistakeCount: number;
};

export type RunResult = {
  childName: string | null;
  pathMultiplier: number;
  completedPath: boolean;
  unlockedNextPath: boolean;
  fullyCompleted: boolean;
  totalTimeMs: number;
  steps: number;
  totalSteps: number;
  stars: number;
  masteredFacts: number;
  totalFacts: number;
  completedLapCount: number;
};
