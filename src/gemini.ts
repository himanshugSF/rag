import { ApiError, GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { HttpError } from "./middleware/index.js";

export const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

const MAX_ATTEMPTS = 4;
const isRetryable = (err: unknown) =>
  err instanceof ApiError && (err.status === 429 || err.status >= 500);

/**
 * Runs a Gemini call, retrying rate limits and 5xx ("high demand") with
 * exponential backoff: 0.5s, 1s, 2s plus jitter. If it still fails, throws a
 * 503 HttpError so clients see "try again" rather than a generic 500.
 */
export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      if (attempt === MAX_ATTEMPTS) {
        logger.error({ err, label }, "gemini call failed after retries");
        throw new HttpError(503, "model_unavailable", "The AI model is busy. Please try again shortly.");
      }
      const delay = 500 * 2 ** (attempt - 1) + Math.random() * 250;
      logger.warn({ label, attempt, status: (err as ApiError).status, delay }, "gemini call failed; retrying");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
