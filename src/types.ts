export type Screen = "home" | "game" | "results" | "leaderboard" | "activity" | "group" | "chat" | "stats";

export type HostConfig = {
  taskCount: number;
  selfImprovementMode: boolean;
  invites: {
    expirationHours: number;
  };
  modes: {
    defaultModeCode: string;
  };
  timer: {
    enabled: boolean;
    secondsPerTask: number;
  };
};

export type ConfirmedAccount = {
  accountId: string;
  childName: string;
  sessionToken: string;
  confirmedAt: string;
};

export type GroupSummary = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
  ownerAccountId: string | null;
  ownerChildName: string | null;
  displayName: string;
  invitedName: string | null;
  isSystem: boolean;
};

export type GroupMember = {
  accountId: string;
  childName: string;
  role: "owner" | "admin" | "member";
  displayName: string;
  invitedName: string | null;
  joinedAt: string;
};

export type GroupInvite = {
  id: string;
  invitedName: string;
  expiresAt: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  inviteToken: string;
  invitedByChildName: string | null;
  acceptedByAccountId: string | null;
};

export type InvitePreview = {
  groupId: string;
  groupName: string;
  invitedName: string;
  expiresAt: string;
  status: "pending" | "accepted" | "expired" | "revoked";
};

export type ModeSummary = {
  id: string;
  code: string;
  label: string;
  resultLimit: number;
  factorLimit: number | null;
  isDefault: boolean;
};

export type ActivityEvent = {
  id: string;
  groupId: string;
  accountId: string | null;
  modeId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type GroupChatMessage = {
  id: string;
  groupId: string;
  accountId: string;
  childName: string;
  displayName: string;
  message: string;
  createdAt: string;
};

export type PlayerFactStat = {
  factKey: string;
  attempts: number;
  correct: number;
  wrong: number;
  averageMs: number;
};

export type PlayerStats = {
  bestTimeMs: number | null;
  gamesPlayed: number;
  totalFactsAnswered: number;
  strongestFacts: PlayerFactStat[];
  needsPracticeFacts: PlayerFactStat[];
};

export type FactKey = `${number}x${number}`;

export type FactStats = {
  attempts: number;
  correct: number;
  wrong: number;
  averageMs: number;
  lastAnsweredAt: string | null;
};

export type ProgressSnapshot = Record<FactKey, FactStats>;

export type LeaderboardEntry = {
  id: string;
  modeId?: string;
  childName: string;
  correctAnswers: number;
  totalTasks: number;
  totalTimeMs: number;
  createdAt: string;
};

export type PendingResultSync = {
  id: string;
  accountId: string;
  modeId: string;
  childName: string;
  correctAnswers: number;
  totalTasks: number;
  totalTimeMs: number;
  createdAt: string;
  synced: boolean;
};

export type PendingProgressSync = {
  id: string;
  accountId: string;
  modeId: string;
  delta: ProgressSnapshot;
  updatedAt: string;
  synced: boolean;
};

export type FactTask = {
  left: number;
  right: number;
  answer: number;
  key: FactKey;
};

export type CompletedGame = {
  correctAnswers: number;
  totalTasks: number;
  totalTimeMs: number;
  childName: string;
  synced: boolean;
  isNewBest: boolean;
  bestTimeMs: number;
};

export type AuthResponse = {
  account: ConfirmedAccount;
  groups: GroupSummary[];
  modes: ModeSummary[];
  currentModeId: string;
  progress: ProgressSnapshot;
};

export type MeResponse = {
  account: {
    accountId: string;
    childName: string;
  };
  groups: GroupSummary[];
  modes: ModeSummary[];
  currentModeId: string;
  progress: ProgressSnapshot;
};
