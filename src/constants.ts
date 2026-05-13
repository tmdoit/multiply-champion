import type { HostConfig } from "./types";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }
  return value === "true";
}

function parseNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export const HOST_CONFIG: HostConfig = {
  taskCount: parseNumber(import.meta.env.VITE_TASK_COUNT as string | undefined, 10, 5, 30),
  selfImprovementMode: true,
  invites: {
    expirationHours: parseNumber(import.meta.env.VITE_INVITE_EXPIRATION_HOURS as string | undefined, 24, 1, 168)
  },
  modes: {
    defaultModeCode: (import.meta.env.VITE_DEFAULT_MODE_CODE as string | undefined)?.trim() || "to100-table10"
  },
  timer: {
    enabled: parseBoolean(import.meta.env.VITE_TIMER_ENABLED as string | undefined, true),
    secondsPerTask: parseNumber(
      import.meta.env.VITE_TIMER_SECONDS_PER_TASK as string | undefined,
      10,
      5,
      60
    )
  }
};

export const STORAGE_KEYS = {
  account: "multiply.account",
  selectedGroupId: "multiply.selectedGroupId",
  selectedModeId: "multiply.selectedModeId",
  leaderboard: "multiply.localLeaderboard",
  progress: "multiply.progress",
  pendingResults: "multiply.pendingResults",
  pendingProgress: "multiply.pendingProgress"
} as const;

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
