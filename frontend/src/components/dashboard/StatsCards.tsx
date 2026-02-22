"use client";

import { useStats } from "@/lib/hooks";
import { ClipboardList, CheckCircle, Eye, FileText } from "lucide-react";

const cardConfig = [
  { key: "totalTasks", label: "Total Tasks", icon: ClipboardList, color: "text-blue-400" },
  { key: "completedTasks", label: "Completed", icon: CheckCircle, color: "text-green-400" },
  { key: "oracleChecks", label: "Oracle Checks", icon: Eye, color: "text-yellow-400" },
  { key: "serviceResults", label: "Service Results", icon: FileText, color: "text-purple-400" },
];

export default function StatsCards() {
  const { data: stats, error } = useStats();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cardConfig.map(({ key, label, icon: Icon, color }) => (
        <div
          key={key}
          className="bg-surface rounded-xl p-5 border border-surface-light"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-400">{label}</span>
            <Icon className={`w-5 h-5 ${color}`} />
          </div>
          <p className="text-2xl font-bold text-white">
            {error ? "—" : stats?.[key] ?? "..."}
          </p>
        </div>
      ))}
    </div>
  );
}
