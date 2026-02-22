/**
 * PM2 Ecosystem Config — ARC-8004 AI Agent Economy
 *
 * Usage:
 *   pm2 start ecosystem.config.js        # Start all agents
 *   pm2 stop ecosystem.config.js         # Stop all
 *   pm2 restart ecosystem.config.js      # Restart all
 *   pm2 logs                             # Stream all logs
 *   pm2 monit                            # Process monitor
 *   pm2 save && pm2 startup              # Persist across reboots
 *
 * Agents A and Marketplace client are NOT included here — they are
 * invoked on-demand by the gateway as imported modules, not long-running servers.
 *
 * Startup order (dependency-safe):
 *   1. Agent B, C, D, E, F, G, H, I  — register themselves, listen for requests
 *   2. Gateway                         — health-checks agents, routes user requests
 */

const TS_NODE = "./node_modules/.bin/ts-node";

/** Shared defaults for all ts-node processes */
const defaults = {
  interpreter: "none",           // use ts-node as the script itself
  watch: false,
  autorestart: true,
  max_restarts: 10,
  min_uptime: "10s",
  restart_delay: 3000,
  max_memory_restart: "512M",
  env: {
    NODE_ENV: "production",
    TS_NODE_TRANSPILE_ONLY: "true",  // skip type-checking at runtime (use `npm run build` for CI)
  },
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
};

module.exports = {
  apps: [

    // ── Oracle Providers ──────────────────────────────────────────────────

    {
      ...defaults,
      name: "agent-b",
      script: TS_NODE,
      args: "agents/agentB/server.ts",
      error_file: "logs/agent-b-error.log",
      out_file:   "logs/agent-b-out.log",
    },
    {
      ...defaults,
      name: "agent-c",
      script: TS_NODE,
      args: "agents/agentC/server.ts",
      error_file: "logs/agent-c-error.log",
      out_file:   "logs/agent-c-out.log",
    },

    // ── Translation Providers ─────────────────────────────────────────────

    {
      ...defaults,
      name: "agent-d",
      script: TS_NODE,
      args: "agents/agentD/server.ts",
      error_file: "logs/agent-d-error.log",
      out_file:   "logs/agent-d-out.log",
    },
    {
      ...defaults,
      name: "agent-g",
      script: TS_NODE,
      args: "agents/agentG/server.ts",
      error_file: "logs/agent-g-error.log",
      out_file:   "logs/agent-g-out.log",
    },

    // ── Summarization Providers ───────────────────────────────────────────

    {
      ...defaults,
      name: "agent-e",
      script: TS_NODE,
      args: "agents/agentE/server.ts",
      error_file: "logs/agent-e-error.log",
      out_file:   "logs/agent-e-out.log",
    },
    {
      ...defaults,
      name: "agent-h",
      script: TS_NODE,
      args: "agents/agentH/server.ts",
      error_file: "logs/agent-h-error.log",
      out_file:   "logs/agent-h-out.log",
    },

    // ── Code Review Providers ─────────────────────────────────────────────

    {
      ...defaults,
      name: "agent-f",
      script: TS_NODE,
      args: "agents/agentF/server.ts",
      error_file: "logs/agent-f-error.log",
      out_file:   "logs/agent-f-out.log",
    },
    {
      ...defaults,
      name: "agent-i",
      script: TS_NODE,
      args: "agents/agentI/server.ts",
      error_file: "logs/agent-i-error.log",
      out_file:   "logs/agent-i-out.log",
    },

    // ── API Gateway (start last — depends on all agents above) ────────────

    {
      ...defaults,
      name: "gateway",
      script: TS_NODE,
      args: "dashboard/server.ts",
      error_file: "logs/gateway-error.log",
      out_file:   "logs/gateway-out.log",
    },

  ],
};
