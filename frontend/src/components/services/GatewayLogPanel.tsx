"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";

export type LogType = "step" | "info" | "success" | "error" | "pending";

export type LogLine = {
  id: number;
  text: string;
  type: LogType;
};

interface GatewayLogPanelProps {
  logs: LogLine[];
}

function lineColor(type: LogType): string {
  switch (type) {
    case "success": return "text-green-400";
    case "error":   return "text-red-400";
    case "pending": return "text-yellow-400";
    case "step":    return "text-cyan-300 font-semibold";
    default:        return "text-gray-400";
  }
}

export default function GatewayLogPanel({ logs }: GatewayLogPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="bg-[#0d0d0d] border border-surface-light rounded-xl flex flex-col h-full min-h-[480px]">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-light bg-surface rounded-t-xl">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500/70" />
          <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
          <span className="w-3 h-3 rounded-full bg-green-500/70" />
        </div>
        <div className="flex items-center gap-1.5 mx-auto">
          <Terminal className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs text-gray-400 font-medium">gateway — marketplace workflow</span>
        </div>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-5 space-y-0.5">
        {logs.length === 0 ? (
          <p className="text-gray-700 select-none">
            Submit a service request to see live gateway logs...
          </p>
        ) : (
          logs.map((line) => (
            <div key={line.id} className={lineColor(line.type)}>
              {line.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
