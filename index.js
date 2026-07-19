import 'dotenv/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';


const finalansSchema = z.object({
    title: z.string().describe('Give one line title for the answer'),
    explaination: z.string().describe(
        'Explain the solution as well-structured Markdown: a short intro paragraph, ' +
        'then a numbered Markdown list (one point per line, e.g. "1. ..." through "10. ...") ' +
        'with a blank line between the intro and the list. No code blocks here — plain English only.'
    ),
    code: z.string().describe('Code for the answer use javascript language and provide code block in markdown format'),
    timecomplexity: z.string().describe('Time complexity of the code'),
    spacecomplexity: z.string().describe('Space complexity of the code'),
    modelComparison: z.object({
        openai: z.string().describe('2-3 sentences: what OpenAI got right, what was missing or suboptimal'),
        claude: z.string().describe('2-3 sentences: what Claude got right, what was missing or suboptimal'),
        gemini: z.string().describe('2-3 sentences: what Gemini got right, what was missing or suboptimal'),
    }).describe('Per-model quality assessment'),
    synthesisRationale: z.string().describe(
        '1-2 sentences explaining which specific elements were taken from each model to form the final answer'
    ),
});

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
            ms
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Initialize Clients
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); // Standardized env name
const geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. OpenAI Implementation
export async function getansfromOpenAI(input, onToken) {
    try {
        if (onToken) {
            // Streaming path
            const controller = new AbortController();
            const abortTimer = setTimeout(() => controller.abort(), 30_000);
            let accumulated = '';
            try {
                const stream = await openaiClient.chat.completions.create(
                    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: input }], stream: true },
                    { signal: controller.signal }
                );
                for await (const chunk of stream) {
                    const token = chunk.choices[0]?.delta?.content || '';
                    if (token) { onToken(token); accumulated += token; }
                }
            } finally {
                clearTimeout(abortTimer);
            }
            console.log("✅ OpenAI Complete (streaming)");
            return accumulated || null;
        } else {
            // Non-streaming path (unchanged)
            const response = await withTimeout(
                openaiClient.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: input }],
                }),
                30_000,
                'OpenAI'
            );
            const text = response.choices[0].message.content;
            console.log("✅ OpenAI Complete");
            return text;
        }
    } catch (error) {
        console.error("❌ OpenAI Failed:", error.message);
        return null;
    }
}

// 2. Claude Implementation
export async function getansfromClaude(input, onToken) {
    try {
        if (onToken) {
            // Streaming path
            const stream = claudeClient.messages.stream({
                model: 'claude-opus-4-8',
                max_tokens: 2048,
                messages: [{ role: 'user', content: input }],
            });
            const abortTimer = setTimeout(() => stream.abort(), 30_000);
            let accumulated = '';
            try {
                stream.on('text', (text) => { onToken(text); accumulated += text; });
                await stream.done();
            } finally {
                clearTimeout(abortTimer);
            }
            console.log("✅ Claude Complete (streaming)");
            return accumulated || null;
        } else {
            // Non-streaming path (unchanged)
            const response = await withTimeout(
                claudeClient.messages.create({
                    model: 'claude-opus-4-8',
                    max_tokens: 2048,
                    messages: [{ role: 'user', content: input }],
                }),
                30_000,
                'Claude'
            );
            const text = response.content[0].text;
            console.log("✅ Claude Complete");
            return text;
        }
    } catch (error) {
        console.error("❌ Claude Failed:", error.message);
        return null;
    }
}


// 3. Gemini Implementation (Fixed parameters)
export async function getansfromGemini(input, onToken) {
    try {
        if (onToken) {
            // Streaming path
            const responseStream = await geminiClient.models.generateContentStream({
                model: 'gemini-2.5-flash',
                contents: input,
            });
            let accumulated = '';
            for await (const chunk of responseStream) {
                const token = chunk.text || '';
                if (token) {
                    onToken(token);
                    accumulated += token;
                }
            }
            console.log("✅ Gemini Complete (streaming)");
            return accumulated || null;
        } else {
            // Non-streaming path (unchanged)
            const response = await withTimeout(
                geminiClient.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: input,
                }),
                30_000,
                'Gemini'
            );
            const text = response.text;
            console.log("✅ Gemini Complete");
            return text;
        }
    } catch (error) {
        console.error("❌ Gemini Failed:", error.message);
        return null;
    }
}

// 4. Claude Voting & Synthesis Mechanism
export async function evaluateAndRefine(userInput, openaiAns, claudeAns, geminiAns) {
    console.log("\n🤖 Claude is now evaluating answers and generating final instructions...");

    const evaluationPrompt = `
    You are an expert DSA/LeetCode interviewer and code reviewer.
    Review the following answers generated by three different AI models for this user query: "${userInput}"

    --- Model A (OpenAI) ---
    ${openaiAns || "Failed to generate an answer."}

    --- Model B (Claude) ---
    ${claudeAns || "Failed to generate an answer."}

    --- Model C (Gemini) ---
    ${geminiAns || "Failed to generate an answer."}
    ---

    Your output must include:

    1. modelComparison — For each model write 2-3 sentences assessing: what it got right (correct algorithm, edge-case handling, clarity), and what was missing, wrong, or suboptimal (inefficient approach, missing edge cases, poor explanation).

    2. synthesisRationale — 1-2 sentences explaining which specific elements you took from each model to build the final answer.

    3. title — A concise one-line title for the solution.

    4. explaination — Explain the solution in 10 simple points, no code, plain English only. Format as Markdown: a short intro paragraph, a blank line, then a numbered list ("1. ..." through "10. ...") with one point per line.

    5. code — The best-practice JavaScript implementation in a Markdown code block.

    6. timecomplexity and spacecomplexity — Big-O notation with a brief justification.
    `;

    try {
        const response = await withTimeout(
            claudeClient.messages.parse({
                model: 'claude-opus-4-8',
                max_tokens: 4096,
                messages: [{ role: 'user', content: evaluationPrompt }],
                output_config: { format: zodOutputFormat(finalansSchema) },
            }),
            60_000,
            'Synthesis'
        );
        return response.parsed_output;
    } catch (error) {
        console.error("❌ Voting/Synthesis Phase Failed:", error.message);
        return openaiAns || geminiAns || claudeAns || "All models failed to respond.";
    }
}

// Core Multi-Model Runner
export async function getBestAnswer(input) {
    console.log(`🚀 Querying models asynchronously for: "${input}"\n`);

    // Promise.allSettled ensures if one fails, the others still resolve successfully
    const results = await Promise.allSettled([
        getansfromOpenAI(input),
        getansfromClaude(input),
        getansfromGemini(input),
    ]);

    // Extract values safely, defaulting to null if rejected
    const openAIAnswer = results[0].status === 'fulfilled' ? results[0].value : null;
    const claudeAnswer = results[1].status === 'fulfilled' ? results[1].value : null;
    const geminiAnswer = results[2].status === 'fulfilled' ? results[2].value : null;

    // Check if we have at least one usable answer
    if (!openAIAnswer && !claudeAnswer && !geminiAnswer) {
        throw new Error("Critical Fallback: All three LLM engines failed to respond.");
    }

    // Pass the initial answers to Claude to execute your dual-phase synthesis architecture
    // evaluateAndRefine already returns schema-validated output on success, or a plain
    // string fallback if the synthesis call failed — don't re-parse either case.
    const finalAnswer = await evaluateAndRefine(input, openAIAnswer, claudeAnswer, geminiAnswer);

    console.log("\n================ 🏆 FINAL REFINED ANSWER ================");
    console.log(finalAnswer);
    console.log("=========================================================");

    return {
        individualAnswers: {
            openai: openAIAnswer,
            claude: claudeAnswer,
            gemini: geminiAnswer,
        },
        bestAnswer: finalAnswer,
    };
}


// Execution Loop — only runs when this file is executed directly (e.g. `node index.js`),
// not when it's imported by server.js or other modules.
if (import.meta.url === `file://${process.argv[1]}`) {
    const userInput = "Write a function to find the longest common prefix string amongst an array of strings. Include time complexity.";
    try {
        const { bestAnswer } = await getBestAnswer(userInput);
        console.log("\n================ 🏆 FINAL REFINED ANSWER ================");
        console.log(bestAnswer);
        console.log("=========================================================");
    } catch (error) {
        console.error("Application Execution Error:", error.message);
    }
}
