import { STORAGE_KEYS } from "./constants";
import type {
  ConfirmedAccount,
  LeaderboardEntry,
  PendingProgressSync,
  PendingResultSync,
  ProgressSnapshot
} from "./types";

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

function createScopedKey(baseKey: string, accountId: string | null, modeId: string | null): string | null {
  if (!accountId || !modeId) {
    return null;
  }
  return `${baseKey}:${encodeURIComponent(accountId)}:${encodeURIComponent(modeId)}`;
}

function createTodayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type DailyJourneyState = {
  dayKey: string;
  steps: number;
};

export function loadConfirmedAccount(): ConfirmedAccount | null {
  return readJson<ConfirmedAccount | null>(STORAGE_KEYS.account, null);
}

export function saveConfirmedAccount(account: ConfirmedAccount): void {
  writeJson(STORAGE_KEYS.account, account);
}

export function clearConfirmedAccount(): void {
  localStorage.removeItem(STORAGE_KEYS.account);
}

export function loadSelectedGroupId(): string | null {
  return readJson<string | null>(STORAGE_KEYS.selectedGroupId, null);
}

export function saveSelectedGroupId(groupId: string): void {
  writeJson(STORAGE_KEYS.selectedGroupId, groupId);
}

export function loadSelectedModeId(): string | null {
  return readJson<string | null>(STORAGE_KEYS.selectedModeId, null);
}

export function saveSelectedModeId(modeId: string): void {
  writeJson(STORAGE_KEYS.selectedModeId, modeId);
}

export function loadLocalLeaderboard(): LeaderboardEntry[] {
  return readJson<LeaderboardEntry[]>(STORAGE_KEYS.leaderboard, []);
}

export function saveLocalLeaderboard(entries: LeaderboardEntry[]): void {
  writeJson(STORAGE_KEYS.leaderboard, entries);
}

export function loadProgress(accountId: string | null, modeId: string | null): ProgressSnapshot {
  const key = createScopedKey(STORAGE_KEYS.progress, accountId, modeId);
  return key ? readJson<ProgressSnapshot>(key, {}) : {};
}

export function saveProgress(accountId: string | null, modeId: string | null, progress: ProgressSnapshot): void {
  const key = createScopedKey(STORAGE_KEYS.progress, accountId, modeId);
  if (key) {
    writeJson(key, progress);
  }
}

export function loadPendingResults(): PendingResultSync[] {
  return readJson<PendingResultSync[]>(STORAGE_KEYS.pendingResults, []);
}

export function savePendingResults(items: PendingResultSync[]): void {
  writeJson(STORAGE_KEYS.pendingResults, items);
}

export function loadPendingProgress(): PendingProgressSync[] {
  return readJson<PendingProgressSync[]>(STORAGE_KEYS.pendingProgress, []);
}

export function savePendingProgress(items: PendingProgressSync[]): void {
  writeJson(STORAGE_KEYS.pendingProgress, items);
}

export function loadDailyJourneySteps(accountId: string | null, modeId: string | null): number {
  const key = createScopedKey(STORAGE_KEYS.journeyDaily, accountId, modeId);
  if (!key) {
    return 0;
  }
  const today = createTodayKey();
  const state = readJson<DailyJourneyState | null>(key, null);
  return state && state.dayKey === today ? state.steps : 0;
}

export function saveDailyJourneySteps(accountId: string | null, modeId: string | null, steps: number): void {
  const key = createScopedKey(STORAGE_KEYS.journeyDaily, accountId, modeId);
  if (!key) {
    return;
  }
  writeJson<DailyJourneyState>(key, { dayKey: createTodayKey(), steps });
}

export function loadSoundEnabled(): boolean {
  return readJson<boolean>(STORAGE_KEYS.soundEnabled, true);
}

export function saveSoundEnabled(enabled: boolean): void {
  writeJson(STORAGE_KEYS.soundEnabled, enabled);
}
