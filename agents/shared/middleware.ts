/**
 * Shared Express middleware for agent API servers.
 *
 * - Rate limiting: prevents abuse by limiting requests per IP
 * - API key auth: simple header-based authentication for agent-to-agent calls
 */

import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

// ── Rate Limiting ────────────────────────────────────────────────────────────

/**
 * Standard rate limiter: 30 requests per minute per IP.
 */
export const standardLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute window
  max: 30,                    // 30 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

/**
 * Strict rate limiter for oracle endpoints: 10 requests per minute per IP.
 */
export const oracleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Oracle rate limit exceeded. Max 10 requests/minute." },
});

/**
 * Service rate limiter for new service endpoints: 10 requests per minute per IP.
 */
export const serviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Service rate limit exceeded. Max 10 requests/minute." },
});

// ── API Key Authentication ───────────────────────────────────────────────────

const API_KEYS = new Set<string>(
  (process.env.AGENT_API_KEYS || "").split(",").filter(Boolean)
);

/**
 * API key authentication middleware.
 * Checks the `X-API-Key` header against allowed keys.
 * If no API keys are configured (AGENT_API_KEYS is empty), auth is disabled.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // If no keys configured, skip auth (development mode)
  if (API_KEYS.size === 0) {
    next();
    return;
  }

  const key = req.headers["x-api-key"] as string | undefined;
  if (!key || !API_KEYS.has(key)) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  next();
}

/**
 * Request logging middleware.
 */
export function requestLogger(agentName: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ts = new Date().toISOString();
    console.log(`[${agentName}] ${ts} ${req.method} ${req.path} from ${req.ip}`);
    next();
  };
}
