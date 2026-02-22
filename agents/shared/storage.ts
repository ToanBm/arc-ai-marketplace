/**
 * Persistent Storage Module
 *
 * SQLite-backed storage for agent oracle results, task records, and payment proofs.
 * Replaces the in-memory Map caches used previously.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.AGENT_DB_PATH || path.join(__dirname, "..", "data", "agent.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    // Ensure the data directory exists
    const dir = path.dirname(DB_PATH);
    require("fs").mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initTables(db);
  }
  return db;
}

function initTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS oracle_results (
      task_id     TEXT PRIMARY KEY,
      pair        TEXT NOT NULL,
      result_json TEXT NOT NULL,
      result_hash TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS task_records (
      task_id     TEXT PRIMARY KEY,
      requester   TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      pair        TEXT,
      payment_tx  TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS payment_proofs (
      task_id   TEXT PRIMARY KEY,
      tx_hash   TEXT NOT NULL,
      payer     TEXT NOT NULL,
      amount    TEXT,
      verified  INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS service_results (
      task_id       TEXT PRIMARY KEY,
      service_type  TEXT NOT NULL,
      input_summary TEXT NOT NULL,
      result_json   TEXT NOT NULL,
      result_hash   TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_oracle_pair ON oracle_results(pair);
    CREATE INDEX IF NOT EXISTS idx_task_status ON task_records(status);
    CREATE INDEX IF NOT EXISTS idx_service_type ON service_results(service_type);
  `);
}

// ── Oracle Results ───────────────────────────────────────────────────────────

export function saveOracleResult(taskId: string, pair: string, resultJson: string, resultHash?: string): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO oracle_results (task_id, pair, result_json, result_hash)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(taskId, pair, resultJson, resultHash || null);
}

export function getOracleResult(taskId: string): { taskId: string; pair: string; resultJson: string; resultHash: string | null } | null {
  const stmt = getDb().prepare("SELECT task_id, pair, result_json, result_hash FROM oracle_results WHERE task_id = ?");
  const row = stmt.get(taskId) as any;
  if (!row) return null;
  return { taskId: row.task_id, pair: row.pair, resultJson: row.result_json, resultHash: row.result_hash };
}

export function deleteOracleResult(taskId: string): void {
  getDb().prepare("DELETE FROM oracle_results WHERE task_id = ?").run(taskId);
}

// ── Task Records ─────────────────────────────────────────────────────────────

export function saveTaskRecord(taskId: string, requester: string, pair: string): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO task_records (task_id, requester, pair)
    VALUES (?, ?, ?)
  `);
  stmt.run(taskId, requester, pair);
}

export function updateTaskStatus(taskId: string, status: string): void {
  getDb().prepare("UPDATE task_records SET status = ?, completed_at = unixepoch() WHERE task_id = ?").run(status, taskId);
}

export function getTaskRecord(taskId: string): { taskId: string; requester: string; status: string; pair: string } | null {
  const row = getDb().prepare("SELECT task_id, requester, status, pair FROM task_records WHERE task_id = ?").get(taskId) as any;
  if (!row) return null;
  return { taskId: row.task_id, requester: row.requester, status: row.status, pair: row.pair };
}

export function getRecentTasks(limit: number = 50): any[] {
  return getDb().prepare("SELECT * FROM task_records ORDER BY created_at DESC LIMIT ?").all(limit);
}

// ── Payment Proofs ───────────────────────────────────────────────────────────

export function savePaymentProof(taskId: string, txHash: string, payer: string, amount?: string): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO payment_proofs (task_id, tx_hash, payer, amount)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(taskId, txHash, payer, amount || null);
}

export function markPaymentVerified(taskId: string): void {
  getDb().prepare("UPDATE payment_proofs SET verified = 1 WHERE task_id = ?").run(taskId);
}

export function getPaymentProof(taskId: string): { taskId: string; txHash: string; payer: string; verified: boolean } | null {
  const row = getDb().prepare("SELECT task_id, tx_hash, payer, verified FROM payment_proofs WHERE task_id = ?").get(taskId) as any;
  if (!row) return null;
  return { taskId: row.task_id, txHash: row.tx_hash, payer: row.payer, verified: !!row.verified };
}

// ── Service Results ──────────────────────────────────────────────────────────

export function saveServiceResult(taskId: string, serviceType: string, inputSummary: string, resultJson: string, resultHash?: string): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO service_results (task_id, service_type, input_summary, result_json, result_hash)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(taskId, serviceType, inputSummary, resultJson, resultHash || null);
}

export function getServiceResult(taskId: string): { taskId: string; serviceType: string; inputSummary: string; resultJson: string; resultHash: string | null } | null {
  const stmt = getDb().prepare("SELECT task_id, service_type, input_summary, result_json, result_hash FROM service_results WHERE task_id = ?");
  const row = stmt.get(taskId) as any;
  if (!row) return null;
  return { taskId: row.task_id, serviceType: row.service_type, inputSummary: row.input_summary, resultJson: row.result_json, resultHash: row.result_hash };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getStats(): { totalTasks: number; completedTasks: number; totalOracle: number; totalServiceResults: number } {
  const d = getDb();
  const totalTasks = (d.prepare("SELECT COUNT(*) as c FROM task_records").get() as any).c;
  const completedTasks = (d.prepare("SELECT COUNT(*) as c FROM task_records WHERE status = 'completed'").get() as any).c;
  const totalOracle = (d.prepare("SELECT COUNT(*) as c FROM oracle_results").get() as any).c;
  const totalServiceResults = (d.prepare("SELECT COUNT(*) as c FROM service_results").get() as any).c;
  return { totalTasks, completedTasks, totalOracle, totalServiceResults };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
