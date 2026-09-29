"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import type { ResumenAlmacenamiento } from "@/lib/storage-usage-core";
import { AvisoAlmacenamientoRediseno } from "./bloques-rediseno/aviso-almacenamiento";

const STORAGE_PREFIX = "mf:storage-quota-banner:";

/**
 * Aviso discreto del almacenamiento en «Hoy». Solo ADMIN (el endpoint responde
 * 403 a los demás y entonces no se pinta), solo con plan con tope y a partir
 * del 80 %. Descartable POR SESIÓN, con clave por nivel: descartar el aviso
 * del 80 % no esconde el del 95 % ni el de «lleno».
 */
export function StorageQuotaBanner({ rediseno = false }: { rediseno?: boolean }) {
  const t = useT();
  const [data, setData] = useState<(ResumenAlmacenamiento & { clinicId?: string }) | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/storage/usage");
        if (!res.ok) return;
        const d = await res.json();
        if (alive) setData(d);
      } catch {
        /* silencioso: es un aviso, no una función crítica */
      }
    })();
    setHydrated(true);
    return () => {
      alive = false;
    };
  }, []);

  if (!hydrated || !data || data.nivel === "ok" || data.porcentaje === null) return null;

  const nivel = data.nivel;
  const key = `${STORAGE_PREFIX}${data.clinicId || "self"}:${nivel}`;
  let descartado = false;
  try {
    descartado = window.sessionStorage.getItem(key) === "1";
  } catch {
    /* incógnito: se muestra */
  }
  if (descartado) return null;

  function descartar() {
    try {
      window.sessionStorage.setItem(key, "1");
    } catch {
      /* noop */
    }
    setTick(tick + 1);
  }

  if (rediseno) return <AvisoAlmacenamientoRediseno nivel={nivel} porcentaje={data.porcentaje} onDescartar={descartar} />;

  const grave = nivel !== "aviso";
  const clave = nivel === "lleno" ? "full" : nivel === "critico" ? "critical" : "warn";
  return (
    <div
      role={grave ? "alert" : "status"}
      className="flex flex-wrap items-start gap-3 mb-4"
      style={{
        background: grave ? "var(--danger-soft)" : "var(--warning-soft)",
        border: `1px solid ${grave ? "var(--danger-border-strong)" : "var(--warning-border-strong)"}`,
        borderRadius: "var(--radius)",
        padding: 14,
      }}
    >
      <AlertTriangle size={18} strokeWidth={2} aria-hidden style={{ color: grave ? "var(--danger)" : "var(--warning)", flexShrink: 0, marginTop: 2 }} />
      <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
        <div className="text-sm font-semibold" style={{ color: grave ? "var(--danger-strong)" : "var(--warning-strong)" }}>
          {t(`shell.storageBanner.${clave}Title`, { percent: data.porcentaje })}
        </div>
        <div className="text-sm mt-0.5" style={{ color: "var(--text-2)" }}>
          {t(`shell.storageBanner.${clave}Body`)}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Link
          href="/dashboard/settings?tab=subscription"
          className="text-sm font-semibold inline-flex items-center gap-1 rounded-md px-2.5 py-1.5"
          style={{ color: grave ? "var(--danger-strong)" : "var(--warning-strong)" }}
        >
          {t("shell.storageBanner.cta")}
          <ArrowRight size={14} aria-hidden />
        </Link>
        <button type="button" onClick={descartar} aria-label={t("shell.storageBanner.dismiss")} className="rounded-md p-1.5 hover:opacity-70 transition-opacity" style={{ color: "var(--text-3)" }}>
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
