"use client";

import { useState } from "react";
import { useHistory, useTaskDetail } from "@/lib/hooks";
import { truncateId, formatDate } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

const statusColors: Record<string, string> = {
  completed: "bg-green-500/20 text-green-400",
  pending: "bg-yellow-500/20 text-yellow-400",
  failed: "bg-red-500/20 text-red-400",
  running: "bg-blue-500/20 text-blue-400",
};

export default function TaskTable() {
  const { data: tasks, error } = useHistory();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (error)
    return (
      <p className="text-sm text-red-400">Failed to load task history</p>
    );
  if (!tasks) return <p className="text-sm text-gray-500">Loading...</p>;
  if (tasks.length === 0)
    return (
      <p className="text-sm text-gray-500">No tasks yet. Submit a service request to get started.</p>
    );

  return (
    <div className="bg-surface rounded-xl border border-surface-light overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-light">
            <th className="text-left text-gray-500 font-medium px-5 py-3 w-8" />
            <th className="text-left text-gray-500 font-medium px-5 py-3">
              Task ID
            </th>
            <th className="text-left text-gray-500 font-medium px-5 py-3">
              Type
            </th>
            <th className="text-left text-gray-500 font-medium px-5 py-3">
              Status
            </th>
            <th className="text-left text-gray-500 font-medium px-5 py-3">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task: any) => (
            <TaskRow
              key={task.taskId || task.id}
              task={task}
              expanded={expandedId === (task.taskId || task.id)}
              onToggle={() =>
                setExpandedId(
                  expandedId === (task.taskId || task.id)
                    ? null
                    : task.taskId || task.id
                )
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({
  task,
  expanded,
  onToggle,
}: {
  task: any;
  expanded: boolean;
  onToggle: () => void;
}) {
  const taskId = task.taskId || task.id;
  const { data: detail } = useTaskDetail(expanded ? taskId : null);
  const status = task.status || "completed";

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-surface-light/50 hover:bg-surface-light/30 cursor-pointer transition-colors"
      >
        <td className="px-5 py-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </td>
        <td className="px-5 py-3 text-gray-300 font-mono">
          {truncateId(taskId, 12)}
        </td>
        <td className="px-5 py-3 text-gray-300 capitalize">
          {task.serviceType || task.type || "—"}
        </td>
        <td className="px-5 py-3">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              statusColors[status] || statusColors.completed
            }`}
          >
            {status}
          </span>
        </td>
        <td className="px-5 py-3 text-gray-500">
          {task.createdAt ? formatDate(task.createdAt) : "—"}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-5 py-4 bg-surface-dark">
            {detail ? (
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-gray-500">Input: </span>
                  <span className="text-sm text-gray-300">
                    {detail.inputSummary || "—"}
                  </span>
                </div>
                {detail.result && (
                  <div>
                    <span className="text-xs text-gray-500">Result: </span>
                    <pre className="text-sm text-gray-300 whitespace-pre-wrap break-words mt-1 font-mono">
                      {typeof detail.result === "string"
                        ? detail.result
                        : JSON.stringify(detail.result, null, 2)}
                    </pre>
                  </div>
                )}
                {detail.resultHash && (
                  <div>
                    <span className="text-xs text-gray-500">Hash: </span>
                    <span className="text-xs text-gray-400 font-mono">
                      {detail.resultHash}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Loading details...</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
