"use client";

import { Suspense, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import ServiceCard from "@/components/services/ServiceCard";
import TranslationForm from "@/components/services/TranslationForm";
import SummarizationForm from "@/components/services/SummarizationForm";
import CodeReviewForm from "@/components/services/CodeReviewForm";
import OracleForm from "@/components/services/OracleForm";
import GatewayLogPanel, { LogLine, LogType } from "@/components/services/GatewayLogPanel";

import { ArrowLeft } from "lucide-react";

const serviceTypes = ["translation", "summarization", "code-review", "oracle"];

export type FormProps = {
  onLog: (text: string, type?: LogType) => void;
  onStart: () => void;
};

const formMap: Record<string, React.ComponentType<FormProps>> = {
  translation: TranslationForm,
  summarization: SummarizationForm,
  "code-review": CodeReviewForm,
  oracle: OracleForm,
};

function ServicesContent() {
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") || "";
  const [activeType, setActiveType] = useState<string>(initialType);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logCounterRef = useRef(0);

  const addLog = useCallback((text: string, type: LogType = "info") => {
    setLogs((prev) => [...prev, { id: ++logCounterRef.current, text, type }]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const FormComponent = activeType ? formMap[activeType] : null;

  return (
    <div className="flex gap-6 h-full">
      {/* Left — service selector + form (70% width) */}
      <div className={`${activeType ? "flex-[7]" : "flex-1"} min-w-0 space-y-6`}>
        {activeType ? (
          // Single Service View
          <div className="space-y-6">
            <button
              onClick={() => setActiveType("")}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-2"
            >
              <ArrowLeft size={20} />
              <span>Back to Services</span>
            </button>

            <div className="w-full sm:w-72">
              <ServiceCard
                type={activeType}
                active={true}
                onClick={() => { }} // No-op since it's the only one
              />
            </div>

            {FormComponent && <FormComponent onLog={addLog} onStart={clearLogs} />}
          </div>
        ) : (
          // Services Grid View
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {serviceTypes.map((type) => (
              <ServiceCard
                key={type}
                type={type}
                active={false}
                onClick={() => setActiveType(type)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right — gateway log panel (30% width, only show when a service is active) */}
      {activeType && (
        <div className="flex-[3] min-w-[320px] animate-in fade-in slide-in-from-right-4 duration-300">
          <GatewayLogPanel logs={logs} />
        </div>
      )}
    </div>
  );
}

export default function ServicesPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Loading...</p>}>
      <ServicesContent />
    </Suspense>
  );
}
