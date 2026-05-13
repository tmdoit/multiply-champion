type FactStats = {
  attempts: number;
  correct: number;
  wrong: number;
  averageMs: number;
  lastAnsweredAt: string | null;
};

type ProgressPayload = {
  id: string;
  accountId: string;
  modeId: string;
  delta: Record<string, FactStats>;
  updatedAt: string;
};

type ResultPayload = {
  id: string;
  accountId: string;
  modeId: string;
  childName: string;
  correctAnswers: number;
  totalTasks: number;
  totalTimeMs: number;
  createdAt: string;
};

type AuthPayload = {
  childName: string;
  pin: string;
};

type GroupPayload = {
  name: string;
};

type InvitePayload = {
  invitedName: string;
  expiresInHours: number;
};

type AcceptInvitePayload = {
  displayName: string;
};

type ChatMessagePayload = {
  message: string;
};

type StatsFactSummary = {
  factKey: string;
  attempts: number;
  correct: number;
  wrong: number;
  averageMs: number;
};

type Env = {
  DB: D1Database;
};

type AuthenticatedAccount = {
  accountId: string;
  childName: string;
  sessionToken: string;
};

type GroupSummary = {
  id: string;
  name: string;
  role: string;
  ownerAccountId: string | null;
  ownerChildName: string | null;
  displayName: string;
  invitedName: string | null;
  isSystem: boolean;
};

type GroupMemberSummary = {
  accountId: string;
  childName: string;
  role: string;
  displayName: string;
  invitedName: string | null;
  joinedAt: string;
};

type ModeSummary = {
  id: string;
  code: string;
  label: string;
  resultLimit: number;
  factorLimit: number | null;
  isDefault: boolean;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    try {
      await ensureSystemData(env.DB);

      if (url.pathname === "/modes" && request.method === "GET") {
        return json(await listModes(env.DB), headers);
      }

      if (url.pathname === "/auth/register" && request.method === "POST") {
        const body = (await request.json()) as AuthPayload;
        const childName = body.childName.trim();
        validateCredentials(childName, body.pin);

        const existing = await env.DB.prepare(`SELECT id FROM accounts WHERE lower(child_name) = lower(?1)`)
          .bind(childName)
          .first();
        if (existing) {
          return json({ error: "Name already taken" }, headers, 409);
        }

        const accountId = crypto.randomUUID();
        const now = new Date().toISOString();
        const pinHash = await hashPin(body.pin);
        const sessionToken = crypto.randomUUID();

        await env.DB.prepare(
          `INSERT INTO accounts (id, child_name, pin_hash, created_at) VALUES (?1, ?2, ?3, ?4)`
        )
          .bind(accountId, childName, pinHash, now)
          .run();

        await env.DB.prepare(
          `INSERT INTO auth_sessions (token, account_id, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4)`
        )
          .bind(sessionToken, accountId, now, now)
          .run();

        await addMembership(env.DB, "world", accountId, "member", childName, childName, now);
        await writeActivity(env.DB, {
          groupId: "world",
          accountId,
          modeId: null,
          eventType: "group_member_joined",
          payload: { childName, displayName: childName },
          createdAt: now
        });

        return json(
          {
            account: {
              accountId,
              childName,
              sessionToken,
              confirmedAt: now
            },
            groups: await listGroupsForAccount(env.DB, accountId),
            modes: await listModes(env.DB),
            currentModeId: await getDefaultModeId(env.DB),
            progress: {}
          },
          headers,
          201
        );
      }

      if (url.pathname === "/auth/login" && request.method === "POST") {
        const body = (await request.json()) as AuthPayload;
        const childName = body.childName.trim();
        validateCredentials(childName, body.pin);
        const pinHash = await hashPin(body.pin);

        const account = await env.DB.prepare(
          `SELECT id, child_name FROM accounts WHERE lower(child_name) = lower(?1) AND pin_hash = ?2`
        )
          .bind(childName, pinHash)
          .first<Record<string, unknown>>();
        if (!account) {
          return json({ error: "Invalid credentials" }, headers, 401);
        }

        const sessionToken = crypto.randomUUID();
        const now = new Date().toISOString();
        const accountId = String(account.id);
        await env.DB.prepare(
          `INSERT INTO auth_sessions (token, account_id, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4)`
        )
          .bind(sessionToken, accountId, now, now)
          .run();

        const defaultModeId = await getDefaultModeId(env.DB);
        return json(
          {
            account: {
              accountId,
              childName: String(account.child_name),
              sessionToken,
              confirmedAt: now
            },
            groups: await listGroupsForAccount(env.DB, accountId),
            modes: await listModes(env.DB),
            currentModeId: defaultModeId,
            progress: await readProgress(env.DB, accountId, defaultModeId)
          },
          headers
        );
      }

      if (url.pathname === "/me" && request.method === "GET") {
        const account = await requireAuth(request, env.DB);
        const modeId = url.searchParams.get("modeId") ?? (await getDefaultModeId(env.DB));
        return json(
          {
            account: {
              accountId: account.accountId,
              childName: account.childName
            },
            groups: await listGroupsForAccount(env.DB, account.accountId),
            modes: await listModes(env.DB),
            currentModeId: modeId,
            progress: await readProgress(env.DB, account.accountId, modeId)
          },
          headers
        );
      }

      if (url.pathname === "/groups" && request.method === "GET") {
        const account = await requireAuth(request, env.DB);
        return json(await listGroupsForAccount(env.DB, account.accountId), headers);
      }

      if (url.pathname === "/groups" && request.method === "POST") {
        const account = await requireAuth(request, env.DB);
        const body = (await request.json()) as GroupPayload;
        const name = body.name.trim();
        if (name.length < 2 || name.length > 40) {
          return json({ error: "Invalid group name" }, headers, 400);
        }
        const now = new Date().toISOString();
        const groupId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO groups_table (id, name, owner_account_id, is_system, created_at) VALUES (?1, ?2, ?3, 0, ?4)`
        )
          .bind(groupId, name, account.accountId, now)
          .run();
        await addMembership(env.DB, groupId, account.accountId, "owner", account.childName, account.childName, now);
        await writeActivity(env.DB, {
          groupId,
          accountId: account.accountId,
          modeId: null,
          eventType: "group_member_joined",
          payload: { childName: account.childName, displayName: account.childName },
          createdAt: now
        });
        return json(await listGroupsForAccount(env.DB, account.accountId), headers, 201);
      }

      const groupMatch = url.pathname.match(/^\/groups\/([^/]+)$/);
      if (groupMatch && request.method === "DELETE") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(groupMatch[1]);
        const membership = await requireMembership(env.DB, groupId, account.accountId);
        const topBefore = await getTopResultsForGroup(env.DB, groupId);
        if (membership.role === "owner" && groupId !== "world") {
          const countRow = await env.DB.prepare(`SELECT COUNT(*) AS member_count FROM group_memberships WHERE group_id = ?1`)
            .bind(groupId)
            .first<Record<string, unknown>>();
          const memberCount = Number(countRow?.member_count ?? 0);
          if (memberCount > 1) {
            return json({ error: "Owner must stay until alone" }, headers, 400);
          }
          await env.DB.prepare(`DELETE FROM group_memberships WHERE group_id = ?1`)
            .bind(groupId)
            .run();
          await env.DB.prepare(`DELETE FROM group_invites WHERE group_id = ?1`)
            .bind(groupId)
            .run();
          await env.DB.prepare(`DELETE FROM activity_events WHERE group_id = ?1`)
            .bind(groupId)
            .run();
          await env.DB.prepare(`DELETE FROM group_messages WHERE group_id = ?1`)
            .bind(groupId)
            .run();
          await env.DB.prepare(`DELETE FROM groups_table WHERE id = ?1`)
            .bind(groupId)
            .run();
          return json({ ok: true }, headers);
        }
        await env.DB.prepare(`DELETE FROM group_memberships WHERE group_id = ?1 AND account_id = ?2`)
          .bind(groupId, account.accountId)
          .run();
        const changedAt = new Date().toISOString();
        await writeActivity(env.DB, {
          groupId,
          accountId: account.accountId,
          modeId: null,
          eventType: "group_member_left",
          payload: { childName: account.childName, displayName: membership.displayName },
          createdAt: changedAt
        });
        await writeTopResultChangesForMembershipUpdate(env.DB, groupId, topBefore, changedAt);
        return json({ ok: true }, headers);
      }

      const feedMatch = url.pathname.match(/^\/groups\/([^/]+)\/activity$/);
      if (feedMatch && request.method === "GET") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(feedMatch[1]);
        await requireMembership(env.DB, groupId, account.accountId);
        const modeId = url.searchParams.get("modeId");
        return json(await listActivity(env.DB, groupId, modeId), headers);
      }

      const chatMatch = url.pathname.match(/^\/groups\/([^/]+)\/chat$/);
      if (chatMatch && request.method === "GET") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(chatMatch[1]);
        await requireMembership(env.DB, groupId, account.accountId);
        return json(await listGroupChat(env.DB, groupId), headers);
      }
      if (chatMatch && request.method === "POST") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(chatMatch[1]);
        const membership = await requireMembership(env.DB, groupId, account.accountId);
        const body = (await request.json()) as ChatMessagePayload;
        const message = body.message.trim();
        if (message.length < 1 || message.length > 280) {
          return json({ error: "Invalid message" }, headers, 400);
        }
        const createdAt = new Date().toISOString();
        const id = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO group_messages (id, group_id, account_id, child_name, display_name, message, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        )
          .bind(id, groupId, account.accountId, account.childName, membership.displayName, message, createdAt)
          .run();
        return json({ id, groupId, accountId: account.accountId, childName: account.childName, displayName: membership.displayName, message, createdAt }, headers, 201);
      }

      const membersMatch = url.pathname.match(/^\/groups\/([^/]+)\/members$/);
      if (membersMatch && request.method === "GET") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(membersMatch[1]);
        await requireMembership(env.DB, groupId, account.accountId);
        return json(await listMembers(env.DB, groupId), headers);
      }

      const inviteMatch = url.pathname.match(/^\/groups\/([^/]+)\/invites$/);
      if (inviteMatch && request.method === "GET") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(inviteMatch[1]);
        const membership = await requireMembership(env.DB, groupId, account.accountId);
        if (!["owner", "admin"].includes(membership.role)) {
          return json({ error: "Forbidden" }, headers, 403);
        }
        return json(await listInvites(env.DB, groupId), headers);
      }
      if (inviteMatch && request.method === "POST") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(inviteMatch[1]);
        const membership = await requireMembership(env.DB, groupId, account.accountId);
        if (!["owner", "admin"].includes(membership.role)) {
          return json({ error: "Forbidden" }, headers, 403);
        }
        const body = (await request.json()) as InvitePayload;
        const invitedName = body.invitedName.trim();
        const expiresInHours = Math.max(1, Math.min(168, Math.floor(body.expiresInHours)));
        if (invitedName.length < 2 || invitedName.length > 40) {
          return json({ error: "Invalid invited name" }, headers, 400);
        }
        const now = new Date();
        const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString();
        const inviteId = crypto.randomUUID();
        const inviteToken = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO group_invites (id, group_id, invited_by_account_id, invited_name, invite_token, expires_at, status, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)`
        )
          .bind(inviteId, groupId, account.accountId, invitedName, inviteToken, expiresAt, now.toISOString())
          .run();
        await writeActivity(env.DB, {
          groupId,
          accountId: account.accountId,
          modeId: null,
          eventType: "group_invite_created",
          payload: { invitedName, expiresAt },
          createdAt: now.toISOString()
        });
        return json({ inviteId, inviteToken, expiresAt }, headers, 201);
      }

      const revokeInviteMatch = url.pathname.match(/^\/groups\/([^/]+)\/invites\/([^/]+)$/);
      if (revokeInviteMatch && request.method === "DELETE") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(revokeInviteMatch[1]);
        const inviteId = decodeURIComponent(revokeInviteMatch[2]);
        const membership = await requireMembership(env.DB, groupId, account.accountId);
        if (!["owner", "admin"].includes(membership.role)) {
          return json({ error: "Forbidden" }, headers, 403);
        }
        await env.DB.prepare(
          `UPDATE group_invites SET status = 'revoked' WHERE id = ?1 AND group_id = ?2 AND status = 'pending'`
        )
          .bind(inviteId, groupId)
          .run();
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/invites/preview" && request.method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) {
          return json({ error: "Missing token" }, headers, 400);
        }
        const invite = await env.DB.prepare(
          `SELECT gi.group_id, gi.invited_name, gi.expires_at, gi.status, g.name AS group_name
           FROM group_invites gi
           JOIN groups_table g ON g.id = gi.group_id
           WHERE gi.invite_token = ?1`
        )
          .bind(token)
          .first<Record<string, unknown>>();
        if (!invite) {
          return json({ error: "Invite not found" }, headers, 404);
        }
        return json(
          {
            groupId: String(invite.group_id),
            groupName: String(invite.group_name),
            invitedName: String(invite.invited_name),
            expiresAt: String(invite.expires_at),
            status: String(invite.status)
          },
          headers
        );
      }

      if (url.pathname === "/invites/accept" && request.method === "POST") {
        const account = await requireAuth(request, env.DB);
        const token = url.searchParams.get("token");
        if (!token) {
          return json({ error: "Missing token" }, headers, 400);
        }
        const body = (await request.json()) as AcceptInvitePayload;
        const displayName = body.displayName.trim();
        if (displayName.length < 2 || displayName.length > 40) {
          return json({ error: "Invalid display name" }, headers, 400);
        }
        const invite = await env.DB.prepare(
          `SELECT * FROM group_invites WHERE invite_token = ?1 AND status = 'pending'`
        )
          .bind(token)
          .first<Record<string, unknown>>();
        if (!invite) {
          return json({ error: "Invite not found" }, headers, 404);
        }
        const now = new Date().toISOString();
        const topBefore = await getTopResultsForGroup(env.DB, String(invite.group_id));
        if (String(invite.expires_at) < now) {
          await env.DB.prepare(`UPDATE group_invites SET status = 'expired' WHERE id = ?1`)
            .bind(String(invite.id))
            .run();
          return json({ error: "Invite expired" }, headers, 410);
        }
        await addMembership(
          env.DB,
          String(invite.group_id),
          account.accountId,
          "member",
          displayName,
          String(invite.invited_name),
          now
        );
        await env.DB.prepare(
          `UPDATE group_invites SET status = 'accepted', accepted_by_account_id = ?2 WHERE id = ?1`
        )
          .bind(String(invite.id), account.accountId)
          .run();
        await writeActivity(env.DB, {
          groupId: String(invite.group_id),
          accountId: account.accountId,
          modeId: null,
          eventType: "group_invite_accepted",
          payload: { displayName, invitedName: String(invite.invited_name) },
          createdAt: now
        });
        await writeTopResultChangesForMembershipUpdate(env.DB, String(invite.group_id), topBefore, now);
        return json(await listGroupsForAccount(env.DB, account.accountId), headers);
      }

      const adminMatch = url.pathname.match(/^\/groups\/([^/]+)\/members\/([^/]+)\/admin$/);
      if (adminMatch) {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(adminMatch[1]);
        const targetAccountId = decodeURIComponent(adminMatch[2]);
        const actor = await requireMembership(env.DB, groupId, account.accountId);
        if (actor.role !== "owner") {
          return json({ error: "Forbidden" }, headers, 403);
        }
        if (request.method === "POST") {
          await env.DB.prepare(`UPDATE group_memberships SET role = 'admin' WHERE group_id = ?1 AND account_id = ?2`)
            .bind(groupId, targetAccountId)
            .run();
          await writeActivity(env.DB, {
            groupId,
            accountId: targetAccountId,
            modeId: null,
            eventType: "group_admin_granted",
            payload: { targetAccountId },
            createdAt: new Date().toISOString()
          });
          return json({ ok: true }, headers);
        }
        if (request.method === "DELETE") {
          await env.DB.prepare(`UPDATE group_memberships SET role = 'member' WHERE group_id = ?1 AND account_id = ?2`)
            .bind(groupId, targetAccountId)
            .run();
          await writeActivity(env.DB, {
            groupId,
            accountId: targetAccountId,
            modeId: null,
            eventType: "group_admin_revoked",
            payload: { targetAccountId },
            createdAt: new Date().toISOString()
          });
          return json({ ok: true }, headers);
        }
      }

      const memberMatch = url.pathname.match(/^\/groups\/([^/]+)\/members\/([^/]+)$/);
      if (memberMatch && request.method === "DELETE") {
        const account = await requireAuth(request, env.DB);
        const groupId = decodeURIComponent(memberMatch[1]);
        const targetAccountId = decodeURIComponent(memberMatch[2]);
        const actor = await requireMembership(env.DB, groupId, account.accountId);
        const target = await requireMembership(env.DB, groupId, targetAccountId);
        if (target.role === "owner") {
          return json({ error: "Cannot remove owner" }, headers, 403);
        }
        const canRemove =
          actor.accountId === targetAccountId ||
          actor.role === "owner" ||
          (actor.role === "admin" && target.role === "member");
        if (!canRemove) {
          return json({ error: "Forbidden" }, headers, 403);
        }
        const topBefore = await getTopResultsForGroup(env.DB, groupId);
        await env.DB.prepare(`DELETE FROM group_memberships WHERE group_id = ?1 AND account_id = ?2`)
          .bind(groupId, targetAccountId)
          .run();
        const changedAt = new Date().toISOString();
        await writeActivity(env.DB, {
          groupId,
          accountId: targetAccountId,
          modeId: null,
          eventType: "group_member_removed",
          payload: { targetAccountId },
          createdAt: changedAt
        });
        await writeTopResultChangesForMembershipUpdate(env.DB, groupId, topBefore, changedAt);
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/leaderboard" && request.method === "GET") {
        const account = await requireAuth(request, env.DB);
        const groupId = url.searchParams.get("groupId") ?? "world";
        const modeId = url.searchParams.get("modeId") ?? (await getDefaultModeId(env.DB));
        await requireMembership(env.DB, groupId, account.accountId);
        return json(await getLeaderboard(env.DB, groupId, modeId), headers);
      }

      if (url.pathname === "/stats" && request.method === "GET") {
        const account = await requireAuth(request, env.DB);
        const modeId = url.searchParams.get("modeId") ?? (await getDefaultModeId(env.DB));
        return json(await getPlayerStats(env.DB, account.accountId, modeId), headers);
      }

      if (url.pathname === "/results" && request.method === "POST") {
        const account = await requireAuth(request, env.DB);
        const body = (await request.json()) as ResultPayload;
        if (body.accountId !== account.accountId) {
          return json({ error: "Invalid account" }, headers, 403);
        }
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO game_sessions (id, account_id, mode_id, correct_answers, total_tasks, total_time_ms, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        )
          .bind(crypto.randomUUID(), account.accountId, body.modeId, body.correctAnswers, body.totalTasks, body.totalTimeMs, now)
          .run();
        const previous = await env.DB.prepare(
          `SELECT correct_answers, total_time_ms FROM best_results WHERE account_id = ?1 AND mode_id = ?2`
        )
          .bind(account.accountId, body.modeId)
          .first<Record<string, unknown>>();
        const shouldReplace =
          !previous ||
          body.correctAnswers > Number(previous.correct_answers) ||
          (body.correctAnswers === Number(previous.correct_answers) &&
            body.totalTimeMs < Number(previous.total_time_ms));

        const groups = await listGroupsForAccount(env.DB, account.accountId);
        for (const group of groups) {
          await writeActivity(env.DB, {
            groupId: group.id,
            accountId: account.accountId,
            modeId: body.modeId,
            eventType: "game_completed",
            payload: {
              childName: account.childName,
              correctAnswers: body.correctAnswers,
              totalTasks: body.totalTasks,
              totalTimeMs: body.totalTimeMs,
              updatedBest: shouldReplace
            },
            createdAt: now
          });
        }

        if (shouldReplace) {
          await env.DB.prepare(
            `INSERT INTO best_results (account_id, mode_id, child_name, correct_answers, total_tasks, total_time_ms, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(account_id, mode_id) DO UPDATE SET
               child_name = excluded.child_name,
               correct_answers = excluded.correct_answers,
               total_tasks = excluded.total_tasks,
               total_time_ms = excluded.total_time_ms,
               updated_at = excluded.updated_at`
          )
            .bind(account.accountId, body.modeId, account.childName, body.correctAnswers, body.totalTasks, body.totalTimeMs, now)
            .run();

          for (const group of groups) {
            const rankAfter = await getRankForAccount(env.DB, group.id, body.modeId, account.accountId);
            await writeActivity(env.DB, {
              groupId: group.id,
              accountId: account.accountId,
              modeId: body.modeId,
              eventType: "best_result_updated",
              payload: {
                childName: account.childName,
                correctAnswers: body.correctAnswers,
                totalTimeMs: body.totalTimeMs,
                rankAfter,
                previousCorrectAnswers: previous ? Number(previous.correct_answers) : null,
                previousTotalTimeMs: previous ? Number(previous.total_time_ms) : null
              },
              createdAt: now
            });
          }
        }

        return json({ ok: true, updatedBest: shouldReplace }, headers, 201);
      }

      if (url.pathname === "/progress" && request.method === "POST") {
        const account = await requireAuth(request, env.DB);
        const body = (await request.json()) as ProgressPayload;
        if (body.accountId !== account.accountId) {
          return json({ error: "Invalid account" }, headers, 403);
        }
        const entries = Object.entries(body.delta);
        for (const [factKey, stats] of entries) {
          const existing = await env.DB.prepare(
            `SELECT attempts, correct, wrong, average_ms, last_answered_at
             FROM progress_facts WHERE account_id = ?1 AND mode_id = ?2 AND fact_key = ?3`
          )
            .bind(account.accountId, body.modeId, factKey)
            .first<Record<string, unknown>>();
          const attempts = Number(existing?.attempts ?? 0) + stats.attempts;
          const correct = Number(existing?.correct ?? 0) + stats.correct;
          const wrong = Number(existing?.wrong ?? 0) + stats.wrong;
          const averageMs =
            attempts === 0
              ? 0
              : Math.round(
                  ((Number(existing?.average_ms ?? 0) * Number(existing?.attempts ?? 0)) + stats.averageMs * stats.attempts) /
                    attempts
                );
          const lastAnsweredAt =
            [existing?.last_answered_at, stats.lastAnsweredAt].filter(Boolean).sort().slice(-1)[0] ?? null;
          await env.DB.prepare(
            `INSERT INTO progress_facts (account_id, mode_id, fact_key, attempts, correct, wrong, average_ms, last_answered_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(account_id, mode_id, fact_key) DO UPDATE SET
               attempts = excluded.attempts,
               correct = excluded.correct,
               wrong = excluded.wrong,
               average_ms = excluded.average_ms,
               last_answered_at = excluded.last_answered_at`
          )
            .bind(account.accountId, body.modeId, factKey, attempts, correct, wrong, averageMs, lastAnsweredAt)
            .run();
        }
        return json({ ok: true }, headers, 201);
      }

      return json({ error: "Not found" }, headers, 404);
    } catch (error) {
      if (error instanceof Response) {
        return withCors(error, headers);
      }
      return json({ error: error instanceof Error ? error.message : "Unknown error" }, headers, 500);
    }
  }
};

async function ensureSystemData(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO groups_table (id, name, owner_account_id, is_system, created_at)
     VALUES ('world', 'Świat', NULL, 1, ?1)`
  )
    .bind(now)
    .run();
  await db.prepare(`UPDATE groups_table SET name = 'Świat', is_system = 1 WHERE id = 'world'`).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS game_sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      mode_id TEXT NOT NULL,
      correct_answers INTEGER NOT NULL,
      total_tasks INTEGER NOT NULL,
      total_time_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      child_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  ).run();
  await db.prepare(
    `INSERT OR IGNORE INTO modes (id, code, label, result_limit, factor_limit, sort_order, is_default)
     VALUES ('to100-table10', 'to100-table10', 'Do 100, Tabliczka 10', 100, 10, 1, 1)`
  ).run();
  await db.prepare(
    `INSERT OR IGNORE INTO modes (id, code, label, result_limit, factor_limit, sort_order, is_default)
     VALUES ('to100-free', 'to100-free', 'Do 100, Bez ograniczeń', 100, NULL, 2, 0)`
  ).run();
}

async function requireAuth(request: Request, db: D1Database): Promise<AuthenticatedAccount> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    throw new Response(JSON.stringify({ error: "Missing auth token" }), { status: 401 });
  }
  const row = await db.prepare(
    `SELECT auth_sessions.token, accounts.id AS account_id, accounts.child_name
     FROM auth_sessions JOIN accounts ON accounts.id = auth_sessions.account_id
     WHERE auth_sessions.token = ?1`
  )
    .bind(token)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 });
  }
  await db.prepare(`UPDATE auth_sessions SET last_used_at = ?2 WHERE token = ?1`)
    .bind(token, new Date().toISOString())
    .run();
  return { accountId: String(row.account_id), childName: String(row.child_name), sessionToken: token };
}

async function listModes(db: D1Database): Promise<ModeSummary[]> {
  const rows = await db.prepare(
    `SELECT id, code, label, result_limit, factor_limit, is_default FROM modes ORDER BY sort_order ASC`
  ).all();
  return (rows.results ?? []).map((row) => ({
    id: String(row.id),
    code: String(row.code),
    label: String(row.label),
    resultLimit: Number(row.result_limit),
    factorLimit: row.factor_limit == null ? null : Number(row.factor_limit),
    isDefault: Number(row.is_default) === 1
  }));
}

async function getDefaultModeId(db: D1Database): Promise<string> {
  const row = await db.prepare(`SELECT id FROM modes WHERE is_default = 1 ORDER BY sort_order ASC LIMIT 1`).first<Record<string, unknown>>();
  return row ? String(row.id) : "to100-table10";
}

async function addMembership(
  db: D1Database,
  groupId: string,
  accountId: string,
  role: string,
  displayName: string,
  invitedName: string,
  joinedAt: string
): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO group_memberships (group_id, account_id, role, display_name, invited_name, joined_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  )
    .bind(groupId, accountId, role, displayName, invitedName, joinedAt)
    .run();
}

async function requireMembership(
  db: D1Database,
  groupId: string,
  accountId: string
): Promise<{ accountId: string; role: string; displayName: string }> {
  const row = await db.prepare(
    `SELECT account_id, role, display_name FROM group_memberships WHERE group_id = ?1 AND account_id = ?2`
  )
    .bind(groupId, accountId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
  return {
    accountId: String(row.account_id),
    role: String(row.role),
    displayName: String(row.display_name)
  };
}

async function listGroupsForAccount(db: D1Database, accountId: string): Promise<GroupSummary[]> {
  const rows = await db.prepare(
    `SELECT g.id, g.name, g.owner_account_id, owner.child_name AS owner_child_name, g.is_system,
            gm.role, gm.display_name, gm.invited_name
     FROM group_memberships gm
     JOIN groups_table g ON g.id = gm.group_id
     LEFT JOIN accounts owner ON owner.id = g.owner_account_id
     WHERE gm.account_id = ?1
     ORDER BY g.is_system DESC, g.created_at ASC`
  )
    .bind(accountId)
    .all();

  const base = (rows.results ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    ownerAccountId: row.owner_account_id ? String(row.owner_account_id) : null,
    ownerChildName: row.owner_child_name ? String(row.owner_child_name) : null,
    displayName: String(row.display_name),
    invitedName: row.invited_name ? String(row.invited_name) : null,
    isSystem: Number(row.is_system) === 1
  }));

  const counts = new Map<string, number>();
  for (const group of base) {
    counts.set(group.name, (counts.get(group.name) ?? 0) + 1);
  }
  const ownerCounts = new Map<string, number>();
  for (const group of base) {
    const key = `${group.ownerChildName ?? ""}|${group.name}`;
    ownerCounts.set(key, (ownerCounts.get(key) ?? 0) + 1);
  }

  const animals = ["Lis", "Sowa", "Wilk", "Ryś", "Bóbr", "Jeż", "Żubr", "Żaba", "Miś", "Wydra"];
  return base.map((group) => {
    let name = group.name;
    if ((counts.get(group.name) ?? 0) > 1 && group.ownerChildName) {
      name = `${group.ownerChildName} - ${group.name}`;
    }
    const key = `${group.ownerChildName ?? ""}|${group.name}`;
    if ((ownerCounts.get(key) ?? 0) > 1) {
      const index = Math.abs(hashString(group.id)) % animals.length;
      name = `${name} - ${animals[index]}`;
    }
    return { ...group, name };
  });
}


async function getPlayerStats(db: D1Database, accountId: string, modeId: string) {
  const bestRow = await db.prepare(
    `SELECT total_time_ms FROM best_results WHERE account_id = ?1 AND mode_id = ?2`
  )
    .bind(accountId, modeId)
    .first<Record<string, unknown>>();

  const sessionRow = await db.prepare(
    `SELECT COUNT(*) AS games_played, COALESCE(SUM(total_tasks), 0) AS total_facts_answered
     FROM game_sessions
     WHERE account_id = ?1 AND mode_id = ?2`
  )
    .bind(accountId, modeId)
    .first<Record<string, unknown>>();

  const rows = await db.prepare(
    `SELECT fact_key, attempts, correct, wrong, average_ms
     FROM progress_facts
     WHERE account_id = ?1 AND mode_id = ?2`
  )
    .bind(accountId, modeId)
    .all();

  const facts: StatsFactSummary[] = (rows.results ?? []).map((row) => ({
    factKey: String(row.fact_key),
    attempts: Number(row.attempts),
    correct: Number(row.correct),
    wrong: Number(row.wrong),
    averageMs: Number(row.average_ms)
  }));

  const strongestFacts = facts
    .filter((fact) => fact.attempts >= 3)
    .sort((a, b) => {
      if (a.wrong !== b.wrong) return a.wrong - b.wrong;
      if (a.averageMs !== b.averageMs) return a.averageMs - b.averageMs;
      return b.attempts - a.attempts;
    })
    .slice(0, 5);

  const needsPracticeFacts = facts
    .filter((fact) => fact.attempts >= 2)
    .sort((a, b) => {
      if (a.wrong !== b.wrong) return b.wrong - a.wrong;
      if (a.averageMs !== b.averageMs) return b.averageMs - a.averageMs;
      return b.attempts - a.attempts;
    })
    .slice(0, 5);

  return {
    bestTimeMs: bestRow ? Number(bestRow.total_time_ms) : null,
    gamesPlayed: Number(sessionRow?.games_played ?? 0),
    totalFactsAnswered: Number(sessionRow?.total_facts_answered ?? 0),
    strongestFacts,
    needsPracticeFacts
  };
}

async function getLeaderboard(db: D1Database, groupId: string, modeId: string) {
  const rows = await db.prepare(
    `SELECT br.account_id AS accountId, gm.display_name AS childName, br.correct_answers AS correctAnswers,
            br.total_tasks AS totalTasks, br.total_time_ms AS totalTimeMs, br.updated_at AS createdAt
     FROM group_memberships gm
     JOIN best_results br ON br.account_id = gm.account_id AND br.mode_id = ?2
     WHERE gm.group_id = ?1
     ORDER BY br.correct_answers DESC, br.total_time_ms ASC, br.updated_at ASC`
  )
    .bind(groupId, modeId)
    .all();
  return (rows.results ?? []).map((row) => ({
    id: `${String(row.accountId)}:${modeId}`,
    accountId: String(row.accountId),
    childName: String(row.childName),
    correctAnswers: Number(row.correctAnswers),
    totalTasks: Number(row.totalTasks),
    totalTimeMs: Number(row.totalTimeMs),
    createdAt: String(row.createdAt)
  }));
}

async function readProgress(db: D1Database, accountId: string, modeId: string): Promise<Record<string, FactStats>> {
  const rows = await db.prepare(
    `SELECT fact_key, attempts, correct, wrong, average_ms, last_answered_at
     FROM progress_facts WHERE account_id = ?1 AND mode_id = ?2`
  )
    .bind(accountId, modeId)
    .all();
  const progress: Record<string, FactStats> = {};
  for (const row of rows.results ?? []) {
    progress[String(row.fact_key)] = {
      attempts: Number(row.attempts),
      correct: Number(row.correct),
      wrong: Number(row.wrong),
      averageMs: Number(row.average_ms),
      lastAnsweredAt: row.last_answered_at ? String(row.last_answered_at) : null
    };
  }
  return progress;
}

async function listActivity(db: D1Database, groupId: string, modeId: string | null) {
  const rows = modeId
    ? await db.prepare(
        `SELECT id, group_id, account_id, mode_id, event_type, payload_json, created_at
         FROM activity_events
         WHERE group_id = ?1 AND (mode_id IS NULL OR mode_id = ?2)
         ORDER BY created_at DESC
         LIMIT 50`
      )
        .bind(groupId, modeId)
        .all()
    : await db.prepare(
        `SELECT id, group_id, account_id, mode_id, event_type, payload_json, created_at
         FROM activity_events
         WHERE group_id = ?1
         ORDER BY created_at DESC
         LIMIT 50`
      )
        .bind(groupId)
        .all();
  return (rows.results ?? []).map((row) => ({
    id: String(row.id),
    groupId: String(row.group_id),
    accountId: row.account_id ? String(row.account_id) : null,
    modeId: row.mode_id ? String(row.mode_id) : null,
    eventType: String(row.event_type),
    payload: safeParseJson(String(row.payload_json)),
    createdAt: String(row.created_at)
  }));
}

async function listGroupChat(db: D1Database, groupId: string) {
  const rows = await db.prepare(
    `SELECT id, group_id, account_id, child_name, display_name, message, created_at
     FROM group_messages
     WHERE group_id = ?1
     ORDER BY created_at DESC
     LIMIT 100`
  )
    .bind(groupId)
    .all();
  return (rows.results ?? []).map((row) => ({
    id: String(row.id),
    groupId: String(row.group_id),
    accountId: String(row.account_id),
    childName: String(row.child_name),
    displayName: String(row.display_name),
    message: String(row.message),
    createdAt: String(row.created_at)
  })).reverse();
}

async function listMembers(db: D1Database, groupId: string): Promise<GroupMemberSummary[]> {
  const rows = await db.prepare(
    `SELECT gm.account_id, a.child_name, gm.role, gm.display_name, gm.invited_name, gm.joined_at
     FROM group_memberships gm
     JOIN accounts a ON a.id = gm.account_id
     WHERE gm.group_id = ?1
     ORDER BY
       CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
       gm.joined_at ASC`
  )
    .bind(groupId)
    .all();
  return (rows.results ?? []).map((row) => ({
    accountId: String(row.account_id),
    childName: String(row.child_name),
    role: String(row.role),
    displayName: String(row.display_name),
    invitedName: row.invited_name ? String(row.invited_name) : null,
    joinedAt: String(row.joined_at)
  }));
}

async function listInvites(db: D1Database, groupId: string) {
  const rows = await db.prepare(
    `SELECT gi.id, gi.invited_name, gi.expires_at, gi.status, gi.invite_token,
            inviter.child_name AS invited_by_child_name, gi.accepted_by_account_id
     FROM group_invites gi
     LEFT JOIN accounts inviter ON inviter.id = gi.invited_by_account_id
     WHERE gi.group_id = ?1
     ORDER BY gi.created_at DESC`
  )
    .bind(groupId)
    .all();
  return (rows.results ?? []).map((row) => ({
    id: String(row.id),
    invitedName: String(row.invited_name),
    expiresAt: String(row.expires_at),
    status: String(row.status),
    inviteToken: String(row.invite_token),
    invitedByChildName: row.invited_by_child_name ? String(row.invited_by_child_name) : null,
    acceptedByAccountId: row.accepted_by_account_id ? String(row.accepted_by_account_id) : null
  }));
}

async function getRankForAccount(db: D1Database, groupId: string, modeId: string, accountId: string): Promise<number | null> {
  const leaderboard = await getLeaderboard(db, groupId, modeId);
  const index = leaderboard.findIndex((entry) => entry.id === `${accountId}:${modeId}`);
  return index >= 0 ? index + 1 : null;
}

async function getTopResultsForGroup(
  db: D1Database,
  groupId: string
): Promise<Map<string, { accountId: string; childName: string; totalTimeMs: number; correctAnswers: number } | null>> {
  const modes = await listModes(db);
  const topByMode = new Map<string, { accountId: string; childName: string; totalTimeMs: number; correctAnswers: number } | null>();
  for (const mode of modes) {
    const leaderboard = await getLeaderboard(db, groupId, mode.id);
    const top = leaderboard[0];
    topByMode.set(
      mode.id,
      top
        ? {
            accountId: String(top.accountId),
            childName: String(top.childName),
            totalTimeMs: Number(top.totalTimeMs),
            correctAnswers: Number(top.correctAnswers)
          }
        : null
    );
  }
  return topByMode;
}

async function writeTopResultChangesForMembershipUpdate(
  db: D1Database,
  groupId: string,
  topBefore: Map<string, { accountId: string; childName: string; totalTimeMs: number; correctAnswers: number } | null>,
  createdAt: string
): Promise<void> {
  const modes = await listModes(db);
  for (const mode of modes) {
    const before = topBefore.get(mode.id) ?? null;
    const leaderboard = await getLeaderboard(db, groupId, mode.id);
    const after = leaderboard[0]
      ? {
          accountId: String(leaderboard[0].accountId),
          childName: String(leaderboard[0].childName),
          totalTimeMs: Number(leaderboard[0].totalTimeMs),
          correctAnswers: Number(leaderboard[0].correctAnswers)
        }
      : null;

    const changed =
      (!before && !!after) ||
      (!!before &&
        !!after &&
        (before.accountId !== after.accountId ||
          before.totalTimeMs !== after.totalTimeMs ||
          before.correctAnswers !== after.correctAnswers)) ||
      (!!before && !after);

    if (!changed || !after) {
      continue;
    }

    await writeActivity(db, {
      groupId,
      accountId: after.accountId,
      modeId: mode.id,
      eventType: "best_result_updated",
      payload: {
        childName: after.childName,
        correctAnswers: after.correctAnswers,
        totalTimeMs: after.totalTimeMs,
        rankAfter: 1,
        previousCorrectAnswers: before?.correctAnswers ?? null,
        previousTotalTimeMs: before?.totalTimeMs ?? null
      },
      createdAt
    });
  }
}

async function writeActivity(
  db: D1Database,
  input: {
    groupId: string;
    accountId: string | null;
    modeId: string | null;
    eventType: string;
    payload: unknown;
    createdAt: string;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO activity_events (id, group_id, account_id, mode_id, event_type, payload_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(crypto.randomUUID(), input.groupId, input.accountId, input.modeId, input.eventType, JSON.stringify(input.payload), input.createdAt)
    .run();
}

function validateCredentials(childName: string, pin: string): void {
  if (childName.length < 2 || childName.length > 20) {
    throw new Error("Invalid child name length");
  }
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error("PIN must be 4 to 6 digits");
  }
}

function corsHeaders(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function json(body: unknown, headers: HeadersInit, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}

function withCors(response: Response, headers: HeadersInit): Response {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) {
    merged.set(key, String(value));
  }
  return new Response(response.body, { status: response.status, headers: merged });
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return hash;
}

async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
