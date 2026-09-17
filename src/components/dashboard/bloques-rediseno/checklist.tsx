"use client";

import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Rocket, X } from "lucide-react";
import { STEPS } from "@/components/dashboard/onboarding-steps";
import { useT } from "@/i18n/i18n-provider";
import s from "./bloques.module.css";

/**
 * La ROPA nueva del checklist «Primeros pasos» de «Hoy» (hallazgo 14). Es
 * solo vista: el estado (qué pasos están hechos, plegado, descartado), el
 * `localStorage` por clínica y los pasos mismos siguen viviendo en
 * `onboarding-checklist.tsx`, que la monta ÚNICAMENTE con `rediseno`.
 *
 * Mismos pasos, mismos textos, mismos destinos —con una excepción a
 * propósito: el paso «Agenda una cita» manda a `/dashboard/appointments`
 * (la agenda de siempre), y con la bandera encendida la agenda es
 * `/dashboard/agenda` (hallazgo 2, ya resuelto en `hoy-rediseno`). Aquí se
 * aplica la misma regla; la lista `STEPS` no se toca porque la lee también
 * la home de siempre.
 */

const AGENDA_VIEJA = "/dashboard/appointments";
const AGENDA_NUEVA = "/dashboard/agenda";

function destinoConBandera(href: string): string {
  return href === AGENDA_VIEJA ? AGENDA_NUEVA : href;
}

export function ChecklistRediseno({
  completados,
  porcentaje,
  plegado,
  onPlegar,
  onDescartar,
}: {
  completados: Set<string>;
  porcentaje: number;
  plegado: boolean;
  onPlegar: () => void;
  onDescartar: () => void;
}) {
  const t = useT();

  return (
    <section className={s.checklist} aria-label={t("shell.onboardingChecklist.title")}>
      <header className={s.checklistCabeza}>
        <span className={s.iconoCaja}>
          <Rocket size={15} strokeWidth={1.75} aria-hidden />
        </span>
        <div className={s.checklistTextos}>
          <h2 className={s.checklistTitulo}>{t("shell.onboardingChecklist.title")}</h2>
          <p className={s.checklistSub}>
            {t("shell.onboardingChecklist.completedCount", { done: completados.size, total: STEPS.length })}
          </p>
        </div>
        <div className={s.checklistAcciones}>
          <button type="button" onClick={onPlegar} className={s.botonIcono} aria-expanded={!plegado}>
            {plegado ? <ChevronDown size={15} aria-hidden /> : <ChevronUp size={15} aria-hidden />}
          </button>
          <button type="button" onClick={onDescartar} className={s.botonIcono}>
            <X size={15} aria-hidden />
          </button>
        </div>
      </header>

      <div className={s.checklistBarra}>
        <div className={s.barra}>
          <div className={s.barraRelleno} style={{ width: `${porcentaje}%` }} />
        </div>
      </div>

      {!plegado && (
        <div className={s.pasos}>
          {STEPS.map((paso) => {
            const hecho = completados.has(paso.id);
            return (
              <Link
                key={paso.id}
                href={destinoConBandera(paso.href)}
                className={`${s.paso} ${hecho ? s.pasoHecho : ""}`}
              >
                {hecho ? (
                  <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden className={`${s.pasoIcono} ${s.pasoIconoHecho}`} />
                ) : (
                  <Circle size={16} strokeWidth={1.75} aria-hidden className={s.pasoIcono} />
                )}
                <span className={s.pasoEmoji} aria-hidden>{paso.emoji}</span>
                <div className={s.pasoTextos}>
                  <div className={`${s.pasoTitulo} ${hecho ? s.pasoTachado : ""}`}>
                    {t(`shell.onboarding.${paso.id}Label`)}
                  </div>
                  {!hecho && <div className={s.pasoDesc}>{t(`shell.onboarding.${paso.id}Desc`)}</div>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
