"use client";

import TaskTable from "@/components/history/TaskTable";

export default function HistoryPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Task History</h1>
        <p className="text-sm text-gray-500 mt-1">
          Recent service requests and results
        </p>
      </div>
      <TaskTable />
    </div>
  );
}
