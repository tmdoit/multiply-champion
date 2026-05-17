import { APP_CONFIG } from "./constants";
import type { EnabledPathMap, FactKey, FactProgress, PathSummary, SessionTask } from "./types";

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

export function getEnabledMultipliers(enabledPaths: EnabledPathMap): number[] {
  return Array.from({ length: APP_CONFIG.pathCount }, (_, index) => index + 1).filter(
    (multiplier) => enabledPaths[multiplier] !== false
  );
}

export function getPathSummary(
  progress: FactProgress,
  multiplier: number,
  activeMultiplier: number | null,
  enabledPaths: EnabledPathMap
): PathSummary {
  let steps = 0;
  let masteredFacts = 0;

  for (let right = 1; right <= APP_CONFIG.factsPerPath; right += 1) {
    const step = getFactStep(progress, createFactKey(multiplier, right));
    steps += step;
    if (step >= APP_CONFIG.stepsPerFact) {
      masteredFacts += 1;
    }
  }

  const enabled = enabledPaths[multiplier] !== false;
  const enabledMultipliers = getEnabledMultipliers(enabledPaths);
  const activeIndex = activeMultiplier ? enabledMultipliers.indexOf(activeMultiplier) : -1;
  const currentIndex = enabledMultipliers.indexOf(multiplier);
  const unlocked = enabled && (activeMultiplier === null || currentIndex <= activeIndex || steps >= APP_CONFIG.pathTotalSteps);

  return {
    multiplier,
    label: `×${multiplier}`,
    steps,
    totalSteps: APP_CONFIG.pathTotalSteps,
    stars: Math.min(3, Math.floor(steps / APP_CONFIG.stepsPerStar)),
    masteredFacts,
    totalFacts: APP_CONFIG.factsPerPath,
    unlocked,
    completed: steps >= APP_CONFIG.pathTotalSteps,
    active: enabled && multiplier === activeMultiplier,
    enabled
  };
}

export function getActiveMultiplier(progress: FactProgress, enabledPaths: EnabledPathMap): number | null {
  for (const multiplier of getEnabledMultipliers(enabledPaths)) {
    const steps = Array.from({ length: APP_CONFIG.factsPerPath }, (_, index) =>
      getFactStep(progress, createFactKey(multiplier, index + 1))
    ).reduce((sum, step) => sum + step, 0);
    if (steps < APP_CONFIG.pathTotalSteps) {
      return multiplier;
    }
  }
  return null;
}

export function getAllPathSummaries(progress: FactProgress, enabledPaths: EnabledPathMap): PathSummary[] {
  const activeMultiplier = getActiveMultiplier(progress, enabledPaths);
  return Array.from({ length: APP_CONFIG.pathCount }, (_, index) =>
    getPathSummary(progress, index + 1, activeMultiplier, enabledPaths)
  );
}

export function getOverallSteps(progress: FactProgress, enabledPaths: EnabledPathMap): number {
  return getAllPathSummaries(progress, enabledPaths)
    .filter((path) => path.enabled)
    .reduce((sum, path) => sum + path.steps, 0);
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

export function resetEnabledPathProgress(progress: FactProgress, enabledPaths: EnabledPathMap): FactProgress {
  const next = { ...progress };
  for (const multiplier of getEnabledMultipliers(enabledPaths)) {
    for (let right = 1; right <= APP_CONFIG.factsPerPath; right += 1) {
      next[createFactKey(multiplier, right)] = 0;
    }
  }
  return next;
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
