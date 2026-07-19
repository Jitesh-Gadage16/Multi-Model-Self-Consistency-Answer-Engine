# Multi-Model Answer Synthesizer

Sends a single question to three different LLMs in parallel, then uses one of them as a judge to compare the answers and synthesize a single best response.

## How it works

1. The same prompt is sent to **OpenAI, Claude, and Gemini** at the same time (`Promise.allSettled`, so one failure doesn't block the others).
2. Each model's raw answer is collected. Any model that fails or times out (30s per call) is skipped rather than crashing the run.
3. All three answers are handed to **Claude** as an evaluator/judge (`evaluateAndRefine` in [index.js](index.js)). Claude scores what each model got right or missed, then produces one synthesized answer with a structured Zod schema: title, plain-English explanation, code, time/space complexity, per-model comparison, and a synthesis rationale.
4. If the judge call itself fails, the flow falls back to returning whichever raw model answer succeeded first.

This is a **cross-model consistency check**, not classic same-model self-consistency (multiple samples from one model + majority vote). Here, agreement/disagreement is checked *across different models* (OpenAI vs Claude vs Gemini), and Claude arbitrates and merges the best parts of each into a final answer — closer to an LLM-as-judge ensemble than temperature-sampled voting.

## CLI or UI?

Both — the core logic in `index.js` is shared by two front ends:

- **UI (primary)**: a Next.js app in [app/](app). [app/page.js](app/page.js) is a chat-style page that streams tokens live from each model via Server-Sent Events ([app/api/getBestAnswer/route.js](app/api/getBestAnswer/route.js)), shows per-model status, lets you toggle which models run, and keeps a local history in `localStorage`.
  ```bash
  npm run dev   # http://localhost:3000
  ```
- **CLI**: running `index.js` directly executes one hardcoded example query end-to-end and logs the result to the console.
  ```bash
  node index.js
  ```
- **Standalone API**: [server.js](server.js) exposes the same logic as a plain Express endpoint (`POST /api/getBestAnswer`) on port 4000, independent of Next.js.

## Models / providers used

| Provider | Model | Role |
|---|---|---|
| OpenAI | `gpt-4o-mini` | Contestant |
| Anthropic | `claude-opus-4-8` | Contestant **and** judge/synthesizer |
| Google | `gemini-2.5-flash` | Contestant |

API keys are read from `.env`: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.

## Self-consistency / synthesis flow

```
            ┌─────────────┐
   prompt → │  OpenAI     │──┐
            ├─────────────┤  │
   prompt → │  Claude     │──┼──► evaluateAndRefine (Claude judge)
            ├─────────────┤  │        │
   prompt → │  Gemini     │──┘        ▼
            └─────────────┘   structured final answer
                               (title, explanation, code,
                                complexity, model comparison,
                                synthesis rationale)
```

- All three calls run **concurrently**, not sequentially.
- `evaluateAndRefine` doesn't just pick a winner — it explicitly writes a `modelComparison` (strengths/gaps per model) and a `synthesisRationale` (which pieces of which answer were kept), so the "voting" is visible/explainable rather than a black-box pick.
- The UI layer streams intermediate tokens from all three models live, then shows a "synthesizing…" state while Claude produces the final merged answer, so the user sees the raw disagreement before the reconciled result.
- Rate limiting (`proxy.js`, 5 requests/minute per IP) and a 120s hard timeout on the whole flow guard the UI route.
