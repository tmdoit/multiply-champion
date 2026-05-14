import type { FactKey, FactStats, FactTask, JourneyProgress, JourneyPathSummary, ModeSummary, ProgressSnapshot } from "./types";

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


const JOURNEY_MAX_STEP = 3;
const JOURNEY_DAILY_GOAL = 5;

export function getFactMasteryStep(stats?: FactStats): number {
  const normalized = normalizeFactStats(stats);
  return clamp(normalized.correct - normalized.wrong, 0, JOURNEY_MAX_STEP);
}

export function calculateJourneyProgress(
  mode: ModeSummary | null,
  progress: ProgressSnapshot,
  dailyGoalProgress: number
): JourneyProgress | null {
  if (!mode || mode.code !== "to100-table10") {
    return null;
  }

  const paths: JourneyPathSummary[] = [];
  const currentPathFactsByMultiplier = new Map<number, JourneyProgress["currentPathFacts"]>();
  let totalMasteredFacts = 0;
  let totalSteps = 0;

  for (let multiplier = 1; multiplier <= 10; multiplier += 1) {
    const facts = [];
    let pathSteps = 0;
    let masteredFacts = 0;
    for (let right = 1; right <= 10; right += 1) {
      const factKey = createFactKey(multiplier, right);
      const steps = getFactMasteryStep(progress[factKey]);
      const isMastered = steps >= JOURNEY_MAX_STEP;
      if (isMastered) {
        masteredFacts += 1;
        totalMasteredFacts += 1;
      }
      pathSteps += steps;
      facts.push({
        factKey,
        label: `${multiplier}×${right}`,
        steps,
        maxSteps: JOURNEY_MAX_STEP,
        isMastered
      });
    }
    totalSteps += pathSteps;
    const stars = Math.min(3, Math.floor(pathSteps / 10));
    const path = {
      multiplier,
      label: `×${multiplier}`,
      steps: pathSteps,
      totalSteps: 10 * JOURNEY_MAX_STEP,
      masteredFacts,
      totalFacts: 10,
      stars,
      isComplete: pathSteps >= 10 * JOURNEY_MAX_STEP
    };
    paths.push(path);
    currentPathFactsByMultiplier.set(multiplier, facts);
  }

  const currentPath = paths.find((path) => !path.isComplete) ?? paths[paths.length - 1];
  const nextStarThreshold = currentPath.stars >= 3 ? currentPath.totalSteps : (currentPath.stars + 1) * 10;
  const stepsToNextStar = currentPath.stars >= 3 ? 0 : Math.max(0, nextStarThreshold - currentPath.steps);
  const totalFacts = 100;

  return {
    currentPathLabel: currentPath.label,
    currentPathMultiplier: currentPath.multiplier,
    currentPathSteps: currentPath.steps,
    currentPathTotalSteps: currentPath.totalSteps,
    currentPathStars: currentPath.stars,
    currentPathMasteredFacts: currentPath.masteredFacts,
    currentPathTotalFacts: currentPath.totalFacts,
    stepsToNextStar,
    dailyGoalSteps: JOURNEY_DAILY_GOAL,
    dailyGoalProgress: Math.max(0, dailyGoalProgress),
    totalMasteredFacts,
    totalFacts,
    percentComplete: Math.round((totalSteps / (totalFacts * JOURNEY_MAX_STEP)) * 100),
    paths,
    currentPathFacts: currentPathFactsByMultiplier.get(currentPath.multiplier) ?? []
  };
}
