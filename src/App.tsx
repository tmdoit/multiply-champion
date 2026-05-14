import { useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG } from "./constants";
import { loadChildName, loadProgress, saveChildName, saveProgress } from "./storage";
import type { FactProgress, GameState, RunResult, Screen, SessionTask } from "./types";
import {
  buildSessionQueue,
  describeStep,
  formatMs,
  getActiveMultiplier,
  getAllPathSummaries,
  getFactStep,
  getOverallSteps,
  getPathSummary,
  updateFactStep
} from "./utils";
import "./styles.css";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [childName, setChildName] = useState(() => loadChildName());
  const [nameDraft, setNameDraft] = useState(() => loadChildName());
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
          window.setTimeout(() => handleIncorrectAnswer("Czas minął."), 0);
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
  const activeMultiplier = useMemo(() => getActiveMultiplier(progress), [progress]);
  const activePath = useMemo(() => pathSummaries.find((path) => path.multiplier === activeMultiplier) ?? pathSummaries[0], [pathSummaries, activeMultiplier]);
  const allCompleted = pathSummaries.every((path) => path.completed);
  const overallSteps = useMemo(() => getOverallSteps(progress), [progress]);
  const currentTask = game ? game.queue[game.currentIndex] : null;
  const currentTaskStep = currentTask ? getFactStep(progress, currentTask.key) : 0;

  function handleSaveName(): void {
    const trimmed = nameDraft.trim().slice(0, 20);
    setChildName(trimmed);
    saveChildName(trimmed);
    if (!trimmed) {
      setPopupMessage("Imię jest opcjonalne, ale pomaga dopingować dziecko.");
    }
  }

  function startRun(): void {
    if (allCompleted) {
      setPopupMessage("Cała tabliczka została już opanowana. Możesz wracać do ścieżek i ćwiczyć dalej.");
      return;
    }
    const queue = buildSessionQueue(progressRef.current, activeMultiplier);
    if (queue.length === 0) {
      setPopupMessage("Ta ścieżka jest już gotowa. Zaraz odblokuje się kolejna.");
      return;
    }
    setGame({
      pathMultiplier: activeMultiplier,
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

    const repeatedTask: SessionTask = {
      ...task,
      phase: "review",
      stepBefore: getFactStep(nextProgress, task.key)
    };
    const nextQueue = [...current.queue];
    nextQueue.splice(current.currentIndex, 1);
    nextQueue.push(repeatedTask);

    setGame({
      ...current,
      input: "",
      feedback: {
        type: "wrong",
        text: `${prefix} To działanie wróci jeszcze raz.`
      },
      waitingForNext: true,
      pendingQueue: nextQueue,
      pendingIndex: current.currentIndex,
      feedbackDelayMs: APP_CONFIG.feedbackPauseMs,
      remainingMs: 0,
      mistakeCount: current.mistakeCount + 1
    });
  }

  function finishRun(pathMultiplier: number): void {
    const allSummaries = getAllPathSummaries(progressRef.current);
    const summary = getPathSummary(progressRef.current, pathMultiplier, getActiveMultiplier(progressRef.current));
    const nextPath = allSummaries.find((path) => path.multiplier === pathMultiplier + 1);
    const fullyCompleted = allSummaries.every((path) => path.completed);

    setLastResult({
      childName: childName.trim() || null,
      pathMultiplier,
      completedPath: summary.completed,
      unlockedNextPath: Boolean(summary.completed && pathMultiplier < APP_CONFIG.pathCount && nextPath),
      fullyCompleted,
      totalTimeMs: Date.now() - (gameRef.current?.startedAt ?? Date.now()),
      steps: summary.steps,
      totalSteps: summary.totalSteps,
      stars: summary.stars,
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
          <p className="eyebrow">Lokalne MVP</p>
          <h1 className="heroTitle">Mistrz Mnożenia</h1>
          <p className="heroSubheading">Do 100, tabliczka 10</p>
          <p className="subtitle heroDescription">Jedna ścieżka na raz. Najpierw powtórka, potem nowe działania.</p>
        </div>

        <div className="card stack compactCard">
          <label className="field">
            <span>Imię dziecka</span>
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value.slice(0, 20))}
              placeholder="Np. Ania"
            />
          </label>
          <div className="buttonRow">
            <button className="ghostButton small" onClick={handleSaveName}>
              Zapisz imię
            </button>
            <p className="statusLine">{childName ? `Cześć, ${childName}!` : "Imię jest opcjonalne."}</p>
          </div>
        </div>

        <div className="card stack focusCard">
          <div className="sectionTitleRow">
            <div>
              <p className="eyebrow">Teraz ćwiczysz</p>
              <h2>Ścieżka {activePath.label}</h2>
            </div>
            <div className="stars" aria-label={`${activePath.stars} gwiazdki`}>
              {renderStars(activePath.stars)}
            </div>
          </div>
          <div className="progressBar largeBar" aria-hidden="true">
            <span className="progressFill" style={{ width: `${Math.round((activePath.steps / activePath.totalSteps) * 100)}%` }} />
          </div>
          <div className="progressSummaryRow">
            <p className="bigProgress">{activePath.steps}/{activePath.totalSteps}</p>
            <p className="statusLine">Opanowane {activePath.masteredFacts} z {activePath.totalFacts} działań</p>
          </div>
          <p className="pathHelp">Najpierw wrócą działania rozpoczęte wcześniej. Potem pojawią się nowe.</p>
          <button className="primaryButton" onClick={startRun}>
            {activePath.steps === 0 ? "Start" : "Kontynuuj"}
          </button>
        </div>

        <div className="card stack">
          <div className="sectionTitleRow">
            <h2>Cała droga</h2>
            <p className="statusLine">{overallSteps}/{APP_CONFIG.pathCount * APP_CONFIG.pathTotalSteps} kroków</p>
          </div>
          <div className="progressBar" aria-hidden="true">
            <span className="progressFill overallFill" style={{ width: `${Math.round((overallSteps / (APP_CONFIG.pathCount * APP_CONFIG.pathTotalSteps)) * 100)}%` }} />
          </div>
          <div className="pathList">
            {pathSummaries.map((path) => (
              <article
                key={path.multiplier}
                className={`pathRow ${path.active ? "active" : ""} ${path.completed ? "completed" : ""} ${!path.unlocked ? "locked" : ""}`}
              >
                <div className="pathMarker" aria-hidden="true">
                  {!path.unlocked ? "🔒" : path.completed ? "★" : "🚀"}
                </div>
                <div className="pathContent">
                  <div className="sectionTitleRow">
                    <p className="name">{path.label}</p>
                    <p className="rank">{path.steps}/{path.totalSteps}</p>
                  </div>
                  <div className="progressBar miniBar" aria-hidden="true">
                    <span className="progressFill" style={{ width: `${Math.round((path.steps / path.totalSteps) * 100)}%` }} />
                  </div>
                  <div className="sectionTitleRow">
                    <div className="stars compactStars" aria-hidden="true">
                      {renderStars(path.stars)}
                    </div>
                    <p className="rank">
                      {!path.unlocked ? "Odblokuje się później" : path.completed ? "Ścieżka ukończona" : path.active ? "Tu jesteś teraz" : "Odblokowana"}
                    </p>
                  </div>
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
      <section className="screen gameScreen">
        <div className="hudCard">
          <div className="hudTopRow">
            <p className="eyebrow">Ścieżka ×{game.pathMultiplier}</p>
            <p className="timer">{Math.ceil(game.remainingMs / 1000)}s</p>
          </div>
          <div className="hudMetaRow">
            <p>Zadanie {game.currentIndex + 1} z {game.queue.length}</p>
            <p>{currentTask.phase === "review" ? "Powtórka" : "Nowe działanie"}</p>
          </div>
          <div className="hudMetaRow">
            <p>Stan działania: {currentTaskStep}/3</p>
            <p>{describeStep(currentTaskStep)}</p>
          </div>
        </div>

        <button className="ghostButton small" onClick={cancelRun}>
          Wróć
        </button>

        <div className="problemCard">
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
    const nextPathLabel = lastResult.pathMultiplier < APP_CONFIG.pathCount ? `×${lastResult.pathMultiplier + 1}` : null;
    return (
      <section className="screen resultsScreen">
        <div className={`card stack celebrateCard ${lastResult.completedPath ? "successGlow" : ""}`}>
          <p className="eyebrow">Podsumowanie</p>
          <h2>
            {lastResult.fullyCompleted
              ? "Cała tabliczka opanowana!"
              : lastResult.completedPath
                ? `Ścieżka ×${lastResult.pathMultiplier} ukończona!`
                : `Dobra robota${lastResult.childName ? `, ${lastResult.childName}` : ""}!`}
          </h2>
          <p className="subtitle">Czas tej rundy: <strong>{formatMs(lastResult.totalTimeMs)}</strong></p>
          <div className="focusSummary">
            <p className="bigProgress">×{lastResult.pathMultiplier} • {lastResult.steps}/{lastResult.totalSteps}</p>
            <div className="stars" aria-hidden="true">{renderStars(lastResult.stars)}</div>
            <p className="statusLine">Opanowane {lastResult.masteredFacts} z {lastResult.totalFacts} działań</p>
          </div>
          {lastResult.completedPath && nextPathLabel ? (
            <p className="pathHelp">Odblokowano kolejną ścieżkę: {nextPathLabel}.</p>
          ) : null}
          {!lastResult.completedPath ? (
            <p className="pathHelp">Wracaj do tej ścieżki. Rozpoczęte działania pojawią się najpierw.</p>
          ) : null}
          <div className="buttonGrid singleOnMobile">
            <button className="primaryButton" onClick={startRun}>
              {lastResult.fullyCompleted ? "Jeszcze raz" : "Dalej"}
            </button>
            <button className="ghostButton" onClick={() => setScreen("home")}>
              Strona główna
            </button>
          </div>
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

function renderStars(filled: number): JSX.Element {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <span key={index} className={`star ${index < filled ? "filled" : ""}`}>
          ★
        </span>
      ))}
    </>
  );
}
