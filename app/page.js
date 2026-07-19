"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import styles from "./page.module.css";

const MODEL_LABELS = { openai: "OpenAI", claude: "Claude", gemini: "Gemini" };
const INITIAL_MODEL_STATE = { openai: "idle", claude: "idle", gemini: "idle" };
const INITIAL_ANSWERS = { openai: null, claude: null, gemini: null };
const MAX_LENGTH = 2000;
const MIN_LENGTH = 10;

export default function Home() {
  const [userInput, setUserInput] = useState("");
  const [inputError, setInputError] = useState(null);
  const [modelStatus, setModelStatus] = useState(INITIAL_MODEL_STATE);
  const [individualAnswers, setIndividualAnswers] = useState(INITIAL_ANSWERS);
  const [synthesizing, setSynthesizing] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const [started, setStarted] = useState(false);
  const [enabledModels, setEnabledModels] = useState(new Set(['openai', 'claude', 'gemini']));
  const [history, setHistory] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [currentHistoryId, setCurrentHistoryId] = useState(null);
  const lastInputRef = useRef("");

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('mma-history') || '[]');
      setHistory(stored);
    } catch {}
  }, []);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [retryAfter > 0]);

  function validateInput(value) {
    if (!value.trim()) return "Please enter a question.";
    if (value.trim().length < MIN_LENGTH) return `At least ${MIN_LENGTH} characters required.`;
    if (value.length > MAX_LENGTH) return `Exceeds ${MAX_LENGTH}-character limit.`;
    return null;
  }

  function handleInputChange(e) {
    const val = e.target.value;
    setUserInput(val);
    setInputError(val.length > 0 ? validateInput(val) : null);
  }

  function toggleModel(key) {
    setEnabledModels(prev => {
      if (prev.has(key) && prev.size === 1) return prev; // must keep at least one
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function saveToHistory(question, bestAnswer, comparisonData) {
    const entry = {
      id: Date.now(),
      question,
      title: bestAnswer?.title || question.slice(0, 60),
      timestamp: new Date().toISOString(),
      feedback: null,
      bestAnswer,
      comparison: comparisonData,
    };
    setHistory(prev => {
      const updated = [entry, ...prev].slice(0, 20);
      localStorage.setItem('mma-history', JSON.stringify(updated));
      return updated;
    });
    setCurrentHistoryId(entry.id);
  }

  function handleFeedback(type) {
    if (!currentHistoryId) return;
    const next = feedback === type ? null : type;
    setFeedback(next);
    setHistory(prev => {
      const updated = prev.map(h => h.id === currentHistoryId ? { ...h, feedback: next } : h);
      localStorage.setItem('mma-history', JSON.stringify(updated));
      return updated;
    });
  }

  function loadHistoryItem(item) {
    setUserInput(item.question);
    setAnswer(item.bestAnswer);
    setComparison(item.comparison || null);
    setFeedback(item.feedback || null);
    setCurrentHistoryId(item.id);
    setStarted(false);
    setError(null);
    setIndividualAnswers(INITIAL_ANSWERS);
    setModelStatus(INITIAL_MODEL_STATE);
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem('mma-history');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const clientError = validateInput(userInput);
    if (clientError) { setInputError(clientError); return; }
    submitWithInput(userInput, e);
  }

  function handleRetry() {
    const input = lastInputRef.current;
    if (!input || isLoading) return;
    // Restore input if cleared, then submit
    setUserInput(input);
    // Use a microtask so state flushes before handleSubmit reads userInput
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} };
      // Directly pass the stored input to avoid stale closure
      submitWithInput(input, fakeEvent);
    }, 0);
  }

  async function submitWithInput(input, e) {
    e.preventDefault?.();
    const clientError = validateInput(input);
    if (clientError || isLoading) return;

    lastInputRef.current = input;
    setStarted(true);
    setError(null);
    setRetryAfter(0);
    setAnswer(null);
    setComparison(null);
    setSynthesizing(false);
    setFeedback(null);
    setCurrentHistoryId(null);
    setIndividualAnswers(INITIAL_ANSWERS);

    // Initialize model status: enabled models → 'loading', disabled → 'idle'
    const initialStatus = {};
    for (const key of Object.keys(MODEL_LABELS)) {
      initialStatus[key] = enabledModels.has(key) ? 'loading' : 'idle';
    }
    setModelStatus(initialStatus);

    try {
      const res = await fetch("/api/getBestAnswer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: input, enabledModels: [...enabledModels] }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          const seconds = parseInt(res.headers.get("Retry-After") || "60", 10);
          setRetryAfter(seconds);
        }
        const data = await res.json();
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.type === "token") {
            const { model, token } = event;
            setIndividualAnswers(prev => ({ ...prev, [model]: (prev[model] || '') + token }));
          } else if (event.type === "modelDone") {
            const { model, failed } = event;
            setModelStatus(prev => ({ ...prev, [model]: failed ? 'error' : 'done' }));
          } else if (event.type === "synthesizing") {
            setSynthesizing(true);
          } else if (event.type === "final") {
            setSynthesizing(false);
            const bestAnswer = event.bestAnswer;
            setAnswer(bestAnswer);
            let comparisonData = null;
            if (bestAnswer?.modelComparison) {
              comparisonData = {
                models: bestAnswer.modelComparison,
                rationale: bestAnswer.synthesisRationale,
              };
              setComparison(comparisonData);
            }
            saveToHistory(input, bestAnswer, comparisonData);
            setFeedback(null);
          } else if (event.type === "error") {
            throw new Error(event.error);
          }
        }
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setModelStatus((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([k, v]) => [k, v === "loading" ? "error" : v])
        )
      );
    } finally {
      setSynthesizing(false);
    }
  }

  const isLoading =
    Object.entries(modelStatus).some(([k, v]) => enabledModels.has(k) && v === "loading") ||
    synthesizing;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Multi-Model DSA Assistant</h1>
        <p className={styles.subtitle}>
          Ask a coding question — OpenAI, Claude, and Gemini each answer, then Claude
          synthesizes the best solution.
        </p>

        {/* Model toggles */}
        <div className={styles.modelToggles}>
          <span className={styles.togglesLabel}>Models:</span>
          {Object.entries(MODEL_LABELS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.toggleBtn} ${enabledModels.has(key) ? styles.toggleBtnActive : ''}`}
              onClick={() => toggleModel(key)}
              disabled={isLoading}
              aria-pressed={enabledModels.has(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.textareaWrapper}>
            <textarea
              className={`${styles.textarea} ${inputError ? styles.textareaInvalid : ""}`}
              placeholder="e.g. Write a function to find the longest common prefix string amongst an array of strings."
              value={userInput}
              onChange={handleInputChange}
              rows={4}
              maxLength={MAX_LENGTH}
              aria-describedby="input-error"
            />
            <div className={styles.textareaFooter}>
              {inputError ? (
                <span id="input-error" className={styles.inputError}>{inputError}</span>
              ) : (
                <span />
              )}
              <span className={`${styles.charCount} ${userInput.length > MAX_LENGTH * 0.9 ? styles.charCountWarn : ""}`}>
                {userInput.length}/{MAX_LENGTH}
              </span>
            </div>
          </div>
          <button className={styles.submit} type="submit" disabled={isLoading || !!inputError}>
            {isLoading ? "Working..." : "Ask"}
          </button>
        </form>

        {error && (
          <div className={styles.errorRow}>
            <p className={styles.error}>⚠️ {error}</p>
            {retryAfter > 0 ? (
              <span className={styles.retryCountdown}>Retry in {retryAfter}s</span>
            ) : (
              <button
                className={styles.retryBtn}
                onClick={handleRetry}
                disabled={isLoading}
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* History panel */}
        {history.length > 0 && (
          <details className={styles.historyPanel}>
            <summary className={styles.historySummary}>
              History ({history.length})
            </summary>
            <div className={styles.historyBody}>
              <button className={styles.clearHistoryBtn} onClick={clearHistory}>Clear all</button>
              <ul className={styles.historyList}>
                {history.map(item => (
                  <li key={item.id} className={styles.historyItem}>
                    <button className={styles.historyItemBtn} onClick={() => loadHistoryItem(item)}>
                      <span className={styles.historyItemTitle}>{item.title}</span>
                      <span className={styles.historyItemMeta}>
                        {new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {item.feedback === 'up' && ' · 👍'}
                        {item.feedback === 'down' && ' · 👎'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}

        {started && (
          <section className={styles.individualAnswers}>
            <h2>Individual Model Responses</h2>
            <div className={styles.modelGrid}>
              {Object.entries(MODEL_LABELS)
                .filter(([key]) => enabledModels.has(key))
                .map(([key, label]) => {
                  const status = modelStatus[key];
                  const content = individualAnswers[key];
                  return (
                    <div key={key} className={styles.modelCard}>
                      <div className={styles.modelCardHeader}>
                        <h3>{label}</h3>
                        {status === "loading" && (
                          <span className={styles.spinner} aria-label="Loading" />
                        )}
                        {status === "done" && (
                          <span className={styles.badge} data-status="done">Done</span>
                        )}
                        {status === "error" && (
                          <span className={styles.badge} data-status="error">Failed</span>
                        )}
                      </div>

                      {status === "loading" && !content && (
                        <div className={styles.skeleton}>
                          <div className={styles.skeletonLine} style={{ width: "90%" }} />
                          <div className={styles.skeletonLine} style={{ width: "75%" }} />
                          <div className={styles.skeletonLine} style={{ width: "85%" }} />
                        </div>
                      )}
                      {(status === "done" || (status === "loading" && content)) && content && (
                        <div className={styles.explanation}>
                          <ReactMarkdown>{content}</ReactMarkdown>
                        </div>
                      )}
                      {status === "error" && (
                        <p className={styles.error}>No response from {label}.</p>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {synthesizing && (
          <div className={styles.synthesizing}>
            <span className={styles.spinner} aria-label="Synthesizing" />
            <span>Claude is synthesizing the best answer…</span>
          </div>
        )}

        {comparison && (
          <details className={styles.comparisonPanel}>
            <summary className={styles.comparisonSummary}>
              How Claude compared the models
            </summary>
            <div className={styles.comparisonBody}>
              <div className={styles.comparisonGrid}>
                {Object.entries(MODEL_LABELS).map(([key, label]) => (
                  comparison.models[key] && (
                    <div key={key} className={styles.comparisonCard}>
                      <h4 className={styles.comparisonCardTitle}>{label}</h4>
                      <p className={styles.comparisonCardText}>{comparison.models[key]}</p>
                    </div>
                  )
                ))}
              </div>
              {comparison.rationale && (
                <div className={styles.synthesisRationale}>
                  <strong>Synthesis rationale:</strong> {comparison.rationale}
                </div>
              )}
            </div>
          </details>
        )}

        {answer && (
          <>
            <h2 className={styles.finalHeading}>🏆 Final Best Answer</h2>
            <section className={styles.result}>
              {typeof answer === "string" ? (
                <p>{answer}</p>
              ) : (
                <>
                  <h2>{answer.title}</h2>
                  <div className={styles.explanation}>
                    <ReactMarkdown>{answer.explaination}</ReactMarkdown>
                  </div>
                  <pre className={styles.code}>
                    <code>{answer.code}</code>
                  </pre>
                  <div className={styles.complexity}>
                    <span>
                      <strong>Time:</strong> {answer.timecomplexity}
                    </span>
                    <span>
                      <strong>Space:</strong> {answer.spacecomplexity}
                    </span>
                  </div>
                </>
              )}
            </section>

            {answer && typeof answer !== 'string' && (
              <div className={styles.feedbackRow}>
                <span className={styles.feedbackLabel}>Was this helpful?</span>
                <button
                  className={`${styles.feedbackBtn} ${feedback === 'up' ? styles.feedbackBtnActive : ''}`}
                  onClick={() => handleFeedback('up')}
                  aria-label="Helpful"
                >👍</button>
                <button
                  className={`${styles.feedbackBtn} ${feedback === 'down' ? styles.feedbackBtnActive : ''}`}
                  onClick={() => handleFeedback('down')}
                  aria-label="Not helpful"
                >👎</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
