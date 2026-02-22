"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import ServiceCard from "@/components/services/ServiceCard";
import TranslationForm from "@/components/services/TranslationForm";
import SummarizationForm from "@/components/services/SummarizationForm";
import CodeReviewForm from "@/components/services/CodeReviewForm";

const serviceTypes = ["translation", "summarization", "code-review"];

const formMap: Record<string, React.ComponentType> = {
  translation: TranslationForm,
  summarization: SummarizationForm,
  "code-review": CodeReviewForm,
};

function ServicesContent() {
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") || "";
  const [activeType, setActiveType] = useState<string>(initialType);

  const FormComponent = activeType ? formMap[activeType] : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Services</h1>
        <p className="text-sm text-gray-500 mt-1">
          Submit AI agent service requests
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {serviceTypes.map((type) => (
          <ServiceCard
            key={type}
            type={type}
            active={activeType === type}
            onClick={() =>
              setActiveType(activeType === type ? "" : type)
            }
          />
        ))}
      </div>

      {FormComponent && <FormComponent />}
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
