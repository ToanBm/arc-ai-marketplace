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
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;

  if (error)
    return (
      <p className="text-sm text-red-400 text-center">Failed to load task history</p>
    );
  if (!tasks) return <p className="text-sm text-gray-500 text-center">Loading...</p>;
  if (tasks.length === 0)
    return (
      <p className="text-sm text-gray-500 text-center">No tasks yet. Submit a service request to get started.</p>
    );

  const totalPages = Math.ceil(tasks.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const currentTasks = tasks.slice(startIndex, startIndex + rowsPerPage);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    setExpandedId(null); // Close any expanded row when moving to new page
    // Scroll the main content area to top
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-2 w-full max-w-5xl mx-auto animate-in fade-in duration-500">
      <div className="flex justify-end items-center px-1">
        {totalPages > 1 && (
          <div className="flex items-center gap-4">
            <button
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="p-2 text-gray-500 hover:text-white disabled:opacity-20 transition-colors"
              title="Previous Page"
            >
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>

            <span className="text-sm font-medium text-gray-400">
              {currentPage} <span className="mx-1 text-gray-600">/</span> {totalPages}
            </span>

            <button
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-500 hover:text-white disabled:opacity-20 transition-colors"
              title="Next Page"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      <div className="bg-surface rounded-2xl border border-surface-light overflow-hidden shadow-xl shadow-black/20">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-surface-light bg-white/[0.03]">
              <th className="px-5 py-4 w-12" />
              <th className="text-left text-gray-500 font-semibold px-5 py-4">
                Task ID
              </th>
              <th className="text-left text-gray-500 font-semibold px-5 py-4">
                Type
              </th>
              <th className="text-center text-gray-500 font-semibold px-5 py-4">
                Status
              </th>
              <th className="text-right text-gray-500 font-semibold px-5 py-4">
                Created
              </th>
            </tr>
          </thead>
          {/* Using key={currentPage} forces React to replace the entire tbody content */}
          <tbody key={currentPage} className="divide-y divide-surface-light/30">
            {currentTasks.map((task: any) => (
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
        <td className="px-5 py-4">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </td>
        <td className="px-5 py-4 text-gray-300 font-mono">
          {truncateId(taskId, 12)}
        </td>
        <td className="px-5 py-4 text-gray-300 capitalize text-left">
          {task.serviceType || task.type || "—"}
        </td>
        <td className="px-5 py-4 text-center">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[status] || statusColors.completed
              }`}
          >
            {status}
          </span>
        </td>
        <td className="px-5 py-4 text-gray-500 text-right">
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
