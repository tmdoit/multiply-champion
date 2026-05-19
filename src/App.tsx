import { useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG } from "./constants";
import { loadChildName, loadProgress, saveChildName, saveProgress } from "./storage";
import type { GameState, PathProgress, RunResult, Screen } from "./types";
import { buildSessionQueue, formatMs, getAllPathSummaries } from "./utils";
import "./styles.css";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [progress, setProgress] = useState<PathProgress>(() => loadProgress());
  const [childName, setChildName] = useState<string>(() => loadChildName());
  const [nameDraft, setNameDraft] = useState<string>(() => loadChildName());
  const [editingName, setEditingName] = useState<boolean>(() => !loadChildName());
  const [shareStatus, setShareStatus] = useState<string>("");
  const [game, setGame] = useState<GameState | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const timerRef = useRef<number | null>(null);
  const shareStatusRef = useRef<number | null>(null);
  const gameRef = useRef<GameState | null>(null);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    document.body.classList.toggle("gameLocked", screen === "game");
    return () => document.body.classList.remove("gameLocked");
  }, [screen]);

  useEffect(() => {
    return () => {
      if (shareStatusRef.current) {
        window.clearTimeout(shareStatusRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!game || game.waitingForNext) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = window.setInterval(() => {
      setGame((current) => {
        if (!current || current.waitingForNext) {
          return current;
        }
        const elapsed = Date.now() - current.taskStartedAt;
        const remainingMs = Math.max(0, APP_CONFIG.timerSecondsPerTask * 1000 - elapsed);
        if (remainingMs === 0) {
          window.setTimeout(
            () => handleIncorrectAnswer(`Czas minął. Poprawna odpowiedź: ${current.queue[current.currentIndex].answer}`),
            0
          );
          return {
            ...current,
            remainingMs: 0,
            waitingForNext: true
          };
        }
        return { ...current, remainingMs };
      });
    }, 200);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [game]);

  useEffect(() => {
    if (!game?.waitingForNext) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const current = gameRef.current;
      if (!current) {
        return;
      }
      const nextQueue = current.pendingQueue ?? current.queue;
      const nextIndex = current.pendingIndex ?? current.currentIndex;
      if (nextIndex >= nextQueue.length) {
        finishRun(current.pathMultiplier, current.solvedCount);
        return;
      }
      setGame({
        ...current,
        queue: nextQueue,
        currentIndex: nextIndex,
        input: "",
        feedback: null,
        waitingForNext: false,
        pendingQueue: null,
        pendingIndex: null,
        feedbackDelayMs: APP_CONFIG.feedbackPauseMs,
        taskStartedAt: Date.now(),
        remainingMs: APP_CONFIG.timerSecondsPerTask * 1000
      });
    }, game.feedbackDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [game?.waitingForNext, game?.feedbackDelayMs]);

  const pathSummaries = useMemo(() => getAllPathSummaries(progress), [progress]);
  const currentTask = game ? game.queue[game.currentIndex] : null;

  function flashShareStatus(message: string): void {
    setShareStatus(message);
    if (shareStatusRef.current) {
      window.clearTimeout(shareStatusRef.current);
    }
    shareStatusRef.current = window.setTimeout(() => setShareStatus(""), 2400);
  }

  async function handleShare(): Promise<void> {
    const shareData = {
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(window.location.href);
        flashShareStatus("Link skopiowany");
        return;
      }

      window.location.href = `sms:?&body=${encodeURIComponent(window.location.href)}`;
    } catch {
      flashShareStatus("Nie udało się udostępnić");
    }
  }

  function saveName(): void {
    const trimmed = nameDraft.trim();
    setChildName(trimmed);
    saveChildName(trimmed);
    setEditingName(false);
  }

  function startRun(multiplier: number): void {
    setGame({
      pathMultiplier: multiplier,
      queue: buildSessionQueue(multiplier),
      currentIndex: 0,
      input: "",
      feedback: null,
      waitingForNext: false,
      pendingQueue: null,
      pendingIndex: null,
      feedbackDelayMs: APP_CONFIG.feedbackPauseMs,
      startedAt: Date.now(),
      taskStartedAt: Date.now(),
      remainingMs: APP_CONFIG.timerSecondsPerTask * 1000,
      solvedCount: 0,
      mistakeCount: 0
    });
    setScreen("game");
  }

  function cancelRun(): void {
    setGame(null);
    setScreen("home");
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
    if (!gameRef.current || !currentTask) {
      return;
    }
    const answer = Number(gameRef.current.input);
    if (!Number.isFinite(answer)) {
      return;
    }
    if (answer === currentTask.answer) {
      handleCorrectAnswer();
      return;
    }
    handleIncorrectAnswer(`Poprawna odpowiedź: ${currentTask.answer}`);
  }

  function handleCorrectAnswer(): void {
    const current = gameRef.current;
    if (!current) {
      return;
    }
    const nextSolvedCount = current.solvedCount + 1;
    const nextIndex = current.currentIndex + 1;
    if (nextIndex >= current.queue.length) {
      finishRun(current.pathMultiplier, nextSolvedCount);
      return;
    }

    setGame({
      ...current,
      currentIndex: nextIndex,
      input: "",
      feedback: {
        type: "correct",
        text: "Dobrze!"
      },
      waitingForNext: false,
      pendingQueue: null,
      pendingIndex: null,
      feedbackDelayMs: APP_CONFIG.successFlashMs,
      taskStartedAt: Date.now(),
      remainingMs: APP_CONFIG.timerSecondsPerTask * 1000,
      solvedCount: nextSolvedCount
    });
  }

  function handleIncorrectAnswer(prefix: string): void {
    const current = gameRef.current;
    if (!current) {
      return;
    }

    setGame({
      ...current,
      input: "",
      feedback: {
        type: "wrong",
        text: prefix
      },
      waitingForNext: true,
      pendingQueue: current.queue,
      pendingIndex: current.currentIndex + 1,
      feedbackDelayMs: APP_CONFIG.feedbackPauseMs,
      remainingMs: 0,
      mistakeCount: current.mistakeCount + 1
    });
  }

  function finishRun(pathMultiplier: number, score: number): void {
    setProgress((current) => ({
      ...current,
      [pathMultiplier]: score
    }));

    setLastResult({
      pathMultiplier,
      completedPath: score >= APP_CONFIG.factsPerPath,
      totalTimeMs: Date.now() - (gameRef.current?.startedAt ?? Date.now()),
      score,
      totalTasks: APP_CONFIG.factsPerPath
    });

    setGame(null);
    setScreen("results");
  }

  function renderHome(): JSX.Element {
    return (
      <section className="screen homeScreen compactHomeScreen">
        <header className="homeHeaderCard card stack">
          <div className="titleRow">
            <div>
              <h1 className="homeTitle">Mistrz Mnożenia</h1>
              <p className="homeSubtitle">Wybierz ścieżkę i zacznij trening.</p>
            </div>
            <button className="ghostButton small shareButton" onClick={() => void handleShare()}>
              Udostępnij
            </button>
          </div>
          {shareStatus ? <p className="shareStatus">{shareStatus}</p> : null}
        </header>

        <section className="nameCard card stack compactCard">
          <div className="namePanelHeader">
            <div>
              <p className="eyebrow">Twoje imię</p>
              {!editingName && childName ? <p className="savedName">{childName}</p> : null}
            </div>
            {!editingName && childName ? (
              <button
                className="ghostButton small iconButton"
                onClick={() => {
                  setNameDraft(childName);
                  setEditingName(true);
                }}
                aria-label="Edytuj imię"
              >
                ✎
              </button>
            ) : null}
          </div>

          {editingName ? (
            <div className="nameEditor">
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value.slice(0, 24))}
                placeholder="Wpisz imię"
              />
              <button className="primaryButton smallActionButton" onClick={saveName} disabled={!nameDraft.trim()}>
                Zapisz
              </button>
            </div>
          ) : null}
        </section>

        <div className="pathList onlyPathsList">
          {pathSummaries.map((path) => (
            <article key={path.multiplier} className={`pathRow pathTone-${path.tone}`}>
              <div className="pathContent">
                <div className="pathHeaderSimple">
                  <p className="name">Mnożenie przez {path.multiplier}</p>
                  <button className="trainButton" onClick={() => startRun(path.multiplier)}>
                    Trenuj
                  </button>
                </div>
                <div className="progressBar miniBar" aria-hidden="true">
                  <span className={`progressFill tone-${path.tone}`} style={{ width: `${Math.round((path.score / path.totalTasks) * 100)}%` }} />
                </div>
                <p className="rank pathScoreText">{path.score}/{path.totalTasks}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  function renderGame(): JSX.Element {
    if (!game || !currentTask) {
      return renderHome();
    }
    return (
      <section className="screen gameScreen compactGameScreen">
        <div className="gameTopBar">
          <button className="ghostButton small backButton" onClick={cancelRun}>
            Wróć
          </button>
        </div>
        <div className="hudCard compactHudCard">
          <div className="hudSummaryRow">
            <div className="hudMetric">
              <span className="hudLabel">Mnożenie</span>
              <strong>×{game.pathMultiplier}</strong>
            </div>
            <div className="hudMetric">
              <span className="hudLabel">Zadanie</span>
              <strong>{game.currentIndex + 1}/{game.queue.length}</strong>
            </div>
            <div className="hudMetric timerMetric">
              <span className="hudLabel">Czas</span>
              <strong>{Math.ceil(game.remainingMs / 1000)}s</strong>
            </div>
          </div>
        </div>

        <div className="problemCard compactProblemCard">
          <p className="problem">{currentTask.left} × {currentTask.right}</p>
          <div className="answerBox">{game.input || "?"}</div>
          {game.feedback ? (
            <div className={`feedback ${game.feedback.type}`}>{game.feedback.text}</div>
          ) : (
            <div className="feedback neutral">Wpisz wynik i naciśnij Enter.</div>
          )}
        </div>

        <div className="keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Czyść", "0", "Cofnij"].map((key) => (
            <button
              key={key}
              className={`key ${key.length > 1 ? "action" : ""}`}
              onClick={() => {
                if (game.waitingForNext) {
                  return;
                }
                if (key === "Czyść") {
                  clearInput();
                } else if (key === "Cofnij") {
                  backspaceInput();
                } else {
                  appendInput(key);
                }
              }}
              disabled={game.waitingForNext}
            >
              {key}
            </button>
          ))}
        </div>

        <button className="primaryButton large" onClick={submitAnswer} disabled={game.waitingForNext}>
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
      <section className="screen resultsScreen">
        <div className={`card stack celebrateCard ${lastResult.completedPath ? "successGlow" : ""}`}>
          <div className="celebrateBurst" aria-hidden="true">
            <span>✨</span>
            <span>🎉</span>
            <span>⭐</span>
          </div>
          <p className="eyebrow">Podsumowanie</p>
          <h2>{lastResult.completedPath ? `Brawo! Mnożenie przez ${lastResult.pathMultiplier} ukończone!` : "Dobra robota!"}</h2>
          <p className="subtitle">
            Czas tej rundy: <strong>{formatMs(lastResult.totalTimeMs)}</strong>
          </p>
          <div className="focusSummary">
            <p className="bigProgress">{lastResult.score}/{lastResult.totalTasks}</p>
          </div>
          <button className="primaryButton" onClick={() => setScreen("home")}>
            Wróć do menu
          </button>
        </div>
      </section>
    );
  }

  return <main className="appShell">{screen === "home" ? renderHome() : screen === "game" ? renderGame() : renderResults()}</main>;
}
