"use client";

import { useState } from "react";
import { Building2, FileWarning, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import promptStyles from "./welcome-prompt.module.css";

interface ChairResource {
  id: string;
  name: string;
  color: string | null;
  orderIndex: number;
}

export function WelcomePrompt({
  onLoaded,
}: {
  onLoaded: (data: { elements: unknown[]; chairs: ChairResource[]; chairsCreated: number }) => void;
}) {
  const t = useT();
  const [loading, setLoading] = useState<"demo" | "empty" | null>(null);

  const loadDemo = async () => {
    setLoading("demo");
    try {
      const res = await fetch("/api/clinic-layout/seed-demo", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onLoaded({
        elements: (data.layout?.elements ?? []) as unknown[],
        chairs: (data.chairs ?? []) as ChairResource[],
        chairsCreated: data.created?.chairs ?? 0,
      });
      toast.success(
        data.created?.chairs
          ? t("pages.clinicLayout.welcomeDemoLoadedWithChairs", { count: data.created.chairs })
          : t("pages.clinicLayout.welcomeDemoLoaded"),
      );
    } catch {
      toast.error(t("pages.clinicLayout.welcomeDemoLoadFailed"));
    } finally {
      setLoading(null);
    }
  };

  const startEmpty = async () => {
    setLoading("empty");
    try {
      const res = await fetch("/api/clinic-layout/seed-demo", { method: "PUT" });
      if (!res.ok) throw new Error();
      onLoaded({ elements: [], chairs: [], chairsCreated: 0 });
    } catch {
      toast.error(t("pages.clinicLayout.welcomeInitFailed"));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className={promptStyles.wrap}>
      <div className={promptStyles.card}>
        <div className={promptStyles.icon}>
          <Building2 size={32} aria-hidden />
        </div>
        <h1 className={promptStyles.title}>{t("pages.clinicLayout.welcomeTitle")}</h1>
        <p className={promptStyles.subtitle}>
          {t("pages.clinicLayout.welcomeSubtitle")}
        </p>

        <div className={promptStyles.cta}>
          <button
            type="button"
            className={`${promptStyles.btn} ${promptStyles.btnPrimary}`}
            onClick={loadDemo}
            disabled={loading !== null}
          >
            <Sparkles size={14} aria-hidden />
            {loading === "demo" ? t("pages.clinicLayout.welcomeLoadingDemo") : t("pages.clinicLayout.welcomeLoadDemoBtn")}
          </button>
          <button
            type="button"
            className={promptStyles.btn}
            onClick={startEmpty}
            disabled={loading !== null}
          >
            {loading === "empty" ? t("pages.clinicLayout.welcomeStarting") : t("pages.clinicLayout.welcomeStartEmptyBtn")}
          </button>
        </div>

        <div className={promptStyles.info}>
          <FileWarning size={11} aria-hidden />
          <span>
            {t("pages.clinicLayout.welcomeInfo")}
          </span>
        </div>
      </div>
    </div>
  );
}
