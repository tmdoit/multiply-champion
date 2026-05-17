import { APP_CONFIG, STORAGE_KEYS } from "./constants";
import type { EnabledPathMap, FactProgress } from "./types";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function createDefaultEnabledPaths(): EnabledPathMap {
  return Object.fromEntries(
    Array.from({ length: APP_CONFIG.pathCount }, (_, index) => [index + 1, true])
  ) as EnabledPathMap;
}

export function loadChildName(): string {
  return readJson<string>(STORAGE_KEYS.childName, "");
}

export function saveChildName(name: string): void {
  writeJson(STORAGE_KEYS.childName, name);
}

export function loadProgress(): FactProgress {
  return readJson<FactProgress>(STORAGE_KEYS.progress, {});
}

export function saveProgress(progress: FactProgress): void {
  writeJson(STORAGE_KEYS.progress, progress);
}

export function loadLapCount(): number {
  return readJson<number>(STORAGE_KEYS.lapCount, 0);
}

export function saveLapCount(count: number): void {
  writeJson(STORAGE_KEYS.lapCount, count);
}

export function loadEnabledPaths(): EnabledPathMap {
  const stored = readJson<EnabledPathMap>(STORAGE_KEYS.enabledPaths, createDefaultEnabledPaths());
  const fallback = createDefaultEnabledPaths();
  for (let multiplier = 1; multiplier <= APP_CONFIG.pathCount; multiplier += 1) {
    fallback[multiplier] = stored[multiplier] !== false;
  }
  return fallback;
}

export function saveEnabledPaths(enabledPaths: EnabledPathMap): void {
  writeJson(STORAGE_KEYS.enabledPaths, enabledPaths);
}
