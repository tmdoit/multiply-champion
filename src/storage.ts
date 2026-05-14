import { STORAGE_KEYS } from "./constants";
import type { FactProgress } from "./types";

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
