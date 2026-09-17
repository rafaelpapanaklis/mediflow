"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import s from "./bloques.module.css";

/**
 * La ROPA nueva del aviso de cupo de IA de «Hoy» (hallazgo 14). Solo vista:
 * cuándo se pinta (admin, plan con cupo, ≥ 80 %), el estado «agotado» y el
 * descarte por sesión siguen decidiéndose en `ai-quota-banner.tsx`, que la
 * monta ÚNICAMENTE con `rediseno`. Mismos textos, mismo destino
 * (`/dashboard/settings?tab=ia`), mismo botón de cerrar.
 */
export function AvisoCupoIaRediseno({
  agotado,
  porcentaje,
  onDescartar,
}: {
  agotado: boolean;
  porcentaje: number;
  onDescartar: () => void;
}) {
  const t = useT();

  return (
    <div role={agotado ? "alert" : "status"} className={s.aviso} data-tono={agotado ? "peligro" : "alerta"}>
      <span className={s.iconoCaja} data-tono={agotado ? "peligro" : "alerta"}>
        <AlertTriangle size={15} strokeWidth={1.75} aria-hidden />
      </span>

      <div className={s.avisoTextos}>
        <p className={s.avisoTitulo}>
          {agotado
            ? t("shell.aiQuotaBanner.fullTitle")
            : t("shell.aiQuotaBanner.warnTitle", { percent: porcentaje })}
        </p>
        <p className={s.avisoCuerpo}>
          {agotado ? t("shell.aiQuotaBanner.fullBody") : t("shell.aiQuotaBanner.warnBody")}
        </p>
      </div>

      <div className={s.avisoAcciones}>
        <Link href="/dashboard/settings?tab=ia" className={s.avisoCta}>
          {t("shell.aiQuotaBanner.cta")}
          <ArrowRight size={13} aria-hidden />
        </Link>
        <button
          type="button"
          onClick={onDescartar}
          aria-label={t("shell.aiQuotaBanner.dismiss")}
          className={s.botonIcono}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}
