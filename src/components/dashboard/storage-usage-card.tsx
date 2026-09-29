"use client";

import { useEffect, useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { CATEGORIAS_ALMACENAMIENTO, bytesLegibles, type ResumenAlmacenamiento } from "@/lib/storage-usage-core";
import { AlmacenamientoRediseno } from "./bloques-rediseno/almacenamiento";

/**
 * Tarjeta «Almacenamiento» (Configuración → Suscripción): «X GB de Y GB»,
 * barra, desglose y aviso al 80 % y 95 %. Datos de GET /api/storage/usage (la
 * misma función de uso que la cuota de subida y /admin). Si el endpoint falla
 * la tarjeta se oculta en vez de romper la pestaña.
 *
 * `rediseno`: la pestaña lo baja solo desde su camino nuevo; mismos datos y
 * textos, otra ropa (`bloques-rediseno/almacenamiento.tsx`).
 */
export function StorageUsageCard({ rediseno = false }: { rediseno?: boolean } = {}) {
  const t = useT();
  const [data, setData] = useState<ResumenAlmacenamiento | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/storage/usage")
      .then((r) => {
        if (!r.ok) throw new Error("usage");
        return r.json();
      })
      .then((d: ResumenAlmacenamiento) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  const aviso = !data
    ? null
    : data.nivel === "lleno"
      ? t("shell.storageCard.full")
      : data.nivel === "critico"
        ? t("shell.storageCard.critical", { percent: data.porcentaje ?? 0 })
        : data.nivel === "aviso"
          ? t("shell.storageCard.warn", { percent: data.porcentaje ?? 0 })
          : null;

  if (rediseno) return <AlmacenamientoRediseno r={data} aviso={aviso} />;

  const color =
    data?.nivel === "lleno" || data?.nivel === "critico"
      ? "var(--danger)"
      : data?.nivel === "aviso"
        ? "var(--warning)"
        : "var(--brand)";

  return (
    <section className="bg-card border border-border rounded-2xl p-6" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <HardDrive size={14} aria-hidden style={{ color: "var(--brand)" }} />
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>{t("shell.storageCard.title")}</h2>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0 }}>{t("shell.storageCard.subtitle")}</p>

      {!data ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
          <Loader2 size={16} className="animate-spin" aria-hidden style={{ margin: "0 auto 6px", display: "block" }} />
          {t("shell.storageCard.loading")}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)" }}>
              {data.tope
                ? t("shell.storageCard.usedOf", { used: bytesLegibles(data.usado), limit: bytesLegibles(data.tope) })
                : t("shell.storageCard.usedUnlimited", { used: bytesLegibles(data.usado) })}
            </span>
            {data.porcentaje !== null && <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-3)" }}>{data.porcentaje}%</span>}
          </div>
          {data.porcentaje !== null && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={data.porcentaje}
              aria-label={t("shell.storageCard.title")}
              style={{ height: 10, borderRadius: 999, background: "var(--bg-elev-2)", overflow: "hidden" }}
            >
              <div style={{ width: `${data.porcentaje}%`, height: "100%", background: color, borderRadius: 999, transition: "width .4s ease" }} />
            </div>
          )}
          {aviso && (
            <p
              role={data.nivel === "aviso" ? "status" : "alert"}
              style={{
                margin: 0,
                padding: "8px 12px",
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 600,
                background: data.nivel === "aviso" ? "var(--warning-soft)" : "var(--danger-soft)",
                color: data.nivel === "aviso" ? "var(--warning-strong, var(--warning))" : "var(--danger-strong, var(--danger))",
              }}
            >
              {aviso}
            </p>
          )}
          <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px 20px", margin: 0, padding: 0, listStyle: "none" }}>
            {CATEGORIAS_ALMACENAMIENTO.map((c) => (
              <li key={c} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
                <span>{t(`shell.storageCard.cat_${c}`)}</span>
                <strong style={{ fontWeight: 600, color: "var(--text-1)" }}>{bytesLegibles(data.desglose[c])}</strong>
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-3)" }}>{t("shell.storageCard.note")}</p>
        </>
      )}
    </section>
  );
}
