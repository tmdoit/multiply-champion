import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptInvite,
  createGroup,
  createInvite,
  fetchActivity,
  fetchGroupChat,
  fetchPlayerStats,
  fetchGroupInvites,
  fetchGroupMembers,
  fetchGroups,
  fetchInvitePreview,
  fetchLeaderboard,
  fetchMe,
  grantAdmin,
  sendGroupChatMessage,
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
  loadDailyJourneySteps,
  loadLocalLeaderboard,
  loadSoundEnabled,
  loadPendingProgress,
  loadPendingResults,
  loadProgress,
  loadSelectedGroupId,
  loadSelectedModeId,
  saveConfirmedAccount,
  saveDailyJourneySteps,
  saveLocalLeaderboard,
  saveSoundEnabled,
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
  GroupChatMessage,
  GroupInvite,
  GroupMember,
  GroupSummary,
  InvitePreview,
  JourneyProgress,
  LeaderboardEntry,
  ModeSummary,
  PlayerStats,
  PendingProgressSync,
  PendingResultSync,
  ProgressSnapshot,
  Screen
} from "./types";
import { buildFactPool, calculateJourneyProgress, formatMs, getFactMasteryStep, mergeProgressSnapshots, normalizeFactStats, pickWeightedTasks } from "./utils";

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
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => loadSoundEnabled());
  const [dailyJourneySteps, setDailyJourneySteps] = useState(0);
  const [journeyMoment, setJourneyMoment] = useState<{ kind: "step" | "star"; id: number } | null>(null);
  const [chatMessages, setChatMessages] = useState<GroupChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
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
  const audioContextRef = useRef<AudioContext | null>(null);

  const selectedMode = useMemo(
    () => modes.find((mode) => mode.id === selectedModeId) ?? modes.find((mode) => mode.isDefault) ?? null,
    [modes, selectedModeId]
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null,
    [groups, selectedGroupId]
  );
  const currentTask = game ? game.queue[game.currentIndex] : null;
  const journey = useMemo<JourneyProgress | null>(
    () => calculateJourneyProgress(selectedMode, progress, dailyJourneySteps),
    [selectedMode, progress, dailyJourneySteps]
  );
  const selectedGroupMemberCount = selectedGroup ? members.filter((member) => member).length : 0;
  const ownerMustStayUntilAlone = selectedGroup?.role === "owner" && selectedGroup.id !== "world" && selectedGroupMemberCount > 1;

  useEffect(() => {
    saveLocalLeaderboard(localBoard);
  }, [localBoard]);

  useEffect(() => {
    saveSoundEnabled(soundEnabled);
  }, [soundEnabled]);

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
    if (account && selectedModeId) {
      setDailyJourneySteps(loadDailyJourneySteps(account.accountId, selectedModeId));
    } else {
      setDailyJourneySteps(0);
    }
  }, [account, selectedModeId]);

  useEffect(() => {
    if (!journeyMoment) {
      return;
    }
    const timeoutId = window.setTimeout(() => setJourneyMoment(null), journeyMoment.kind === "star" ? 2200 : 1400);
    return () => window.clearTimeout(timeoutId);
  }, [journeyMoment]);


  useEffect(() => {
    if (!journeyMoment) {
      return;
    }
    if (!soundEnabled) {
      return;
    }
    void playCelebrationSound(audioContextRef, journeyMoment.kind === "star" ? "star" : "step");
  }, [journeyMoment, soundEnabled]);

  useEffect(() => {
    if (account && selectedGroupId && selectedModeId) {
      void refreshBoardAndActivity(account, selectedGroupId, selectedModeId);
      void flushPendingSync(account, selectedModeId, selectedGroupId);
    }
  }, [account, selectedGroupId, selectedModeId]);

  useEffect(() => {
    if (!account || !selectedGroupId || selectedGroupId === "world" || !navigator.onLine || !hasApi()) {
      return;
    }
    void fetchGroupMembers(selectedGroupId, account.sessionToken)
      .then((memberList) => setMembers(memberList))
      .catch(() => undefined);
  }, [account, selectedGroupId]);

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
    if (screen !== "chat" || !account || !selectedGroupId || !navigator.onLine || !hasApi()) {
      return;
    }
    void refreshChat(account, selectedGroupId);
    const intervalId = window.setInterval(() => {
      void refreshChat(account, selectedGroupId);
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [screen, account, selectedGroupId]);

  useEffect(() => {
    if (!["home", "stats", "results"].includes(screen) || !account || !selectedModeId || !navigator.onLine || !hasApi()) {
      return;
    }
    void refreshStats(account, selectedModeId);
  }, [screen, account, selectedModeId]);


  useEffect(() => {
    if (screen !== "results" || !lastResult?.isNewBest) {
      return;
    }
    if (!soundEnabled) {
      return;
    }
    void playCelebrationSound(audioContextRef, "record");
  }, [screen, lastResult?.isNewBest, soundEnabled]);

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


  async function refreshStats(activeAccount: ConfirmedAccount, modeId: string): Promise<void> {
    if (!navigator.onLine || !hasApi()) {
      return;
    }
    try {
      const nextStats = await fetchPlayerStats(modeId, activeAccount.sessionToken);
      setStats(nextStats);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        forceLogout("Sesja wygasła. Zaloguj się ponownie online.");
      } else {
        setSyncStatus("Statystyki są chwilowo niedostępne offline");
      }
    }
  }

  async function refreshChat(activeAccount: ConfirmedAccount, groupId: string): Promise<void> {
    if (!navigator.onLine || !hasApi()) {
      return;
    }
    try {
      const messages = await fetchGroupChat(groupId, activeAccount.sessionToken);
      setChatMessages(messages);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        forceLogout("Sesja wygasła. Zaloguj się ponownie online.");
      } else {
        setSyncStatus("Czat jest chwilowo niedostępny offline");
      }
    }
  }

  async function handleSendChatMessage(): Promise<void> {
    if (!account || !selectedGroupId) {
      return;
    }
    if (!navigator.onLine || !hasApi()) {
      setPopupMessage("Wysyłanie wiadomości wymaga internetu.");
      return;
    }
    const message = chatInput.trim();
    if (message.length < 1) {
      setPopupMessage("Wpisz wiadomość.");
      return;
    }
    try {
      const sent = await sendGroupChatMessage(selectedGroupId, message, account.sessionToken);
      setChatMessages((current) => [...current, sent]);
      setChatInput("");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        forceLogout("Sesja wygasła. Zaloguj się ponownie online.");
      } else {
        setPopupMessage("Nie udało się wysłać wiadomości.");
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
    if (selectedGroup.role === "owner" && selectedGroupMemberCount > 1) {
      setPopupMessage("Właściciel może opuścić grupę dopiero, gdy zostanie w niej sam.");
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
      const previousStep = getFactMasteryStep(existing);
      const nextFactStats = {
        attempts,
        correct: existing.correct + (correct ? 1 : 0),
        wrong: existing.wrong + (correct ? 0 : 1),
        averageMs: Math.round((existing.averageMs * existing.attempts + elapsedMs) / attempts),
        lastAnsweredAt: answeredAt
      };
      const nextStep = getFactMasteryStep(nextFactStats);
      const delta: ProgressSnapshot = {
        [task.key]: {
          attempts: 1,
          correct: correct ? 1 : 0,
          wrong: correct ? 0 : 1,
          averageMs: elapsedMs,
          lastAnsweredAt: answeredAt
        }
      };
      if (nextStep > previousStep) {
        setJourneyMoment({ kind: nextStep >= 3 ? "star" : "step", id: Date.now() });
        setDailyJourneySteps((currentDailySteps) => {
          const nextDailySteps = currentDailySteps + (nextStep - previousStep);
          saveDailyJourneySteps(account.accountId, selectedModeId, nextDailySteps);
          return nextDailySteps;
        });
      }
      const next = {
        ...current,
        [task.key]: nextFactStats
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

  function renderJourneyPanel(showPathMap: boolean): JSX.Element | null {
    if (!journey) {
      return null;
    }
    const pathPercent = Math.round((journey.currentPathSteps / journey.currentPathTotalSteps) * 100);
    const totalPercent = Math.max(6, journey.percentComplete);
    const dailyProgress = Math.min(journey.dailyGoalProgress, journey.dailyGoalSteps);
    const dailyPercent = Math.min(100, Math.round((dailyProgress / journey.dailyGoalSteps) * 100));
    const nextGoalText =
      journey.currentPathStars >= 3
        ? `Planeta ${journey.currentPathLabel} jest gotowa.`
        : `Jeszcze ${journey.stepsToNextStar} ${formatPolishStepWord(journey.stepsToNextStar)} do gwiazdki.`;

    return (
      <div
        className={`card stack journeyCard ${showPathMap ? "journeyCardDetailed" : ""} ${journeyMoment?.kind === "step" ? "journeyStepBoost" : ""} ${journeyMoment?.kind === "star" ? "journeyStarBurst" : ""}`.trim()}
      >
        <div className="journeyHeader">
          <p className="eyebrow">Kosmiczna ścieżka</p>
          <h2>Ćwiczysz {journey.currentPathLabel}</h2>
          <p className="subtitle">Umiesz już {journey.totalMasteredFacts} z {journey.totalFacts} działań.</p>
        </div>

        {journeyMoment ? (
          <div className={`journeySparkles ${journeyMoment.kind === "star" ? "star" : "step"}`} aria-hidden="true">
            <span>✦</span>
            <span>★</span>
            <span>✦</span>
            <span>★</span>
          </div>
        ) : null}
        <div className="journeyHeroPanel">
          <div className={`journeyPlanet ${journeyMoment?.kind === "star" ? "planetCelebrate" : ""}`} aria-hidden="true">
            <span>{journey.currentPathLabel}</span>
          </div>
          <div className="journeyTrackWrap">
            <div className="journeyTrackLine">
              <span className="journeyTrackFill" style={{ width: `${pathPercent}%` }} />
            </div>
            <div className={`journeyRocket ${journeyMoment?.kind === "step" ? "rocketBoost" : ""} ${journeyMoment?.kind === "star" ? "rocketCelebrate" : ""}`.trim()} style={{ left: `calc(${pathPercent}% - 1.7rem)` }} aria-hidden="true">
              🚀
            </div>
            <div className={`journeyGoalStar ${journeyMoment?.kind === "star" ? "goalStarCelebrate" : ""}`.trim()} aria-hidden="true">★</div>
          </div>
        </div>

        <div className="journeyStatsRow">
          <article className="journeyMiniCard">
            <p className="rank">Lot po planecie</p>
            <p className="journeyPrimaryValue">{journey.currentPathSteps} z {journey.currentPathTotalSteps}</p>
            <p className="subtitle">{nextGoalText}</p>
          </article>
          <article className="journeyMiniCard">
            <p className="rank">Droga do mistrza</p>
            <p className="journeyPrimaryValue">{journey.percentComplete}%</p>
            <p className="subtitle">Opanowane {journey.totalMasteredFacts} działania.</p>
          </article>
        </div>

        <div className="journeyStarsPanel">
          <div className={`journeyStars ${journeyMoment?.kind === "star" ? "starsCelebrate" : ""}`.trim()} aria-label={`Gwiazdki ${journey.currentPathStars} z 3`}>
            {[0, 1, 2].map((index) => (
              <span key={index} className={`journeyStar ${index < journey.currentPathStars ? "filled" : ""}`}>
                ★
              </span>
            ))}
          </div>
          <p className="subtitle">Na tej planecie: {journey.currentPathMasteredFacts} z {journey.currentPathTotalFacts} działań.</p>
        </div>

        <div className="dailyGoalCard">
          <div className="sectionTitleRow">
            <p className="name">Cel na dziś</p>
            <p className="rank">{dailyProgress} z {journey.dailyGoalSteps} iskier</p>
          </div>
          <div className="dailyGoalBar">
            <span className="dailyGoalFill" style={{ width: `${dailyPercent}%` }} />
          </div>
          <p className="subtitle">Każdy dobry krok pcha rakietę dalej.</p>
        </div>

        <div className="journeyFactField">
          <div className="sectionTitleRow">
            <p className="name">Orbity planety {journey.currentPathLabel}</p>
            <p className="rank">Każda kulka to jedno działanie</p>
          </div>
          <div className="journeyFactsGrid">
            {journey.currentPathFacts.map((fact) => (
              <article key={fact.factKey} className={`journeyFactBubble step-${fact.steps}`}>
                <p className="journeyFactValue">{fact.label}</p>
                <p className="journeyFactLevel">{fact.steps}/{fact.maxSteps}</p>
              </article>
            ))}
          </div>
        </div>

        {showPathMap ? (
          <div className="journeyPathMap">
            <div className="sectionTitleRow">
              <p className="name">Cała mapa</p>
              <p className="rank">10 planet do zdobycia</p>
            </div>
            <div className="journeyPathGrid">
              {journey.paths.map((path) => (
                <article key={path.multiplier} className={`journeyPathTile ${path.multiplier === journey.currentPathMultiplier ? "active" : ""} ${path.isComplete ? "complete" : ""}`}>
                  <div className="sectionTitleRow pathTileHeader">
                    <p className="name">{path.label}</p>
                    <p className="rank">{path.steps}/{path.totalSteps}</p>
                  </div>
                  <div className="journeyStars compactStars" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                      <span key={index} className={`journeyStar ${index < path.stars ? "filled" : ""}`}>
                        ★
                      </span>
                    ))}
                  </div>
                  <p className="subtitle">Opanowane {path.masteredFacts}/{path.totalFacts}</p>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        <div className="journeyModeBar" aria-hidden="true">
          <span className="journeyModeBarFill" style={{ width: `${totalPercent}%` }} />
        </div>
      </div>
    );
  }

  function renderModeFocusPanel(): JSX.Element {
    return (
      <div className="card stack journeyCard modeFocusCard">
        <div className="journeyHeader">
          <p className="eyebrow">Szybki lot</p>
          <h2>{selectedMode?.label ?? "Tryb"}</h2>
          <p className="subtitle">W tym trybie ścigasz swój najlepszy czas i ćwiczysz bez kosmicznej mapy.</p>
        </div>
        <div className="journeyStatsRow">
          <article className="journeyMiniCard">
            <p className="rank">Najlepszy czas</p>
            <p className="journeyPrimaryValue">{stats?.bestTimeMs != null ? formatMs(stats.bestTimeMs) : "-"}</p>
          </article>
          <article className="journeyMiniCard">
            <p className="rank">Rozegrane gry</p>
            <p className="journeyPrimaryValue">{stats?.gamesPlayed ?? 0}</p>
          </article>
        </div>
      </div>
    );
  }

  function renderJourneyResultSummary(): JSX.Element | null {
    if (!journey) {
      return null;
    }
    const progressPercent = Math.round((journey.currentPathSteps / journey.currentPathTotalSteps) * 100);
    return (
      <div className={`journeyResultCard softCard ${journeyMoment?.kind === "step" ? "journeyStepBoost" : ""} ${journeyMoment?.kind === "star" ? "journeyStarBurst" : ""}`.trim()}>
        <div className="sectionTitleRow">
          <p className="name">Rakieta leci dalej po {journey.currentPathLabel}</p>
          <div className="journeyStars compactStars" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span key={index} className={`journeyStar ${index < journey.currentPathStars ? "filled" : ""}`}>
                ★
              </span>
            ))}
          </div>
        </div>
        <div className="journeyModeBar" aria-hidden="true">
          <span className="journeyModeBarFill" style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="subtitle">
          {journey.currentPathSteps} z {journey.currentPathTotalSteps} kroków • Umiesz {journey.totalMasteredFacts} z {journey.totalFacts} działań.
        </p>
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
          <>
            {journey ? renderJourneyPanel(false) : renderModeFocusPanel()}
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
                <>
                  <button className="ghostButton" onClick={() => setLeaveGroupPromptOpen(true)} disabled={ownerMustStayUntilAlone}>
                    Opuść grupę
                  </button>
                  {ownerMustStayUntilAlone ? (
                    <p className="statusLine">Właściciel może opuścić grupę dopiero, gdy zostanie w niej sam.</p>
                  ) : null}
                </>
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
              <div className="softCard localSettingsCard toggleRow">
                <div>
                  <p className="name">Dźwięk</p>
                  <p className="rank">Krótki chime za krok, gwiazdkę i rekord.</p>
                </div>
                <button
                  className={`ghostButton small soundToggleButton ${soundEnabled ? "active" : ""}`.trim()}
                  onClick={() => setSoundEnabled((current) => !current)}
                  aria-pressed={soundEnabled}
                >
                  {soundEnabled ? "Włączony" : "Wyłączony"}
                </button>
              </div>
              <div className="buttonGrid">
                <button className="primaryButton" onClick={startGame}>
                  Start
                </button>
                <button className="secondaryButton" onClick={() => setScreen("leaderboard")}>
                  Ranking
                </button>
                <button className="secondaryButton" onClick={() => setScreen("stats")}>
                  Statystyki
                </button>
                <button className="secondaryButton" onClick={() => setScreen("activity")}>
                  Aktywność
                </button>
                <button className="secondaryButton" onClick={() => setScreen("chat")}>
                  Czat
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
          </>
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
          {renderJourneyResultSummary()}
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


  function renderStats(): JSX.Element {
    const strongestFacts = stats?.strongestFacts ?? [];
    const needsPracticeFacts = stats?.needsPracticeFacts ?? [];
    return (
      <section className="screen">
        {journey ? renderJourneyPanel(true) : renderModeFocusPanel()}
        <div className="card stack">
          <div className="sectionTitleRow">
            <h2>Więcej liczb</h2>
            <button className="ghostButton small" onClick={() => setScreen("home")}>
              Wstecz
            </button>
          </div>
          <p className="subtitle">{selectedMode?.label ?? "Tryb"}</p>
          <div className="statsGrid">
            <article className="statsCard">
              <p className="rank">Najlepszy czas</p>
              <p className="statsValue">{stats?.bestTimeMs != null ? formatMs(stats.bestTimeMs) : "-"}</p>
            </article>
            <article className="statsCard">
              <p className="rank">Rozegrane gry</p>
              <p className="statsValue">{stats?.gamesPlayed ?? 0}</p>
            </article>
            <article className="statsCard">
              <p className="rank">Rozwiązane działania</p>
              <p className="statsValue">{stats?.totalFactsAnswered ?? 0}</p>
            </article>
            <article className="statsCard">
              <p className="rank">Gry w 7 dni</p>
              <p className="statsValue">{stats?.gamesLast7Days ?? 0}</p>
            </article>
            <article className="statsCard">
              <p className="rank">Średni czas z 10 gier</p>
              <p className="statsValue">{stats?.averageLast10TimeMs != null ? formatMs(stats.averageLast10TimeMs) : "-"}</p>
            </article>
            <article className="statsCard">
              <p className="rank">Aktualna seria</p>
              <p className="statsValue">{stats?.currentStreakDays ?? 0}</p>
              <p className="rank">Najdłuższa {stats?.longestStreakDays ?? 0}</p>
            </article>
          </div>
          <div className="card stack softCard">
            <p className="name">Umiesz świetnie</p>
            <div className="factStatsList">
              {strongestFacts.length === 0 ? (
                <p className="statusLine">Potrzeba jeszcze kilku gier, aby to ocenić.</p>
              ) : (
                strongestFacts.map((fact) => (
                  <article className="factStatCard" key={fact.factKey}>
                    <p className="name">{fact.factKey.replace("x", "×")}</p>
                    <p className="rank">Średni czas {formatMs(fact.averageMs)} • błędy {fact.wrong}/{fact.attempts}</p>
                  </article>
                ))
              )}
            </div>
          </div>
          <div className="card stack softCard">
            <p className="name">Poćwicz jeszcze</p>
            <div className="factStatsList">
              {needsPracticeFacts.length === 0 ? (
                <p className="statusLine">Na razie nie ma działań wymagających dodatkowej pracy.</p>
              ) : (
                needsPracticeFacts.map((fact) => (
                  <article className="factStatCard" key={fact.factKey}>
                    <p className="name">{fact.factKey.replace("x", "×")}</p>
                    <p className="rank">Średni czas {formatMs(fact.averageMs)} • błędy {fact.wrong}/{fact.attempts}</p>
                  </article>
                ))
              )}
            </div>
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


  function renderChat(): JSX.Element {
    return (
      <section className="screen">
        <div className="card stack">
          <div className="sectionTitleRow">
            <h2>Czat</h2>
            <button className="ghostButton small" onClick={() => setScreen("home")}>
              Wstecz
            </button>
          </div>
          <p className="subtitle">{displayGroupName(selectedGroup?.name, selectedGroup?.id)} • kanał grupy</p>
          <div className="chatList">
            {chatMessages.length === 0 ? (
              <p className="statusLine">Brak wiadomości.</p>
            ) : (
              chatMessages.map((message) => (
                <article className="chatMessageCard" key={message.id}>
                  <div className="sectionTitleRow">
                    <p className="name">{message.displayName}</p>
                    <p className="rank">{new Date(message.createdAt).toLocaleString("pl-PL")}</p>
                  </div>
                  <p className="chatMessageBody">{message.message}</p>
                </article>
              ))
            )}
          </div>
          <label className="field">
            <span>Nowa wiadomość</span>
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value.slice(0, 280))}
              placeholder="Napisz coś do grupy"
            />
          </label>
          <button className="primaryButton" onClick={() => void handleSendChatMessage()}>
            Wyślij
          </button>
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
      {screen === "stats" && renderStats()}
      {screen === "activity" && renderActivity()}
      {screen === "chat" && renderChat()}
      {screen === "group" && renderGroup()}
      {account && screen !== "chat" ? (
        <button className="floatingChatButton" onClick={() => setScreen("chat")} aria-label="Otwórz czat">
          <span className="floatingChatIcon" aria-hidden="true">💬</span>
          <span>Czat</span>
        </button>
      ) : null}
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


function formatPolishStepWord(value: number): string {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "krok";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "kroki";
  }
  return "kroków";
}


type CelebrationSoundKind = "step" | "star" | "record";

async function playCelebrationSound(
  audioContextRef: { current: AudioContext | null },
  kind: CelebrationSoundKind
): Promise<void> {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;
    if (context.state === "suspended") {
      await context.resume();
    }

    if (kind === "step") {
      playTone(context, 587.33, 0, 0.09, 0.035, "triangle");
      playTone(context, 783.99, 0.08, 0.11, 0.025, "sine");
      return;
    }
    if (kind === "star") {
      playTone(context, 659.25, 0, 0.12, 0.04, "triangle");
      playTone(context, 783.99, 0.09, 0.14, 0.035, "triangle");
      playTone(context, 987.77, 0.18, 0.18, 0.03, "sine");
      return;
    }
    playTone(context, 659.25, 0, 0.12, 0.045, "triangle");
    playTone(context, 783.99, 0.1, 0.12, 0.045, "triangle");
    playTone(context, 987.77, 0.21, 0.16, 0.04, "triangle");
    playTone(context, 1318.51, 0.34, 0.24, 0.035, "sine");
  } catch {
    // Sound is optional polish; ignore blocked playback contexts.
  }
}

function playTone(
  context: AudioContext,
  frequency: number,
  offsetSeconds: number,
  durationSeconds: number,
  volume: number,
  type: OscillatorType
): void {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const startAt = context.currentTime + offsetSeconds;
  const endAt = startAt + durationSeconds;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(endAt + 0.02);
}
