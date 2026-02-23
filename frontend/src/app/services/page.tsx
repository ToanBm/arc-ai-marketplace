"use client";

import { Suspense, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import ServiceCard from "@/components/services/ServiceCard";
import TranslationForm from "@/components/services/TranslationForm";
import SummarizationForm from "@/components/services/SummarizationForm";
import CodeReviewForm from "@/components/services/CodeReviewForm";
import OracleForm from "@/components/services/OracleForm";
import GatewayLogPanel, { LogLine, LogType } from "@/components/services/GatewayLogPanel";

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

let logCounter = 0;

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
    <div className="flex gap-5 h-full">
      {/* Left — service selector + form */}
      <div className="flex-1 min-w-0 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Services</h1>
          <p className="text-sm text-gray-500 mt-1">Submit AI agent service requests</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {serviceTypes.map((type) => (
            <ServiceCard
              key={type}
              type={type}
              active={activeType === type}
              onClick={() => setActiveType(activeType === type ? "" : type)}
            />
          ))}
        </div>

        {FormComponent && <FormComponent onLog={addLog} onStart={clearLogs} />}
      </div>

      {/* Right — gateway log panel */}
      <div className="w-80 flex-shrink-0">
        <GatewayLogPanel logs={logs} />
      </div>
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
