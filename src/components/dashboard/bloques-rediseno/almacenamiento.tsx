"use client";

import { HardDrive, Loader2 } from "lucide-react";
import { Seccion } from "@/components/dashboard/configuracion-rediseno/piezas";
import { useT } from "@/i18n/i18n-provider";
import { CATEGORIAS_ALMACENAMIENTO, bytesLegibles, type ResumenAlmacenamiento } from "@/lib/storage-usage-core";
import s from "./bloques.module.css";

/**
 * La ROPA nueva de la tarjeta «Almacenamiento» de Suscripción. Solo vista: la
 * petición a `/api/storage/usage` y los textos de aviso viven en
 * `storage-usage-card.tsx`, que la monta con `rediseno`.
 */
export function AlmacenamientoRediseno({ r, aviso }: { r: ResumenAlmacenamiento | null; aviso: string | null }) {
  const t = useT();
  return (
    <Seccion
      titulo={t("shell.storageCard.title")}
      subtitulo={t("shell.storageCard.subtitle")}
      icono={<HardDrive size={16} strokeWidth={1.75} aria-hidden />}
    >
      {!r ? (
        <div className={s.cargando}>
          <Loader2 size={16} className={s.girando} aria-hidden />
          {t("shell.storageCard.loading")}
        </div>
      ) : (
        <div className={s.almacCuerpo}>
          <div className={s.almacCifra}>
            <span className={s.almacUsado}>
              {r.tope
                ? t("shell.storageCard.usedOf", { used: bytesLegibles(r.usado), limit: bytesLegibles(r.tope) })
                : t("shell.storageCard.usedUnlimited", { used: bytesLegibles(r.usado) })}
            </span>
            {r.porcentaje !== null && <span className={s.almacPct}>{r.porcentaje}%</span>}
          </div>
          {r.porcentaje !== null && (
            <div
              className={s.almacBarra}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={r.porcentaje}
              aria-label={t("shell.storageCard.title")}
            >
              <div className={s.barraRelleno} data-nivel={r.nivel} style={{ width: `${r.porcentaje}%` }} />
            </div>
          )}
          {aviso && (
            <p className={s.almacAviso} data-nivel={r.nivel} role={r.nivel === "aviso" ? "status" : "alert"}>
              {aviso}
            </p>
          )}
          <ul className={s.almacLista}>
            {CATEGORIAS_ALMACENAMIENTO.map((c) => (
              <li key={c} className={s.almacFila}>
                <span>{t(`shell.storageCard.cat_${c}`)}</span>
                <strong>{bytesLegibles(r.desglose[c])}</strong>
              </li>
            ))}
          </ul>
          <p className={s.almacNota}>{t("shell.storageCard.note")}</p>
        </div>
      )}
    </Seccion>
  );
}
