import { APP_CONFIG, STORAGE_KEYS } from "./constants";
import type { PathProgress } from "./types";

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

export function loadProgress(): PathProgress {
  const stored = readJson<Record<string, number>>(STORAGE_KEYS.progress, {});
  const next: PathProgress = {};
  for (let multiplier = 1; multiplier <= APP_CONFIG.pathCount; multiplier += 1) {
    next[multiplier] = Math.max(0, Math.min(APP_CONFIG.factsPerPath, stored[String(multiplier)] ?? 0));
  }
  return next;
}

export function saveProgress(progress: PathProgress): void {
  writeJson(STORAGE_KEYS.progress, progress);
}

export function loadChildName(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.childName)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveChildName(name: string): void {
  localStorage.setItem(STORAGE_KEYS.childName, name.trim());
}
