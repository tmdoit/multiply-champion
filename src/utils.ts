import { APP_CONFIG } from "./constants";
import type { FactKey, FactProgress, PathSummary, SessionTask } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createFactKey(left: number, right: number): FactKey {
  return `${left}x${right}`;
}

export function formatMs(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((safeMs % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

export function getFactStep(progress: FactProgress, factKey: FactKey): number {
  return clamp(progress[factKey] ?? 0, 0, APP_CONFIG.stepsPerFact);
}

export function updateFactStep(progress: FactProgress, factKey: FactKey, delta: number): FactProgress {
  const nextStep = clamp(getFactStep(progress, factKey) + delta, 0, APP_CONFIG.stepsPerFact);
  return {
    ...progress,
    [factKey]: nextStep
  };
}

export function getPathSummary(progress: FactProgress, multiplier: number, activeMultiplier: number): PathSummary {
  let steps = 0;
  let masteredFacts = 0;

  for (let right = 1; right <= APP_CONFIG.factsPerPath; right += 1) {
    const step = getFactStep(progress, createFactKey(multiplier, right));
    steps += step;
    if (step >= APP_CONFIG.stepsPerFact) {
      masteredFacts += 1;
    }
  }

  return {
    multiplier,
    label: `×${multiplier}`,
    steps,
    totalSteps: APP_CONFIG.pathTotalSteps,
    stars: Math.min(3, Math.floor(steps / APP_CONFIG.stepsPerStar)),
    masteredFacts,
    totalFacts: APP_CONFIG.factsPerPath,
    unlocked: multiplier <= activeMultiplier,
    completed: steps >= APP_CONFIG.pathTotalSteps,
    active: multiplier === activeMultiplier
  };
}

export function getActiveMultiplier(progress: FactProgress): number {
  for (let multiplier = 1; multiplier <= APP_CONFIG.pathCount; multiplier += 1) {
    const summary = getPathSummary(progress, multiplier, multiplier);
    if (!summary.completed) {
      return multiplier;
    }
  }
  return APP_CONFIG.pathCount;
}

export function getAllPathSummaries(progress: FactProgress): PathSummary[] {
  const activeMultiplier = getActiveMultiplier(progress);
  return Array.from({ length: APP_CONFIG.pathCount }, (_, index) =>
    getPathSummary(progress, index + 1, activeMultiplier)
  );
}

export function getOverallSteps(progress: FactProgress): number {
  return getAllPathSummaries(progress).reduce((sum, path) => sum + path.steps, 0);
}

export function buildSessionQueue(progress: FactProgress, multiplier: number): SessionTask[] {
  const review: SessionTask[] = [];
  const fresh: SessionTask[] = [];

  for (let right = 1; right <= APP_CONFIG.factsPerPath; right += 1) {
    const step = getFactStep(progress, createFactKey(multiplier, right));
    if (step >= APP_CONFIG.stepsPerFact) {
      continue;
    }
    const task: SessionTask = {
      left: multiplier,
      right,
      answer: multiplier * right,
      key: createFactKey(multiplier, right),
      phase: step === 0 ? "new" : "review",
      stepBefore: step
    };
    if (step === 0) {
      fresh.push(task);
    } else {
      review.push(task);
    }
  }

  return [...shuffle(review), ...shuffle(fresh)];
}

export function describeStep(step: number): string {
  if (step <= 0) {
    return "nie ruszona";
  }
  if (step === 1) {
    return "zaczynam umieć";
  }
  if (step === 2) {
    return "prawie umiem";
  }
  return "opanowana";
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}
