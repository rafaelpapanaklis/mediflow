// src/components/dashboard/home/parts/admin-period-toggle.tsx
"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { AdminPeriod } from "@/lib/home/types";

const PERIODS: Array<{ value: AdminPeriod; label: string }> = [
  { value: "day",     label: "Hoy" },
  { value: "month",   label: "Mes" },
  { value: "quarter", label: "Trimestre" },
  { value: "year",    label: "Año" },
];

export function AdminPeriodToggle({ value }: { value: AdminPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setPeriod = (p: AdminPeriod) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", p);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div
      role="tablist"
      aria-label="Período del resumen"
      className="segment-new"
    >
      {PERIODS.map((p) => {
        const active = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`segment-new__btn ${active ? "segment-new__btn--active" : ""}`}
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
