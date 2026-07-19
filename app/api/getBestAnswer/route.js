import {
    getansfromOpenAI,
    getansfromClaude,
    getansfromGemini,
    evaluateAndRefine,
} from '@/index.js';

const MAX_INPUT_LENGTH = 2000;
const VALID_MODELS = ['openai', 'claude', 'gemini'];

function validateInput(raw) {
    if (!raw || typeof raw !== 'string') return 'Question is required.';
    const trimmed = raw.trim();
    if (trimmed.length === 0) return 'Question cannot be empty.';
    if (trimmed.length < 10) return 'Question is too short (minimum 10 characters).';
    if (raw.length > MAX_INPUT_LENGTH)
        return `Question exceeds the ${MAX_INPUT_LENGTH}-character limit.`;
    // Strip null bytes and non-printable control characters (keep newlines/tabs)
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed))
        return 'Question contains invalid characters.';
    return null;
}

export async function POST(request) {
    const body = await request.json().catch(() => ({}));
    const validationError = validateInput(body.userInput);

    if (validationError) {
        return new Response(
            JSON.stringify({ error: validationError }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // Validate enabledModels
    const rawEnabled = body.enabledModels;
    let enabledModels;
    if (rawEnabled !== undefined) {
        if (!Array.isArray(rawEnabled)) {
            return new Response(
                JSON.stringify({ error: 'enabledModels must be an array.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
        enabledModels = rawEnabled.filter(m => VALID_MODELS.includes(m));
        if (enabledModels.length === 0) {
            return new Response(
                JSON.stringify({ error: 'At least one valid model must be enabled.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
    } else {
        enabledModels = [...VALID_MODELS];
    }

    const input = body.userInput.trim();
    const encoder = new TextEncoder();
    const clientSignal = request.signal;

    let overallTimer;

    const stream = new ReadableStream({
        async start(controller) {
            let closed = false;

            const send = (payload) => {
                if (closed) return;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            };

            const close = () => {
                if (closed) return;
                closed = true;
                clearTimeout(overallTimer);
                controller.close();
            };

            // Abort if the client disconnects
            clientSignal?.addEventListener('abort', () => {
                close();
            }, { once: true });

            // Hard ceiling: close the stream after 120s regardless
            overallTimer = setTimeout(() => {
                send({ type: 'error', error: 'Request timed out. Please try again.' });
                close();
            }, 120_000);

            const answers = { openai: null, claude: null, gemini: null };

            // Map of model key → model function
            const modelFns = {
                openai: getansfromOpenAI,
                claude: getansfromClaude,
                gemini: getansfromGemini,
            };

            try {
                await Promise.allSettled(
                    enabledModels.map((key) => {
                        const onToken = (token) => send({ type: 'token', model: key, token });
                        return modelFns[key](input, onToken).then((answer) => {
                            answers[key] = answer;
                            send({ type: 'modelDone', model: key, failed: !answer });
                        });
                    })
                );

                if (closed) return;

                const hasAny = enabledModels.some(k => answers[k]);
                if (!hasAny) {
                    send({ type: 'error', error: 'All models failed to respond. Please try again.' });
                    close();
                    return;
                }

                send({ type: 'synthesizing' });

                const bestAnswer = await evaluateAndRefine(
                    input,
                    answers.openai,
                    answers.claude,
                    answers.gemini
                );

                send({ type: 'final', bestAnswer });
            } catch (err) {
                console.error('Stream error:', err.message);
                send({ type: 'error', error: 'Something went wrong. Please try again.' });
            } finally {
                close();
            }
        },
        cancel() {
            clearTimeout(overallTimer);
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        },
    });
}
