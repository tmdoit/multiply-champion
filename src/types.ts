export type Screen = "home" | "game" | "results";

export type FactKey = `${number}x${number}`;

export type PathProgress = Record<number, number>;

export type ProgressTone = "low" | "mid" | "high";

export type PathSummary = {
  multiplier: number;
  label: string;
  score: number;
  totalTasks: number;
  completed: boolean;
  tone: ProgressTone;
};

export type SessionTask = {
  left: number;
  right: number;
  answer: number;
  key: FactKey;
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
  pathMultiplier: number;
  completedPath: boolean;
  totalTimeMs: number;
  score: number;
  totalTasks: number;
};
