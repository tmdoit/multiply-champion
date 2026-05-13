import type { FactKey, FactStats, FactTask, ProgressSnapshot } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createFactKey(left: number, right: number): FactKey {
  return `${left}x${right}`;
}

export function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function normalizeFactStats(stats?: FactStats): FactStats {
  return {
    attempts: stats?.attempts ?? 0,
    correct: stats?.correct ?? 0,
    wrong: stats?.wrong ?? 0,
    averageMs: stats?.averageMs ?? 0,
    lastAnsweredAt: stats?.lastAnsweredAt ?? null
  };
}

export function mergeProgressSnapshots(
  base: ProgressSnapshot,
  incoming: ProgressSnapshot
): ProgressSnapshot {
  const merged: ProgressSnapshot = { ...base };
  for (const [key, incomingStats] of Object.entries(incoming)) {
    const current = normalizeFactStats(merged[key as FactKey]);
    const next = normalizeFactStats(incomingStats);
    const attempts = current.attempts + next.attempts;
    const averageMs =
      attempts === 0
        ? 0
        : Math.round(
            (current.averageMs * current.attempts + next.averageMs * next.attempts) / attempts
          );

    merged[key as FactKey] = {
      attempts,
      correct: current.correct + next.correct,
      wrong: current.wrong + next.wrong,
      averageMs,
      lastAnsweredAt:
        [current.lastAnsweredAt, next.lastAnsweredAt].filter(Boolean).sort().slice(-1)[0] ?? null
    };
  }
  return merged;
}

export function buildFactPool(maxResult: number, factorLimit: number | null): FactTask[] {
  const pool: FactTask[] = [];
  const maxFactor = factorLimit ?? maxResult;
  for (let left = 1; left <= maxFactor; left += 1) {
    for (let right = 1; right <= maxFactor; right += 1) {
      const answer = left * right;
      if (answer <= maxResult) {
        pool.push({
          left,
          right,
          answer,
          key: createFactKey(left, right)
        });
      }
    }
  }
  return pool;
}

export function pickWeightedTasks(
  pool: FactTask[],
  count: number,
  progress: ProgressSnapshot
): FactTask[] {
  const selected: FactTask[] = [];
  const available = [...pool];

  while (selected.length < count && available.length > 0) {
    const weights = available.map((task) => {
      const stats = normalizeFactStats(progress[task.key]);
      const successRate = stats.attempts === 0 ? 0 : stats.correct / stats.attempts;
      const weaknessBoost = 1 + stats.wrong * 0.7 + (1 - successRate) * 2;
      const masteryPenalty = Math.max(0.35, 1 - stats.correct * 0.08);
      const speedBoost = stats.averageMs > 8000 ? 1.25 : 1;
      return weaknessBoost * masteryPenalty * speedBoost;
    });

    const index = weightedRandomIndex(weights);
    selected.push(available[index]);
    available.splice(index, 1);
  }

  return selected;
}

function weightedRandomIndex(weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = Math.random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    threshold -= weights[index];
    if (threshold <= 0) {
      return index;
    }
  }
  return weights.length - 1;
}
