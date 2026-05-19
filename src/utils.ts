import { APP_CONFIG } from "./constants";
import type { FactKey, PathProgress, PathSummary, ProgressTone, SessionTask } from "./types";

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

export function getProgressTone(score: number): ProgressTone {
  if (score <= 3) {
    return "low";
  }
  if (score <= 7) {
    return "mid";
  }
  return "high";
}

export function getPathSummary(progress: PathProgress, multiplier: number): PathSummary {
  const score = clamp(progress[multiplier] ?? 0, 0, APP_CONFIG.factsPerPath);
  return {
    multiplier,
    label: `×${multiplier}`,
    score,
    totalTasks: APP_CONFIG.factsPerPath,
    completed: score >= APP_CONFIG.factsPerPath,
    tone: getProgressTone(score)
  };
}

export function getAllPathSummaries(progress: PathProgress): PathSummary[] {
  return Array.from({ length: APP_CONFIG.pathCount }, (_, index) => getPathSummary(progress, index + 1));
}

export function buildSessionQueue(multiplier: number): SessionTask[] {
  const tasks = Array.from({ length: APP_CONFIG.factsPerPath }, (_, index) => {
    const right = index + 1;
    return {
      left: multiplier,
      right,
      answer: multiplier * right,
      key: createFactKey(multiplier, right)
    } satisfies SessionTask;
  });

  return shuffle(tasks);
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}
