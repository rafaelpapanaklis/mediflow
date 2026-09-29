"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import type { NivelAlmacenamiento } from "@/lib/storage-usage-core";
import s from "./bloques.module.css";

/**
 * La ROPA nueva del aviso de almacenamiento de «Hoy». Solo vista: cuándo sale
 * (admin, plan con tope, ≥ 80 %) y el descarte por sesión se deciden en
 * `storage-quota-banner.tsx`.
 */
export function AvisoAlmacenamientoRediseno({
  nivel,
  porcentaje,
  onDescartar,
}: {
  nivel: Exclude<NivelAlmacenamiento, "ok">;
  porcentaje: number;
  onDescartar: () => void;
}) {
  const t = useT();
  const grave = nivel !== "aviso";
  const clave = nivel === "lleno" ? "full" : nivel === "critico" ? "critical" : "warn";
  return (
    <div role={grave ? "alert" : "status"} className={s.aviso} data-tono={grave ? "peligro" : "alerta"}>
      <span className={s.iconoCaja} data-tono={grave ? "peligro" : "alerta"}>
        <AlertTriangle size={15} strokeWidth={1.75} aria-hidden />
      </span>
      <div className={s.avisoTextos}>
        <p className={s.avisoTitulo}>{t(`shell.storageBanner.${clave}Title`, { percent: porcentaje })}</p>
        <p className={s.avisoCuerpo}>{t(`shell.storageBanner.${clave}Body`)}</p>
      </div>
      <div className={s.avisoAcciones}>
        <Link href="/dashboard/settings?tab=subscription" className={s.avisoCta}>
          {t("shell.storageBanner.cta")}
          <ArrowRight size={13} aria-hidden />
        </Link>
        <button type="button" onClick={onDescartar} aria-label={t("shell.storageBanner.dismiss")} className={s.botonIcono}>
          <X size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}
