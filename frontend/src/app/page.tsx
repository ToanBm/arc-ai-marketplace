"use client";

import StatsCards from "@/components/dashboard/StatsCards";
import HealthStatus from "@/components/dashboard/HealthStatus";
import QuickActions from "@/components/dashboard/QuickActions";

export default function DashboardPage() {
  return (
    <div className="space-y-6 w-full">

      <StatsCards />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HealthStatus />
        <QuickActions />
      </div>
    </div>
  );
}
