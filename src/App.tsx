import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptInvite,
  createGroup,
  createInvite,
  fetchActivity,
  fetchGroupInvites,
  fetchGroupMembers,
  fetchGroups,
  fetchInvitePreview,
  fetchLeaderboard,
  fetchMe,
  grantAdmin,
  hasApi,
  leaveGroup,
  loginAccount,
  removeGroupMember,
  registerAccount,
  revokeAdmin,
  revokeInvite,
  syncProgress,
  syncResult
} from "./api";
import { HOST_CONFIG } from "./constants";
import {
  clearConfirmedAccount,
  loadConfirmedAccount,
  loadLocalLeaderboard,
  loadPendingProgress,
  loadPendingResults,
  loadProgress,
  loadSelectedGroupId,
  loadSelectedModeId,
  saveConfirmedAccount,
  saveLocalLeaderboard,
  savePendingProgress,
  savePendingResults,
  saveProgress,
  saveSelectedGroupId,
  saveSelectedModeId
} from "./storage";
import type {
  ActivityEvent,
  CompletedGame,
  ConfirmedAccount,
  FactTask,
  GroupInvite,
  GroupMember,
  GroupSummary,
  InvitePreview,
  LeaderboardEntry,
  ModeSummary,
  PendingProgressSync,
  PendingResultSync,
  ProgressSnapshot,
  Screen
} from "./types";
import { buildFactPool, formatMs, mergeProgressSnapshots, normalizeFactStats, pickWeightedTasks } from "./utils";

type AuthMode = "register" | "login";

type TaskAttemptState = {
  queue: FactTask[];
  currentIndex: number;
  correctAnswers: number;
  startedAt: number;
  taskStartedAt: number;
  input: string;
  message: { type: "correct" | "wrong"; text: string } | null;
  waitingForContinue: boolean;
  remainingMs: number | null;
};

function createGameState(mode: ModeSummary, progress: ProgressSnapshot): TaskAttemptState {
  const queue = pickWeightedTasks(
    buildFactPool(mode.resultLimit, mode.factorLimit),
    HOST_CONFIG.taskCount,
    progress
  );
  return {
    queue,
    currentIndex: 0,
    correctAnswers: 0,
    startedAt: Date.now(),
    taskStartedAt: Date.now(),
    input: "",
    message: null,
    waitingForContinue: false,
    remainingMs: HOST_CONFIG.timer.enabled ? HOST_CONFIG.timer.secondsPerTask * 1000 : null
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [account, setAccount] = useState<ConfirmedAccount | null>(() => loadConfirmedAccount());
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [modes, setModes] = useState<ModeSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => loadSelectedGroupId());
  const [selectedModeId, setSelectedModeId] = useState<string | null>(() => loadSelectedModeId());
  const [progress, setProgress] = useState<ProgressSnapshot>(() =>
    loadProgress(loadConfirmedAccount()?.accountId ?? null, loadSelectedModeId())
  );
  const [localBoard, setLocalBoard] = useState<LeaderboardEntry[]>(() => loadLocalLeaderboard());
  const [remoteBoard, setRemoteBoard] = useState<LeaderboardEntry[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [syncStatus, setSyncStatus] = useState("Gotowe do pracy offline");
  const [game, setGame] = useState<TaskAttemptState | null>(null);
  const [lastResult, setLastResult] = useState<CompletedGame | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authName, setAuthName] = useState("");
  const [authPin, setAuthPin] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupPromptOpen, setGroupPromptOpen] = useState(false);
  const [leaveGroupPromptOpen, setLeaveGroupPromptOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [popupMessage, setPopupMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const selectedMode = useMemo(
    () => modes.find((mode) => mode.id === selectedModeId) ?? modes.find((mode) => mode.isDefault) ?? null,
    [modes, selectedModeId]
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null,
    [groups, selectedGroupId]
  );
  const currentTask = game ? game.queue[game.currentIndex] : null;

  useEffect(() => {
    saveLocalLeaderboard(localBoard);
  }, [localBoard]);

  useEffect(() => {
    if (selectedGroupId) {
      saveSelectedGroupId(selectedGroupId);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (selectedModeId) {
      saveSelectedModeId(selectedModeId);
    }
  }, [selectedModeId]);

  useEffect(() => {
    if (account) {
      saveConfirmedAccount(account);
    } else {
      clearConfirmedAccount();
      setGroups([]);
      setModes([]);
      setSelectedGroupId(null);
      setSelectedModeId(null);
      setProgress({});
    }
  }, [account]);

  useEffect(() => {
    if (account && selectedModeId) {
      saveProgress(account.accountId, selectedModeId, progress);
    }
  }, [account, selectedModeId, progress]);

  useEffect(() => {
    if (account && selectedModeId) {
      setProgress(loadProgress(account.accountId, selectedModeId));
      if (navigator.onLine && hasApi()) {
        void refreshMe(account, selectedModeId);
      }
    }
  }, [account, selectedModeId]);

  useEffect(() => {
    if (account && selectedGroupId && selectedModeId) {
      void refreshBoardAndActivity(account, selectedGroupId, selectedModeId);
      void flushPendingSync(account, selectedModeId, selectedGroupId);
    }
  }, [account, selectedGroupId, selectedModeId]);

  useEffect(() => {
    if (!game || !HOST_CONFIG.timer.enabled || game.waitingForContinue) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = window.setInterval(() => {
      setGame((current) => {
        if (!current || current.waitingForContinue) {
          return current;
        }
        const elapsed = Date.now() - current.taskStartedAt;
        const remainingMs = Math.max(0, HOST_CONFIG.timer.secondsPerTask * 1000 - elapsed);
        if (remainingMs === 0) {
          if (current.queue[current.currentIndex]) {
            updateProgressForTask(current.queue[current.currentIndex], false, elapsed);
          }
          return handleWrongAnswer(current, `Czas minął. Poprawna odpowiedź: ${current.queue[current.currentIndex].answer}`);
        }
        return { ...current, remainingMs };
      });
    }, 250);
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [game]);

  useEffect(() => {
    if (!game?.waitingForContinue) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setGame((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          message: null,
          waitingForContinue: false,
          taskStartedAt: Date.now(),
          input: "",
          remainingMs: HOST_CONFIG.timer.enabled ? HOST_CONFIG.timer.secondsPerTask * 1000 : null
        };
      });
    }, 3000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [game?.waitingForContinue]);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [account, selectedModeId, selectedGroupId]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (token && hasApi()) {
      void fetchInvitePreview(token)
        .then((preview) => {
          setInvitePreview(preview);
          setInviteDisplayName(preview.invitedName);
        })
        .catch(() => {
          setPopupMessage("Nie udało się odczytać zaproszenia.");
        });
    }
  }, []);

  async function handleOnline(): Promise<void> {
    if (account && selectedModeId) {
      await refreshMe(account, selectedModeId);
      if (selectedGroupId) {
        await refreshBoardAndActivity(account, selectedGroupId, selectedModeId);
        await flushPendingSync(account, selectedModeId, selectedGroupId);
      }
    }
  }

  async function refreshMe(activeAccount: ConfirmedAccount, modeId: string): Promise<void> {
    if (!navigator.onLine || !hasApi()) {
      return;
    }
    try {
      const me = await fetchMe(activeAccount.sessionToken, modeId);
      setGroups(me.groups);
      setModes(me.modes);
      const nextModeId = me.modes.some((mode) => mode.id === (selectedModeId ?? me.currentModeId))
        ? (selectedModeId ?? me.currentModeId)
        : me.currentModeId;
      const nextGroupId =
        me.groups.find((group) => group.id === selectedGroupId)?.id ?? me.groups[0]?.id ?? null;
      setSelectedModeId(nextModeId);
      setSelectedGroupId(nextGroupId);
      const pendingDelta = aggregatePendingProgress(loadPendingProgress(), activeAccount.accountId, nextModeId);
      const merged = mergeProgressSnapshots(me.progress, pendingDelta);
      setProgress(merged);
      saveProgress(activeAccount.accountId, nextModeId, merged);
      setSyncStatus("Konto potwierdzone. Synchronizacja działa.");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        forceLogout("Sesja wygasła. Zaloguj się ponownie online.");
      } else {
        setSyncStatus("Korzystanie z danych offline");
      }
    }
  }

  async function refreshBoardAndActivity(
    activeAccount: ConfirmedAccount,
    groupId: string,
    modeId: string
  ): Promise<void> {
    if (!navigator.onLine || !hasApi()) {
      return;
    }
    try {
      const [board, feed] = await Promise.all([
        fetchLeaderboard(groupId, modeId, activeAccount.sessionToken),
        fetchActivity(groupId, modeId, activeAccount.sessionToken)
      ]);
      setRemoteBoard(board);
      setActivity(feed);
      if (screen === "group") {
        const [memberList, inviteList] = await Promise.all([
          fetchGroupMembers(groupId, activeAccount.sessionToken),
          fetchGroupInvites(groupId, activeAccount.sessionToken).catch(() => [])
        ]);
        setMembers(memberList);
        setInvites(inviteList);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        forceLogout("Sesja wygasła. Zaloguj się ponownie online.");
      } else {
        setSyncStatus("Korzystanie z danych offline");
      }
    }
  }

  async function flushPendingSync(
    activeAccount: ConfirmedAccount,
    modeId: string,
    groupId: string
  ): Promise<void> {
    if (!navigator.onLine || !hasApi()) {
      return;
    }
    let pendingResults = loadPendingResults();
    let pendingProgress = loadPendingProgress();
    try {
      for (const item of pendingResults.filter(
        (entry) => entry.accountId === activeAccount.accountId && entry.modeId === modeId && !entry.synced
      )) {
        await syncResult(item, activeAccount.sessionToken);
        item.synced = true;
      }
      pendingResults = pendingResults.filter((item) => !item.synced);
      savePendingResults(pendingResults);

      for (const item of pendingProgress.filter(
        (entry) => entry.accountId === activeAccount.accountId && entry.modeId === modeId && !entry.synced
      )) {
        await syncProgress(item, activeAccount.sessionToken);
        item.synced = true;
      }
      pendingProgress = pendingProgress.filter((entry) => !entry.synced);
      savePendingProgress(pendingProgress);

      await refreshBoardAndActivity(activeAccount, groupId, modeId);
      setSyncStatus("Zsynchronizowano");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        forceLogout("Sesja wygasła. Zaloguj się ponownie online.");
      } else {
        setSyncStatus("Zmiany offline czekają na synchronizację");
      }
    }
  }

  function forceLogout(message: string): void {
    setAccount(null);
    setGame(null);
    setLastResult(null);
    setScreen("home");
    setSyncStatus(message);
    setPopupMessage(message);
  }

  async function submitAuth(): Promise<void> {
    if (!hasApi()) {
      setPopupMessage("Najpierw skonfiguruj połączenie z serwerem.");
      return;
    }
    if (!navigator.onLine) {
      setPopupMessage("Do utworzenia lub potwierdzenia konta potrzebny jest internet.");
      return;
    }
    const childName = authName.trim();
    const pin = authPin.trim();
    if (childName.length < 2 || !/^\d{4,6}$/.test(pin)) {
      setPopupMessage("Podaj imię i PIN z 4 do 6 cyfr.");
      return;
    }
    setAuthBusy(true);
    try {
      const response = authMode === "register" ? await registerAccount(childName, pin) : await loginAccount(childName, pin);
      setAccount(response.account);
      setGroups(response.groups);
      setModes(response.modes);
      const initialModeId = response.currentModeId;
      setSelectedModeId(initialModeId);
      setSelectedGroupId(response.groups[0]?.id ?? "world");
      setProgress(response.progress);
      saveProgress(response.account.accountId, initialModeId, response.progress);
      setAuthPin("");
      setPopupMessage(authMode === "register" ? "Konto zostało utworzone." : "Zalogowano pomyślnie.");
      setSyncStatus("Konto potwierdzone online.");
    } catch (error) {
      if (error instanceof Error && error.message === "NAME_TAKEN") {
        setPopupMessage("Ta nazwa jest już zajęta. Wybierz inną.");
      } else if (error instanceof Error && error.message === "UNAUTHORIZED") {
        setPopupMessage("Nieprawidłowe imię lub PIN.");
      } else {
        setPopupMessage("Nie udało się potwierdzić konta online.");
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleCreateGroup(): Promise<void> {
    if (!account) {
      return;
    }
    const name = newGroupName.trim();
    if (name.length < 2) {
      setPopupMessage("Podaj nazwę grupy.");
      return;
    }
    if (!navigator.onLine || !hasApi()) {
      setPopupMessage("Tworzenie grupy wymaga połączenia z internetem.");
      return;
    }
    try {
      const nextGroups = await createGroup(name, account.sessionToken);
      setGroups(nextGroups);
      const newest = nextGroups[nextGroups.length - 1];
      setSelectedGroupId(newest?.id ?? selectedGroupId);
      setNewGroupName("");
      setGroupPromptOpen(false);
      setPopupMessage("Grupa została utworzona.");
    } catch {
      setPopupMessage("Nie udało się utworzyć grupy.");
    }
  }

  async function handleCreateInvite(): Promise<void> {
    if (!account || !selectedGroup) {
      return;
    }
    if (!navigator.onLine || !hasApi()) {
      setPopupMessage("Tworzenie zaproszeń wymaga internetu.");
      return;
    }
    const invitedName = inviteName.trim();
    if (invitedName.length < 2) {
      setPopupMessage("Podaj imię zapraszanej osoby.");
      return;
    }
    try {
      const expiresInHours = HOST_CONFIG.invites.expirationHours;
      const created = await createInvite(selectedGroup.id, invitedName, expiresInHours, account.sessionToken);
      const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(created.inviteToken)}`;
      setLatestInviteUrl(inviteUrl);
      setInviteName("");
      setPopupMessage("Link zaproszenia został utworzony.");
      const inviteList = await fetchGroupInvites(selectedGroup.id, account.sessionToken);
      setInvites(inviteList);
    } catch {
      setPopupMessage("Nie udało się utworzyć zaproszenia.");
    }
  }

  async function handleCopyInviteUrl(inviteUrl: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setPopupMessage("Link zaproszenia skopiowany.");
    } catch {
      setPopupMessage("Nie udało się skopiować linku.");
    }
  }

  async function handleAcceptInvite(): Promise<void> {
    if (!account || !invitePreview) {
      return;
    }
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) {
      return;
    }
    const displayName = inviteDisplayName.trim();
    if (displayName.length < 2) {
      setPopupMessage("Podaj nazwę, pod którą chcesz być widoczny w grupie.");
      return;
    }
    try {
      const nextGroups = await acceptInvite(token, displayName, account.sessionToken);
      setGroups(nextGroups);
      setSelectedGroupId(invitePreview.groupId);
      setInvitePreview(null);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("invite");
      window.history.replaceState({}, "", nextUrl.toString());
      setPopupMessage("Dołączono do grupy.");
    } catch (error) {
      if (error instanceof Error && error.message === "INVITE_EXPIRED") {
        setPopupMessage("Zaproszenie wygasło.");
      } else {
        setPopupMessage("Nie udało się przyjąć zaproszenia.");
      }
    }
  }

  async function refreshGroupManagement(): Promise<void> {
    if (!account || !selectedGroup) {
      return;
    }
    try {
      const [memberList, inviteList] = await Promise.all([
        fetchGroupMembers(selectedGroup.id, account.sessionToken),
        fetchGroupInvites(selectedGroup.id, account.sessionToken).catch(() => [])
      ]);
      setMembers(memberList);
      setInvites(inviteList);
    } catch {
      setPopupMessage("Nie udało się odświeżyć danych grupy.");
    }
  }

  async function handleGrantAdmin(targetAccountId: string): Promise<void> {
    if (!account || !selectedGroup) {
      return;
    }
    try {
      await grantAdmin(selectedGroup.id, targetAccountId, account.sessionToken);
      await refreshGroupManagement();
    } catch {
      setPopupMessage("Nie udało się nadać uprawnień administratora.");
    }
  }

  async function handleRevokeAdmin(targetAccountId: string): Promise<void> {
    if (!account || !selectedGroup) {
      return;
    }
    try {
      await revokeAdmin(selectedGroup.id, targetAccountId, account.sessionToken);
      await refreshGroupManagement();
    } catch {
      setPopupMessage("Nie udało się odebrać uprawnień administratora.");
    }
  }

  async function handleRemoveMember(targetAccountId: string): Promise<void> {
    if (!account || !selectedGroup) {
      return;
    }
    try {
      await removeGroupMember(selectedGroup.id, targetAccountId, account.sessionToken);
      await refreshGroupManagement();
    } catch {
      setPopupMessage("Nie udało się usunąć członka grupy.");
    }
  }

  async function handleRevokeInvite(inviteId: string): Promise<void> {
    if (!account || !selectedGroup) {
      return;
    }
    try {
      await revokeInvite(selectedGroup.id, inviteId, account.sessionToken);
      await refreshGroupManagement();
    } catch {
      setPopupMessage("Nie udało się usunąć zaproszenia.");
    }
  }

  async function handleLeaveGroup(): Promise<void> {
    if (!account || !selectedGroup || selectedGroup.id === "world") {
      return;
    }
    if (!navigator.onLine || !hasApi()) {
      setPopupMessage("Opuszczenie grupy wymaga połączenia z internetem.");
      return;
    }
    try {
      await leaveGroup(selectedGroup.id, account.sessionToken);
      const nextGroups = await fetchGroups(account.sessionToken);
      setGroups(nextGroups);
      setSelectedGroupId(nextGroups[0]?.id ?? "world");
      setPopupMessage("Opuściłeś grupę.");
    } catch {
      setPopupMessage("Nie udało się opuścić grupy.");
    }
  }

  function startGame(): void {
    if (!account || !selectedMode) {
      setPopupMessage("Najpierw zaloguj się i wybierz tryb.");
      return;
    }
    setGame(createGameState(selectedMode, progress));
    setScreen("game");
  }

  function cancelGame(): void {
    setGame(null);
    setScreen("home");
    setPopupMessage("Gra została przerwana.");
  }

  function appendInput(value: string): void {
    setGame((current) => (current ? { ...current, input: `${current.input}${value}`.slice(0, 4) } : current));
  }

  function backspaceInput(): void {
    setGame((current) => (current ? { ...current, input: current.input.slice(0, -1) } : current));
  }

  function clearInput(): void {
    setGame((current) => (current ? { ...current, input: "" } : current));
  }

  function submitAnswer(): void {
    if (!game || !currentTask) {
      return;
    }
    const answer = Number(game.input);
    const elapsed = Date.now() - game.taskStartedAt;
    if (answer === currentTask.answer) {
      updateProgressForTask(currentTask, true, elapsed);
      if (game.currentIndex === game.queue.length - 1) {
        finishGame(game.correctAnswers + 1, game.queue.length);
        return;
      }
      setGame({
        ...game,
        currentIndex: game.currentIndex + 1,
        correctAnswers: game.correctAnswers + 1,
        taskStartedAt: Date.now(),
        input: "",
        message: { type: "correct", text: "Świetnie!" },
        waitingForContinue: false,
        remainingMs: HOST_CONFIG.timer.enabled ? HOST_CONFIG.timer.secondsPerTask * 1000 : null
      });
      return;
    }
    updateProgressForTask(currentTask, false, elapsed);
    setGame(handleWrongAnswer(game, `Poprawna odpowiedź: ${currentTask.answer}`));
  }

  function handleWrongAnswer(current: TaskAttemptState, message: string): TaskAttemptState {
    const task = current.queue[current.currentIndex];
    const nextQueue = [...current.queue];
    nextQueue.splice(current.currentIndex, 1);
    nextQueue.push(task);
    return {
      ...current,
      queue: nextQueue,
      input: "",
      message: { type: "wrong", text: message },
      waitingForContinue: true,
      remainingMs: HOST_CONFIG.timer.enabled ? HOST_CONFIG.timer.secondsPerTask * 1000 : null
    };
  }

  function updateProgressForTask(task: FactTask, correct: boolean, elapsedMs: number): void {
    if (!account || !selectedModeId) {
      return;
    }
    setProgress((current) => {
      const existing = normalizeFactStats(current[task.key]);
      const attempts = existing.attempts + 1;
      const answeredAt = new Date().toISOString();
      const delta: ProgressSnapshot = {
        [task.key]: {
          attempts: 1,
          correct: correct ? 1 : 0,
          wrong: correct ? 0 : 1,
          averageMs: elapsedMs,
          lastAnsweredAt: answeredAt
        }
      };
      const next = {
        ...current,
        [task.key]: {
          attempts,
          correct: existing.correct + (correct ? 1 : 0),
          wrong: existing.wrong + (correct ? 0 : 1),
          averageMs: Math.round((existing.averageMs * existing.attempts + elapsedMs) / attempts),
          lastAnsweredAt: answeredAt
        }
      };
      queueProgressSync(account.accountId, selectedModeId, delta);
      return next;
    });
  }

  function queueProgressSync(accountId: string, modeId: string, delta: ProgressSnapshot): void {
    const items = loadPendingProgress();
    const entry: PendingProgressSync = {
      id: crypto.randomUUID(),
      accountId,
      modeId,
      delta,
      updatedAt: new Date().toISOString(),
      synced: false
    };
    savePendingProgress([...items, entry]);
  }

  function finishGame(correctAnswers: number, totalTasks: number): void {
    if (!account || !selectedModeId) {
      return;
    }
    const totalTimeMs = Date.now() - (game?.startedAt ?? Date.now());
    const previousBest = [...remoteBoard, ...localBoard]
      .filter((entry) => entry.id === `${account.accountId}:${selectedModeId}`)
      .sort((a, b) => {
        if (b.correctAnswers !== a.correctAnswers) {
          return b.correctAnswers - a.correctAnswers;
        }
        return a.totalTimeMs - b.totalTimeMs;
      })[0];
    const isNewBest =
      !previousBest ||
      correctAnswers > previousBest.correctAnswers ||
      (correctAnswers === previousBest.correctAnswers && totalTimeMs < previousBest.totalTimeMs);
    const bestTimeMs = isNewBest ? totalTimeMs : previousBest?.totalTimeMs ?? totalTimeMs;
    const result: PendingResultSync = {
      id: crypto.randomUUID(),
      accountId: account.accountId,
      modeId: selectedModeId,
      childName: account.childName,
      correctAnswers,
      totalTasks,
      totalTimeMs,
      createdAt: new Date().toISOString(),
      synced: false
    };
    setLocalBoard((current) => {
      const filtered = current.filter((entry) => entry.id !== account.accountId + ":" + selectedModeId);
      const bestEntry = isNewBest
        ? {
            id: account.accountId + ":" + selectedModeId,
            modeId: selectedModeId,
            childName: account.childName,
            correctAnswers,
            totalTasks,
            totalTimeMs,
            createdAt: result.createdAt
          }
        : previousBest
          ? {
              id: account.accountId + ":" + selectedModeId,
              modeId: selectedModeId,
              childName: previousBest.childName,
              correctAnswers: previousBest.correctAnswers,
              totalTasks: previousBest.totalTasks,
              totalTimeMs: previousBest.totalTimeMs,
              createdAt: previousBest.createdAt
            }
          : {
              id: account.accountId + ":" + selectedModeId,
              modeId: selectedModeId,
              childName: account.childName,
              correctAnswers,
              totalTasks,
              totalTimeMs,
              createdAt: result.createdAt
            };
      return [...filtered, bestEntry];
    });
    savePendingResults([...loadPendingResults(), result]);
    setLastResult({
      childName: account.childName,
      correctAnswers,
      totalTasks,
      totalTimeMs,
      synced: false,
      isNewBest,
      bestTimeMs
    });
    setGame(null);
    setScreen("results");
    if (selectedGroupId) {
      void flushPendingSync(account, selectedModeId, selectedGroupId);
    }
  }

  const mergedLeaderboard = useMemo(() => {
    const localForMode = selectedModeId
      ? localBoard.filter((entry) => (entry.modeId ? entry.modeId === selectedModeId : entry.id.endsWith(`:${selectedModeId}`)))
      : localBoard;
    const combined = [...remoteBoard, ...localForMode];
    const unique = new Map<string, LeaderboardEntry>();
    for (const entry of combined) {
      unique.set(entry.id, entry);
    }
    return [...unique.values()].sort((a, b) => {
      if (b.correctAnswers !== a.correctAnswers) {
        return b.correctAnswers - a.correctAnswers;
      }
      return a.totalTimeMs - b.totalTimeMs;
    });
  }, [localBoard, remoteBoard, selectedModeId]);

  const visibleActivity = useMemo(
    () => activity.filter((event) => event.eventType !== "game_completed"),
    [activity]
  );

  function displayGroupName(name: string | null | undefined, groupId: string | null | undefined): string {
    if (groupId === "world") {
      return "Świat";
    }
    return name ?? "Grupa";
  }

  function renderAccountGate(): JSX.Element {
    return (
      <div className="card stack">
        <div className="sectionTitleRow">
          <h2>{authMode === "register" ? "Utwórz konto" : "Zaloguj się"}</h2>
          <button className="ghostButton small" onClick={() => setAuthMode((current) => (current === "register" ? "login" : "register"))}>
            {authMode === "register" ? "Mam konto" : "Nowe konto"}
          </button>
        </div>
        <label className="field">
          <span>Imię</span>
          <input value={authName} onChange={(event) => setAuthName(event.target.value.slice(0, 20))} placeholder="Unikalne imię" />
        </label>
        <label className="field">
          <span>PIN</span>
          <input value={authPin} onChange={(event) => setAuthPin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="4 do 6 cyfr" />
        </label>
        <button className="primaryButton" onClick={() => void submitAuth()} disabled={authBusy}>
          {authBusy ? "Chwila..." : authMode === "register" ? "Utwórz konto online" : "Zaloguj online"}
        </button>
      </div>
    );
  }

  function renderHome(): JSX.Element {
    return (
      <section className="screen">
        <div className="hero">
          <h1 className="heroTitle">Mistrz Mnożenia</h1>
          <p className="heroSubheading">Grupy, tryby i ranking postępów</p>
          <p className="subtitle heroDescription">Wybierz grupę i tryb, a potem poprawiaj swój najlepszy wynik.</p>
        </div>
        {account ? (
          <div className="card stack">
            <p className="statusLine">
              Zalogowano jako <strong>{account.childName}</strong>.
            </p>
            {invitePreview ? (
              <div className="card stack softCard">
                <p className="name">Zaproszenie do grupy: {displayGroupName(invitePreview.groupName, invitePreview.groupId)}</p>
                <p className="statusLine">Zaproszenie dla: {invitePreview.invitedName}</p>
                <p className="statusLine">
                  Status: {translateInviteStatus(invitePreview.status)}. Wygasa: {new Date(invitePreview.expiresAt).toLocaleString("pl-PL")}
                </p>
                <label className="field">
                  <span>Twoja nazwa w grupie</span>
                  <input value={inviteDisplayName} onChange={(event) => setInviteDisplayName(event.target.value.slice(0, 40))} />
                </label>
                <button className="primaryButton" onClick={() => void handleAcceptInvite()}>
                  Dołącz do grupy
                </button>
              </div>
            ) : null}
            <label className="field">
              <span>Grupa</span>
              <select value={selectedGroup?.id ?? ""} onChange={(event) => setSelectedGroupId(event.target.value)}>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {displayGroupName(group.name, group.id)}
                  </option>
                ))}
              </select>
            </label>
            {selectedGroup && selectedGroup.id !== "world" ? (
              <button className="ghostButton" onClick={() => setLeaveGroupPromptOpen(true)}>
                Opuść grupę
              </button>
            ) : null}
            <label className="field">
              <span>Tryb</span>
              <select value={selectedMode?.id ?? ""} onChange={(event) => setSelectedModeId(event.target.value)}>
                {modes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="buttonGrid">
              <button className="primaryButton" onClick={startGame}>
                Start
              </button>
              <button className="secondaryButton" onClick={() => setScreen("leaderboard")}>
                Ranking
              </button>
              <button className="secondaryButton" onClick={() => setScreen("activity")}>
                Aktywność
              </button>
              <button className="secondaryButton" onClick={() => { setScreen("group"); void refreshGroupManagement(); }}>
                Grupa
              </button>
              <button className="secondaryButton" onClick={() => setGroupPromptOpen(true)}>
                Nowa grupa
              </button>
              <button className="ghostButton" onClick={() => forceLogout("Wylogowano.")}>
                Wyloguj
              </button>
            </div>
            <p className="statusLine">{syncStatus}</p>
          </div>
        ) : (
          renderAccountGate()
        )}
      </section>
    );
  }

  function renderGame(): JSX.Element {
    if (!game || !currentTask || !account) {
      return renderHome();
    }
    return (
      <section className="screen gameScreen">
        <div className="hud">
          <p>
            Zadanie {game.currentIndex + 1} / {game.queue.length}
          </p>
          <p>{account.childName}</p>
          {HOST_CONFIG.timer.enabled ? <p>{Math.ceil((game.remainingMs ?? 0) / 1000)}s</p> : <p>Bez timera</p>}
        </div>
        <button className="ghostButton gameExitButton" onClick={cancelGame}>
          Wróć do menu
        </button>
        <div className="problemCard">
          <p className="problem">
            {currentTask.left} × {currentTask.right}
          </p>
          <div className="answerBox">{game.input || "?"}</div>
          {game.message ? <div className={`feedback ${game.message.type}`}>{game.message.text}</div> : <div className="feedback neutral">Dotknij cyfry, a potem naciśnij Enter.</div>}
        </div>
        <div className="keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Czyść", "0", "Cofnij"].map((key) => (
            <button
              key={key}
              className={`key ${key.length > 1 ? "action" : ""}`}
              onClick={() => {
                if (key === "Czyść") {
                  clearInput();
                } else if (key === "Cofnij") {
                  backspaceInput();
                } else {
                  appendInput(key);
                }
              }}
              disabled={game.waitingForContinue}
            >
              {key}
            </button>
          ))}
        </div>
        <button className="primaryButton large" onClick={submitAnswer} disabled={game.waitingForContinue}>
          Enter
        </button>
      </section>
    );
  }

  function renderResults(): JSX.Element {
    if (!lastResult) {
      return renderHome();
    }
    return (
      <section className="screen">
        <div className={`card stack celebrate ${lastResult.isNewBest ? "recordCelebration" : ""}`}>
          <p className="eyebrow">{lastResult.isNewBest ? "Nowy Rekord" : "Wynik"}</p>
          {lastResult.isNewBest ? (
            <div className="recordHero">
              <div className="mascotBadge" aria-hidden="true">
                <div className="mascotFace">
                  <span className="eye left" />
                  <span className="eye right" />
                  <span className="smile" />
                </div>
                <div className="mascotRibbon left" />
                <div className="mascotRibbon right" />
              </div>
              <div className="recordCopy">
                <h2>Brawo, {lastResult.childName}!</h2>
                <p className="subtitle">To Twój nowy najlepszy czas. Tak trzymaj!</p>
              </div>
            </div>
          ) : (
            <div className="recordCopy">
              <h2>Dobra próba, {lastResult.childName}!</h2>
              <p className="subtitle">Tym razem rekordu nie udało się pobić, ale ćwiczysz dalej.</p>
            </div>
          )}
          <p className={lastResult.isNewBest ? "recordTime" : undefined}>
            {lastResult.isNewBest ? "Nowy najlepszy czas: " : "Dzisiejszy czas: "}
            <strong>{formatMs(lastResult.totalTimeMs)}</strong>
          </p>
          {!lastResult.isNewBest ? (
            <p className="subtitle resultBestInfo">Twój najlepszy wynik nadal wynosi <strong>{formatMs(lastResult.bestTimeMs)}</strong>.</p>
          ) : null}
          <div className="buttonGrid">
            <button className="primaryButton" onClick={startGame}>
              Zagraj jeszcze raz
            </button>
            <button className="secondaryButton" onClick={() => setScreen("leaderboard")}>
              Ranking
            </button>
            <button className="ghostButton" onClick={() => setScreen("home")}>
              Strona główna
            </button>
          </div>
        </div>
      </section>
    );
  }

  function renderLeaderboard(): JSX.Element {
    return (
      <section className="screen">
        <div className="card stack">
          <div className="sectionTitleRow">
            <h2>Ranking</h2>
            <button className="ghostButton small" onClick={() => setScreen("home")}>
              Wstecz
            </button>
          </div>
          <p className="subtitle">
            {displayGroupName(selectedGroup?.name, selectedGroup?.id)} • {selectedMode?.label ?? "Tryb"}
          </p>
          <div className="leaderboardList">
            {mergedLeaderboard.length === 0 ? (
              <p className="statusLine">Nie ma jeszcze żadnych wyników.</p>
            ) : (
              mergedLeaderboard.map((entry, index) => (
                <article className="leaderboardRow" key={entry.id}>
                  <div>
                    <p className="rank">#{index + 1}</p>
                    <p className="name">{entry.childName}</p>
                  </div>
                  <div className="leaderboardMeta">
                    <p>{formatMs(entry.totalTimeMs)}</p>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    );
  }

  function renderActivity(): JSX.Element {
    return (
      <section className="screen">
        <div className="card stack">
          <div className="sectionTitleRow">
            <h2>Aktywność</h2>
            <button className="ghostButton small" onClick={() => setScreen("home")}>
              Wstecz
            </button>
          </div>
          <p className="subtitle">
            {displayGroupName(selectedGroup?.name, selectedGroup?.id)} • {selectedMode?.label ?? "Tryb"}
          </p>
          <div className="leaderboardList">
            {visibleActivity.length === 0 ? (
              <p className="statusLine">Brak aktywności.</p>
            ) : (
              visibleActivity.map((event) => (
                <article className="leaderboardRow" key={event.id}>
                  <div>
                    <p className="name">{translateEvent(event)}</p>
                    <p className="rank">{new Date(event.createdAt).toLocaleString("pl-PL")}</p>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    );
  }

  function renderGroup(): JSX.Element {
    const myMembership = members.find((member) => member.accountId === account?.accountId) ?? null;
    const canManage = myMembership ? ["owner", "admin"].includes(myMembership.role) : false;
    const isOwner = myMembership?.role === "owner";
    return (
      <section className="screen">
        <div className="card stack">
          <div className="sectionTitleRow">
            <h2>Grupa</h2>
            <button className="ghostButton small" onClick={() => setScreen("home")}>
              Wstecz
            </button>
          </div>
          <p className="subtitle">{displayGroupName(selectedGroup?.name, selectedGroup?.id ?? null)}</p>

          <div className="card stack softCard">
            <p className="name">Członkowie</p>
            {members.length === 0 ? <p className="statusLine">Brak członków.</p> : members.map((member) => (
              <article className="leaderboardRow" key={member.accountId}>
                <div>
                  <p className="name">{member.displayName}</p>
                  <p className="rank">
                    {member.childName} • {translateRole(member.role)}
                    {member.invitedName ? ` • zaproszony jako ${member.invitedName}` : ""}
                  </p>
                </div>
                {account && selectedGroup ? (
                  <div className="memberActions">
                    {isOwner && member.role === "member" ? (
                      <button className="ghostButton small" onClick={() => void handleGrantAdmin(member.accountId)}>
                        Daj admina
                      </button>
                    ) : null}
                    {isOwner && member.role === "admin" ? (
                      <button className="ghostButton small" onClick={() => void handleRevokeAdmin(member.accountId)}>
                        Odbierz admina
                      </button>
                    ) : null}
                    {member.role !== "owner" && member.accountId !== account.accountId && (isOwner || myMembership?.role === "admin") ? (
                      <button className="ghostButton small" onClick={() => void handleRemoveMember(member.accountId)}>
                        Usuń
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          {canManage ? (
            <div className="card stack softCard">
              <p className="name">Zaproś osobę</p>
              <label className="field">
                <span>Imię zapraszanej osoby</span>
                <input value={inviteName} onChange={(event) => setInviteName(event.target.value.slice(0, 40))} placeholder="Np. Tom" />
              </label>
              <p className="statusLine">Zaproszenie będzie ważne przez {HOST_CONFIG.invites.expirationHours} godzin.</p>
              <button className="secondaryButton" onClick={() => void handleCreateInvite()}>
                Utwórz link zaproszenia
              </button>
              {latestInviteUrl ? (
                <div className="inviteLinkBox">
                  <p className="rank">Ostatni link zaproszenia</p>
                  <p className="inviteUrl">{latestInviteUrl}</p>
                  <button className="ghostButton small" onClick={() => void handleCopyInviteUrl(latestInviteUrl)}>
                    Kopiuj link
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {canManage ? (
            <div className="card stack softCard">
              <p className="name">Oczekujące zaproszenia</p>
              {invites.filter((invite) => invite.status === "pending").length === 0 ? (
                <p className="statusLine">Brak oczekujących zaproszeń.</p>
              ) : invites.filter((invite) => invite.status === "pending").map((invite) => (
                <article className="leaderboardRow pendingRow" key={invite.id}>
                  <div>
                    <p className="name mutedName">{invite.invitedName}</p>
                    <p className="rank">
                      Wygasa: {new Date(invite.expiresAt).toLocaleString("pl-PL")}
                      {invite.invitedByChildName ? ` • od ${invite.invitedByChildName}` : ""}
                    </p>
                    <p className="inviteUrl smallUrl">
                      {`${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(invite.inviteToken)}`}
                    </p>
                  </div>
                  <div className="memberActions">
                    <button
                      className="ghostButton small"
                      onClick={() =>
                        void handleCopyInviteUrl(
                          `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(invite.inviteToken)}`
                        )
                      }
                    >
                      Kopiuj
                    </button>
                    <button className="ghostButton small" onClick={() => void handleRevokeInvite(invite.id)}>
                      Usuń
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <main className="appShell">
      {screen === "home" && renderHome()}
      {screen === "game" && renderGame()}
      {screen === "results" && renderResults()}
      {screen === "leaderboard" && renderLeaderboard()}
      {screen === "activity" && renderActivity()}
      {screen === "group" && renderGroup()}
      {popupMessage ? (
        <div className="popupOverlay" role="dialog" aria-modal="true">
          <div className="popupCard">
            <p className="popupMessage">{popupMessage}</p>
            <button className="primaryButton" onClick={() => setPopupMessage(null)}>
              OK
            </button>
          </div>
        </div>
      ) : null}
      {groupPromptOpen ? (
        <div className="popupOverlay" role="dialog" aria-modal="true">
          <div className="popupCard popupFormCard">
            <p className="popupMessage">Podaj nazwę nowej grupy.</p>
            <label className="field popupField">
              <span>Nazwa grupy</span>
              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value.slice(0, 40))}
                placeholder="Np. Klasa 3A"
                autoFocus
              />
            </label>
            <div className="buttonGrid popupButtonGrid">
              <button className="primaryButton" onClick={() => void handleCreateGroup()}>
                Utwórz
              </button>
              <button
                className="ghostButton"
                onClick={() => {
                  setGroupPromptOpen(false);
                  setNewGroupName("");
                }}
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {leaveGroupPromptOpen && selectedGroup ? (
        <div className="popupOverlay" role="dialog" aria-modal="true">
          <div className="popupCard">
            <p className="popupMessage">Czy na pewno chcesz opuścić grupę „{selectedGroup.name}”?</p>
            <div className="buttonGrid popupButtonGrid">
              <button
                className="primaryButton"
                onClick={() => {
                  setLeaveGroupPromptOpen(false);
                  void handleLeaveGroup();
                }}
              >
                Opuść
              </button>
              <button className="ghostButton" onClick={() => setLeaveGroupPromptOpen(false)}>
                Zostań
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function aggregatePendingProgress(items: PendingProgressSync[], accountId: string, modeId: string): ProgressSnapshot {
  return items
    .filter((item) => item.accountId === accountId && item.modeId === modeId && !item.synced)
    .reduce<ProgressSnapshot>((combined, item) => mergeProgressSnapshots(combined, item.delta), {});
}

function translateEvent(event: ActivityEvent): string {
  if (event.eventType === "game_completed") {
    const childName = String(event.payload.childName ?? "Użytkownik");
    const totalTimeMs = Number(event.payload.totalTimeMs ?? 0);
    const updatedBest = Boolean(event.payload.updatedBest);
    return `${childName}: ukończył grę w czasie ${formatMs(totalTimeMs)}${updatedBest ? " • nowy rekord" : ""}`;
  }
  if (event.eventType === "best_result_updated") {
    const rankAfter = event.payload.rankAfter;
    const childName = String(event.payload.childName ?? "Użytkownik");
    const totalTimeMs = Number(event.payload.totalTimeMs ?? 0);
    return `${childName}: nowy najlepszy czas ${formatMs(totalTimeMs)}${rankAfter ? ` • miejsce #${String(rankAfter)}` : ""}`;
  }
  if (event.eventType === "group_member_joined") {
    return `${String(event.payload.displayName ?? "Użytkownik")} dołączył do grupy`;
  }
  if (event.eventType === "group_member_left") {
    return `${String(event.payload.displayName ?? "Użytkownik")} opuścił grupę`;
  }
  if (event.eventType === "group_invite_created") {
    return `Wysłano zaproszenie dla ${String(event.payload.invitedName ?? "użytkownika")}`;
  }
  if (event.eventType === "group_invite_accepted") {
    return `${String(event.payload.displayName ?? "Użytkownik")} zaakceptował zaproszenie`;
  }
  if (event.eventType === "group_admin_granted") {
    return "Nadano uprawnienia administratora";
  }
  if (event.eventType === "group_admin_revoked") {
    return "Odebrano uprawnienia administratora";
  }
  if (event.eventType === "group_member_removed") {
    return "Usunięto członka grupy";
  }
  return "Aktywność grupy";
}

function translateRole(role: GroupMember["role"]): string {
  if (role === "owner") {
    return "właściciel";
  }
  if (role === "admin") {
    return "admin";
  }
  return "członek";
}

function translateInviteStatus(status: InvitePreview["status"]): string {
  if (status === "accepted") {
    return "zaakceptowane";
  }
  if (status === "expired") {
    return "wygasło";
  }
  if (status === "revoked") {
    return "usunięte";
  }
  return "oczekujące";
}
