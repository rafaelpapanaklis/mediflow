"use client";

import { Loader2, Receipt } from "lucide-react";
import { Seccion } from "@/components/dashboard/configuracion-rediseno/piezas";
import { useT } from "@/i18n/i18n-provider";
import s from "./bloques.module.css";

/**
 * La ROPA nueva de la tarjeta «Facturación CFDI» que vive dentro de la
 * pestaña Suscripción (hallazgo 14). Solo vista: la petición a
 * `/api/cfdi/usage`, el cálculo del anillo y los textos siguen en
 * `cfdi-usage-card.tsx`, que la monta ÚNICAMENTE con `rediseno`.
 */

export interface ModeloCfdi {
  /** null mientras carga. */
  mes: string | null;
  usadas: number;
  incluidas: number;
  porcentaje: number;
  /** alto = ≥ 80 % del cupo; critico = excedido. */
  nivel: "alto" | "critico" | undefined;
  /** El texto de la pastilla (restantes o excedente), ya resuelto. */
  estado: string | null;
  /** «Se cobra con…», solo cuando hay excedente. */
  notaCobro: string | null;
  /** «Adeudo pendiente…», solo cuando hay adeudo. */
  deuda: string | null;
  etiquetaAnillo: string;
}

const RADIO = 34;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;

export function CfdiRediseno({ m }: { m: ModeloCfdi | null }) {
  const t = useT();

  return (
    <Seccion
      titulo={t("shell.subscriptionTab.cfdiTitle")}
      icono={<Receipt size={16} strokeWidth={1.75} aria-hidden />}
      extra={m?.mes ? <span className={s.cfdiMes}>{m.mes}</span> : undefined}
    >
      {!m ? (
        <div className={s.cargando}>
          <Loader2 size={16} className={s.girando} aria-hidden />
          {t("shell.subscriptionTab.cfdiLoading")}
        </div>
      ) : (
        <div className={s.cfdiCuerpo}>
          <div className={s.anillo}>
            <svg width={92} height={92} viewBox="0 0 92 92" role="img" aria-label={m.etiquetaAnillo}>
              <circle cx={46} cy={46} r={RADIO} fill="none" className={s.anilloPista} strokeWidth={8} />
              <circle
                cx={46}
                cy={46}
                r={RADIO}
                fill="none"
                className={s.anilloAvance}
                data-nivel={m.nivel}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={CIRCUNFERENCIA}
                strokeDashoffset={CIRCUNFERENCIA * (1 - m.porcentaje / 100)}
                transform="rotate(-90 46 46)"
              />
              <text x={46} y={43} textAnchor="middle" dominantBaseline="middle" className={s.anilloValor} data-nivel={m.nivel}>
                {m.usadas}
              </text>
              <text x={46} y={60} textAnchor="middle" dominantBaseline="middle" className={s.anilloSub}>
                / {m.incluidas}
              </text>
            </svg>
          </div>

          <div className={s.cfdiDetalle}>
            <p className={s.cfdiTexto}>{t("shell.subscriptionTab.cfdiSubtitle")}</p>
            {m.estado && (
              <div className={s.cfdiEstado} data-nivel={m.nivel}>
                {m.estado}
              </div>
            )}
            {m.notaCobro && <p className={s.cfdiNota}>{m.notaCobro}</p>}
            {m.deuda && <p className={s.cfdiDeuda}>{m.deuda}</p>}
          </div>
        </div>
      )}
    </Seccion>
  );
}
