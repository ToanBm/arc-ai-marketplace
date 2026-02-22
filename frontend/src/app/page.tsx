"use client";

import StatsCards from "@/components/dashboard/StatsCards";
import HealthStatus from "@/components/dashboard/HealthStatus";
import QuickActions from "@/components/dashboard/QuickActions";

export default function DashboardPage() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          AI Agent Marketplace overview
        </p>
      </div>
      <StatsCards />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthStatus />
        <QuickActions />
      </div>
    </div>
  );
}
