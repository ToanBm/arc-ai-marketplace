"use client";

import { useState } from "react";
import { useProviders } from "@/lib/hooks";
import ProviderCard from "@/components/providers/ProviderCard";
import CapabilityFilter from "@/components/providers/CapabilityFilter";

export default function ProvidersPage() {
  const [capability, setCapability] = useState("");
  const { data: providers, error } = useProviders(capability || undefined);

  return (
    <div className="space-y-6 w-full">
      <CapabilityFilter active={capability} onChange={setCapability} />

      {error ? (
        <p className="text-sm text-red-400">Failed to load providers</p>
      ) : !providers ? (
        <p className="text-sm text-gray-500">Loading providers...</p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-gray-500">
          No providers found{capability ? ` for "${capability}"` : ""}.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {providers.map((provider: any) => (
            <ProviderCard key={provider.address} provider={provider} />
          ))}
        </div>
      )}
    </div>
  );
}
