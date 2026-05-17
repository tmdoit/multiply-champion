import { useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG } from "./constants";
import { loadChildName, loadProgress, saveChildName, saveProgress } from "./storage";
import type { FactProgress, GameState, RunResult, Screen } from "./types";
import { buildSessionQueue, describeStep, formatMs, getAllPathSummaries, getFactStep, getPathSummary, updateFactStep } from "./utils";
import "./styles.css";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [childName, setChildName] = useState(() => loadChildName());
  const [nameDraft, setNameDraft] = useState(() => loadChildName());
  const [isEditingName, setIsEditingName] = useState(() => loadChildName().trim().length === 0);
  const [progress, setProgress] = useState<FactProgress>(() => loadProgress());
  const [game, setGame] = useState<GameState | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [popupMessage, setPopupMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const progressRef = useRef(progress);

  useEffect(() => {
    saveProgress(progress);
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

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
        finishRun(current.pathMultiplier);
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
  const currentTaskStep = currentTask ? getFactStep(progress, currentTask.key) : 0;

  function handleSaveName(): void {
    const trimmed = nameDraft.trim().slice(0, 20);
    setChildName(trimmed);
    saveChildName(trimmed);
    setIsEditingName(trimmed.length === 0);
    if (!trimmed) {
      setPopupMessage("Możesz wpisać imię później.");
    }
  }

  function startRun(multiplier: number): void {
    const queue = buildSessionQueue(progressRef.current, multiplier);
    setGame({
      pathMultiplier: multiplier,
      queue,
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
    const task = current.queue[current.currentIndex];
    const nextProgress = updateFactStep(progressRef.current, task.key, 1);
    progressRef.current = nextProgress;
    setProgress(nextProgress);

    const nextIndex = current.currentIndex + 1;
    if (nextIndex >= current.queue.length) {
      finishRun(current.pathMultiplier);
      return;
    }

    setGame({
      ...current,
      currentIndex: nextIndex,
      input: "",
      feedback: {
        type: "correct",
        text: getFactStep(nextProgress, task.key) >= APP_CONFIG.stepsPerFact ? "Opanowane!" : "Dobrze!"
      },
      waitingForNext: false,
      pendingQueue: null,
      pendingIndex: null,
      feedbackDelayMs: APP_CONFIG.successFlashMs,
      taskStartedAt: Date.now(),
      remainingMs: APP_CONFIG.timerSecondsPerTask * 1000,
      solvedCount: current.solvedCount + 1
    });
  }

  function handleIncorrectAnswer(prefix: string): void {
    const current = gameRef.current;
    if (!current) {
      return;
    }
    const task = current.queue[current.currentIndex];
    const nextProgress = updateFactStep(progressRef.current, task.key, -1);
    progressRef.current = nextProgress;
    setProgress(nextProgress);

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

  function finishRun(pathMultiplier: number): void {
    const summary = getPathSummary(progressRef.current, pathMultiplier);

    setLastResult({
      childName: childName.trim() || null,
      pathMultiplier,
      completedPath: summary.completed,
      totalTimeMs: Date.now() - (gameRef.current?.startedAt ?? Date.now()),
      steps: summary.steps,
      totalSteps: summary.totalSteps,
      masteredFacts: summary.masteredFacts,
      totalFacts: summary.totalFacts
    });

    setGame(null);
    setScreen("results");
  }

  function renderHome(): JSX.Element {
    return (
      <section className="screen homeScreen">
        <div className="hero">
          <h1 className="heroTitle">Mistrz Mnożenia</h1>
          <p className="subtitle heroDescription">Wybierz ścieżkę, którą chcesz teraz trenować.</p>
        </div>

        <div className="card compactCard nameCard">
          {childName && !isEditingName ? (
            <div className="savedNameRow">
              <div className="savedNameCopy">
                <p className="rank">Twoje imię</p>
                <p className="savedNameValue">{childName}</p>
              </div>
              <button
                className="ghostButton small iconButton"
                onClick={() => {
                  setNameDraft(childName);
                  setIsEditingName(true);
                }}
                aria-label="Edytuj imię"
              >
                ✎
              </button>
            </div>
          ) : (
            <div className="nameEditRow">
              <label className="field nameField">
                <span>Twoje imię</span>
                <input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value.slice(0, 20))}
                  placeholder="Np. Ania"
                />
              </label>
              <div className="nameActions">
                <button className="ghostButton small" onClick={handleSaveName}>
                  Zapisz
                </button>
                {childName ? (
                  <button
                    className="ghostButton small"
                    onClick={() => {
                      setNameDraft(childName);
                      setIsEditingName(false);
                    }}
                  >
                    Anuluj
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="card stack">
          <div className="sectionTitleRow">
            <h2>Ścieżki</h2>
            <p className="statusLine">Wybierz jedną ścieżkę do treningu.</p>
          </div>
          <div className="rulesCard">
            <p className="name">Jak zaliczyć ścieżkę?</p>
            <p className="statusLine">W ścieżce jest 10 działań.</p>
            <p className="statusLine">Każde trzeba zrobić dobrze 3 razy.</p>
            <p className="statusLine">Pomyłka cofa o 1 krok.</p>
          </div>
          <div className="pathList">
            {pathSummaries.map((path) => (
              <article key={path.multiplier} className={`pathRow ${path.completed ? "completed" : ""}`}>
                <div className="pathContent">
                  <div className="sectionTitleRow pathRowHeader">
                    <p className="name">Ścieżka {path.label}</p>
                    <div className="pathHeaderMeta">
                      <p className="rank">{path.steps}/{path.totalSteps}</p>
                      <button className="trainButton" onClick={() => startRun(path.multiplier)}>
                        Trenuj
                      </button>
                    </div>
                  </div>
                  <div className="progressBar miniBar" aria-hidden="true">
                    <span className="progressFill" style={{ width: `${Math.round((path.steps / path.totalSteps) * 100)}%` }} />
                  </div>
                  <p className="rank">Opanowane działania: {path.masteredFacts}/{path.totalFacts}</p>
                  <p className="rank">
                    {path.completed
                      ? "Ta ścieżka jest opanowana. Możesz ćwiczyć ją dalej."
                      : "Ta ścieżka jest w trakcie nauki."}
                  </p>
                </div>
              </article>
            ))}
          </div>
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
              <span className="hudLabel">Ścieżka</span>
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
          <div className="hudStatusRow">
            <span className={`phasePill ${currentTask.phase === "review" ? "reviewPill" : "freshPill"}`}>
              {currentTask.phase === "review" ? "Powtórka" : "Nowe"}
            </span>
            <div className="hudStateText">
              <span>Stan: {currentTaskStep}/3</span>
              <span>{describeStep(currentTaskStep)}</span>
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
          <h2>
            {lastResult.completedPath
              ? `Brawo! Ścieżka ×${lastResult.pathMultiplier} ukończona!`
              : `Dobra robota${lastResult.childName ? `, ${lastResult.childName}` : ""}!`}
          </h2>
          <p className="subtitle">Czas tej rundy: <strong>{formatMs(lastResult.totalTimeMs)}</strong></p>
          <div className="focusSummary">
            <p className="bigProgress">×{lastResult.pathMultiplier} • {lastResult.steps}/{lastResult.totalSteps}</p>
            <p className="statusLine">Opanowane {lastResult.masteredFacts} z {lastResult.totalFacts} działań</p>
          </div>
          <p className="pathHelp">
            {lastResult.completedPath
              ? "Możesz ćwiczyć tę ścieżkę dalej albo wybrać inną."
              : "Wróć do tej ścieżki albo wybierz inną do treningu."}
          </p>
          <button className="primaryButton" onClick={() => setScreen("home")}>
            Wróć do menu
          </button>
        </div>
      </section>
    );
  }

  return (
    <main className="appShell">
      {screen === "home" && renderHome()}
      {screen === "game" && renderGame()}
      {screen === "results" && renderResults()}
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
    </main>
  );
}
