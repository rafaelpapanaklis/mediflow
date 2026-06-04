// src/components/dashboard/home/parts/admin-period-toggle.tsx
"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useT } from "@/i18n/i18n-provider";
import type { AdminPeriod } from "@/lib/home/types";

const PERIODS: Array<{ value: AdminPeriod; labelKey: string }> = [
  { value: "day",     labelKey: "home.adminPeriod.day" },
  { value: "month",   labelKey: "home.adminPeriod.month" },
  { value: "quarter", labelKey: "home.adminPeriod.quarter" },
  { value: "year",    labelKey: "home.adminPeriod.year" },
];

export function AdminPeriodToggle({ value }: { value: AdminPeriod }) {
  const t = useT();
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
      aria-label={t("home.adminPeriod.ariaLabel")}
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
            {t(p.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
