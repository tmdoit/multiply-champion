import { API_BASE_URL } from "./constants";
import type {
  ActivityEvent,
  AuthResponse,
  GroupChatMessage,
  GroupInvite,
  GroupMember,
  GroupSummary,
  InvitePreview,
  LeaderboardEntry,
  MeResponse,
  PendingProgressSync,
  PendingResultSync,
  PlayerStats
} from "./types";

function createUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function hasApi(): boolean {
  return API_BASE_URL.length > 0;
}

function createAuthHeaders(sessionToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${sessionToken}`
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }
    if (response.status === 409) {
      throw new Error("NAME_TAKEN");
    }
    if (response.status === 410) {
      throw new Error("INVITE_EXPIRED");
    }
    throw new Error("REQUEST_FAILED");
  }
  return (await response.json()) as T;
}

export async function registerAccount(childName: string, pin: string): Promise<AuthResponse> {
  const response = await fetch(createUrl("/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ childName, pin })
  });
  return parseJson<AuthResponse>(response);
}

export async function loginAccount(childName: string, pin: string): Promise<AuthResponse> {
  const response = await fetch(createUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ childName, pin })
  });
  return parseJson<AuthResponse>(response);
}

export async function fetchMe(sessionToken: string, modeId: string): Promise<MeResponse> {
  const response = await fetch(createUrl(`/me?modeId=${encodeURIComponent(modeId)}`), {
    headers: createAuthHeaders(sessionToken)
  });
  return parseJson<MeResponse>(response);
}

export async function createGroup(name: string, sessionToken: string): Promise<GroupSummary[]> {
  const response = await fetch(createUrl("/groups"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createAuthHeaders(sessionToken)
    },
    body: JSON.stringify({ name })
  });
  return parseJson<GroupSummary[]>(response);
}

export async function fetchGroupMembers(groupId: string, sessionToken: string): Promise<GroupMember[]> {
  const response = await fetch(createUrl(`/groups/${encodeURIComponent(groupId)}/members`), {
    headers: createAuthHeaders(sessionToken)
  });
  return parseJson<GroupMember[]>(response);
}

export async function grantAdmin(groupId: string, targetAccountId: string, sessionToken: string): Promise<void> {
  const response = await fetch(
    createUrl(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(targetAccountId)}/admin`),
    { method: "POST", headers: createAuthHeaders(sessionToken) }
  );
  await parseJson<{ ok: true }>(response);
}

export async function revokeAdmin(groupId: string, targetAccountId: string, sessionToken: string): Promise<void> {
  const response = await fetch(
    createUrl(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(targetAccountId)}/admin`),
    { method: "DELETE", headers: createAuthHeaders(sessionToken) }
  );
  await parseJson<{ ok: true }>(response);
}

export async function removeGroupMember(groupId: string, targetAccountId: string, sessionToken: string): Promise<void> {
  const response = await fetch(
    createUrl(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(targetAccountId)}`),
    { method: "DELETE", headers: createAuthHeaders(sessionToken) }
  );
  await parseJson<{ ok: true }>(response);
}

export async function fetchGroups(sessionToken: string): Promise<GroupSummary[]> {
  const response = await fetch(createUrl("/groups"), { headers: createAuthHeaders(sessionToken) });
  return parseJson<GroupSummary[]>(response);
}

export async function leaveGroup(groupId: string, sessionToken: string): Promise<void> {
  const response = await fetch(createUrl(`/groups/${encodeURIComponent(groupId)}`), {
    method: "DELETE",
    headers: createAuthHeaders(sessionToken)
  });
  await parseJson<{ ok: true }>(response);
}

export async function createInvite(
  groupId: string,
  invitedName: string,
  expiresInHours: number,
  sessionToken: string
): Promise<{ inviteId: string; inviteToken: string; expiresAt: string }> {
  const response = await fetch(createUrl(`/groups/${encodeURIComponent(groupId)}/invites`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createAuthHeaders(sessionToken)
    },
    body: JSON.stringify({ invitedName, expiresInHours })
  });
  return parseJson<{ inviteId: string; inviteToken: string; expiresAt: string }>(response);
}

export async function fetchGroupInvites(groupId: string, sessionToken: string): Promise<GroupInvite[]> {
  const response = await fetch(createUrl(`/groups/${encodeURIComponent(groupId)}/invites`), {
    headers: createAuthHeaders(sessionToken)
  });
  return parseJson<GroupInvite[]>(response);
}

export async function revokeInvite(groupId: string, inviteId: string, sessionToken: string): Promise<void> {
  const response = await fetch(
    createUrl(`/groups/${encodeURIComponent(groupId)}/invites/${encodeURIComponent(inviteId)}`),
    { method: "DELETE", headers: createAuthHeaders(sessionToken) }
  );
  await parseJson<{ ok: true }>(response);
}

export async function fetchInvitePreview(inviteToken: string): Promise<InvitePreview> {
  const response = await fetch(createUrl(`/invites/preview?token=${encodeURIComponent(inviteToken)}`));
  return parseJson<InvitePreview>(response);
}

export async function acceptInvite(inviteToken: string, displayName: string, sessionToken: string): Promise<GroupSummary[]> {
  const response = await fetch(createUrl(`/invites/accept?token=${encodeURIComponent(inviteToken)}`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createAuthHeaders(sessionToken)
    },
    body: JSON.stringify({ displayName })
  });
  return parseJson<GroupSummary[]>(response);
}

export async function fetchLeaderboard(groupId: string, modeId: string, sessionToken: string): Promise<LeaderboardEntry[]> {
  const response = await fetch(
    createUrl(`/leaderboard?groupId=${encodeURIComponent(groupId)}&modeId=${encodeURIComponent(modeId)}`),
    { headers: createAuthHeaders(sessionToken) }
  );
  return parseJson<LeaderboardEntry[]>(response);
}

export async function fetchActivity(groupId: string, modeId: string | null, sessionToken: string): Promise<ActivityEvent[]> {
  const suffix = modeId ? `?modeId=${encodeURIComponent(modeId)}` : "";
  const response = await fetch(createUrl(`/groups/${encodeURIComponent(groupId)}/activity${suffix}`), {
    headers: createAuthHeaders(sessionToken)
  });
  return parseJson<ActivityEvent[]>(response);
}

export async function fetchPlayerStats(modeId: string, sessionToken: string): Promise<PlayerStats> {
  const response = await fetch(createUrl(`/stats?modeId=${encodeURIComponent(modeId)}`), {
    headers: createAuthHeaders(sessionToken)
  });
  return parseJson<PlayerStats>(response);
}

export async function fetchGroupChat(groupId: string, sessionToken: string): Promise<GroupChatMessage[]> {
  const response = await fetch(createUrl(`/groups/${encodeURIComponent(groupId)}/chat`), {
    headers: createAuthHeaders(sessionToken)
  });
  return parseJson<GroupChatMessage[]>(response);
}

export async function sendGroupChatMessage(groupId: string, message: string, sessionToken: string): Promise<GroupChatMessage> {
  const response = await fetch(createUrl(`/groups/${encodeURIComponent(groupId)}/chat`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createAuthHeaders(sessionToken)
    },
    body: JSON.stringify({ message })
  });
  return parseJson<GroupChatMessage>(response);
}

export async function syncResult(item: PendingResultSync, sessionToken: string): Promise<boolean> {
  const response = await fetch(createUrl("/results"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createAuthHeaders(sessionToken)
    },
    body: JSON.stringify(item)
  });
  const parsed = await parseJson<{ ok: true; updatedBest: boolean }>(response);
  return parsed.updatedBest;
}

export async function syncProgress(item: PendingProgressSync, sessionToken: string): Promise<void> {
  const response = await fetch(createUrl("/progress"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createAuthHeaders(sessionToken)
    },
    body: JSON.stringify(item)
  });
  await parseJson<{ ok: true }>(response);
}
