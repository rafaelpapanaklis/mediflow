"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

/**
 * Respuesta de GET /api/ai/usage. Se exporta para que las pantallas que ya la
 * piden (p. ej. el medidor de /dashboard/ai-assistant) reutilicen el tipo y le
 * pasen el snapshot al banner en vez de hacer un segundo fetch.
 */
export type AiUsageSnapshot = {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  resetAt?: string;
  isAdmin?: boolean;
  clinicId?: string;
  byFeature?: { feature: string; label: string; tokens: number; percent: number }[];
  byFeatureTotal?: number;
};

/** A partir de este % se avisa; al 100% cambia a estado agotado. */
const WARN_AT = 80;

const STORAGE_PREFIX = "mf:ai-quota-banner:";

/**
 * Aviso proactivo in-app del cupo mensual de IA. Solo ADMIN, solo si el plan
 * tiene cupo (límite 0 = plan sin IA → a esa clínica le toca el mensaje de
 * "tu plan no incluye IA", no este banner) y solo a partir del 80%.
 *
 * Descartable POR SESIÓN (sessionStorage), con clave distinta para el estado
 * "warn" y el "full": descartar el aviso del 80% no esconde el del 100%.
 *
 * Sin emails ni cron — eso queda como follow-up.
 */
export function AiQuotaBanner({ usage: usageProp }: { usage?: AiUsageSnapshot | null }) {
  const t = useT();
  const [fetched, setFetched] = useState<AiUsageSnapshot | null>(null);
  // Solo sirve para re-renderizar tras descartar; el estado real vive en
  // sessionStorage y se lee en render (seguro: el primer render devuelve null
  // por `hydrated`, así que el SSR y la hidratación coinciden).
  const [dismissTick, setDismissTick] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const usage = usageProp ?? fetched;
  const selfFetch = usageProp === undefined;

  // Solo pide los datos si nadie se los pasó ya.
  useEffect(() => {
    if (!selfFetch) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/ai/usage");
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setFetched(data);
      } catch {
        /* silencioso: es un aviso, no una función crítica */
      }
    })();
    return () => {
      alive = false;
    };
  }, [selfFetch]);

  // Nada se pinta hasta después de hidratar: así el HTML del servidor y el del
  // cliente coinciden aunque sessionStorage diga que ya se descartó.
  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated || !usage) return null;
  if (!usage.isAdmin) return null;
  // Plan sin IA (límite 0): no es un problema de cupo, es de plan.
  if (!usage.limit || usage.limit <= 0) return null;

  const percent = usage.percent ?? 0;
  if (percent < WARN_AT) return null;

  // "Agotado" SOLO cuando de verdad no quedan tokens. `percent` va redondeado,
  // así que 49,800/50,000 da 100% con 200 tokens todavía disponibles: usarlo
  // aquí anunciaba "se agotó tu cupo" mientras el medidor de al lado decía
  // "200 restantes" y el asistente seguía respondiendo.
  const state: "warn" | "full" = usage.remaining <= 0 ? "full" : "warn";
  // Clave por clínica: cambiar de sede en la misma pestaña no debe heredar el
  // "descartado" de la anterior (mismo criterio que onboarding-checklist).
  const storageKey = STORAGE_PREFIX + (usage.clinicId || "self") + ":" + state;

  let isDismissed = false;
  try {
    isDismissed = window.sessionStorage.getItem(storageKey) === "1";
  } catch {
    /* incógnito: se muestra */
  }
  if (isDismissed) return null;

  function dismiss() {
    try {
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      /* noop */
    }
    setDismissTick(dismissTick + 1);
  }

  const isFull = state === "full";
  const accent = isFull ? "var(--danger)" : "var(--warning)";
  const accentStrong = isFull ? "var(--danger-strong)" : "var(--warning-strong)";
  const bg = isFull ? "var(--danger-soft)" : "var(--warning-soft)";
  const borderColor = isFull ? "var(--danger-border-strong)" : "var(--warning-border-strong)";

  return (
    <div
      role={isFull ? "alert" : "status"}
      className="flex flex-wrap items-start gap-3 mb-4"
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--radius)",
        padding: 14,
      }}
    >
      <AlertTriangle
        size={18}
        strokeWidth={2}
        aria-hidden
        style={{ color: accent, flexShrink: 0, marginTop: 2 }}
      />

      <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
        <div className="text-sm font-semibold" style={{ color: accentStrong }}>
          {isFull
            ? t("shell.aiQuotaBanner.fullTitle")
            : t("shell.aiQuotaBanner.warnTitle", { percent })}
        </div>
        <div className="text-sm mt-0.5" style={{ color: "var(--text-2)" }}>
          {isFull ? t("shell.aiQuotaBanner.fullBody") : t("shell.aiQuotaBanner.warnBody")}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Link
          href="/dashboard/settings?tab=ia"
          className="text-sm font-semibold inline-flex items-center gap-1 rounded-md px-2.5 py-1.5"
          style={{ color: accentStrong }}
        >
          {t("shell.aiQuotaBanner.cta")}
          <ArrowRight size={14} aria-hidden />
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("shell.aiQuotaBanner.dismiss")}
          className="rounded-md p-1.5 hover:opacity-70 transition-opacity"
          style={{ color: "var(--text-3)" }}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export default AiQuotaBanner;
