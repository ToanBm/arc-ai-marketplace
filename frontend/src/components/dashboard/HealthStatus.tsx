"use client";

import { useHealth } from "@/lib/hooks";
import { Activity } from "lucide-react";

export default function HealthStatus() {
  const { data, error } = useHealth();

  const checks: Record<string, { ok: boolean; detail?: string }> =
    data?.checks ?? {};

  return (
    <div className="bg-surface rounded-xl p-5 border border-surface-light">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-accent-light" />
        <h2 className="text-lg font-semibold text-white">System Health</h2>
        {data && (
          <span
            className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
              data.healthy
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            {data.healthy ? "Healthy" : "Degraded"}
          </span>
        )}
      </div>
      {error ? (
        <p className="text-sm text-red-400">Failed to load health status</p>
      ) : Object.keys(checks).length === 0 ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(checks).map(([name, check]) => (
            <div
              key={name}
              className="flex items-center gap-2 bg-surface-dark rounded-lg px-3 py-2"
            >
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  check.ok ? "bg-green-400" : "bg-red-400"
                }`}
              />
              <span className="text-sm text-gray-300 capitalize">{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
