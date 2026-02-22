"use client";

import { cn } from "@/lib/utils";

const capabilities = [
  { value: "", label: "All" },
  { value: "translation", label: "Translation" },
  { value: "summarization", label: "Summarization" },
  { value: "code-review", label: "Code Review" },
];

interface CapabilityFilterProps {
  active: string;
  onChange: (cap: string) => void;
}

export default function CapabilityFilter({
  active,
  onChange,
}: CapabilityFilterProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {capabilities.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={cn(
            "text-sm px-4 py-1.5 rounded-full border transition-colors font-medium",
            active === value
              ? "bg-accent border-accent text-white"
              : "bg-surface border-surface-light text-gray-400 hover:text-white hover:border-gray-500"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
