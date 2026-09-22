"use client";

/**
 * EL AVISO DE CITAS AGENDADAS — lo más importante de esta pantalla.
 *
 * Rafael lo pidió así: «si hay una cita ya agendada y quieren bloquear ese día
 * que les aparezca un warning de que tienen que mover esa cita primero para
 * poder bloquear».
 *
 * O sea: NO se crea el bloqueo. Esto no es un «¿seguro?» que se pueda aceptar
 * de todas formas — no hay botón de continuar, y quien lo usa deja el de
 * guardar deshabilitado mientras el aviso está en pantalla.
 *
 * 🔴 Y enseña LAS CITAS CONCRETAS, nunca «hay conflictos». Cada renglón lleva a
 * su cita en la agenda (`?date=…&highlight=<id>`): quien tiene que moverla no
 * puede quedarse buscándola a ciegas.
 */

import { AlertTriangle, ExternalLink } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { diaCorto, diaDeCita } from "./fechas";
import type { ConflictoCitas } from "./tipos";
import s from "./bloqueos.module.css";

/** Cuántas citas se listan como mucho; el resto se resume con «y N más». */
const MAX_VISIBLES = 5;

export function AvisoCitas({
  conflicto,
  timezone,
  locale,
}: {
  conflicto: ConflictoCitas;
  timezone: string;
  locale: string;
}) {
  const t = useT();
  const visibles = conflicto.citas.slice(0, MAX_VISIBLES);
  // `total` manda sobre `citas.length`: el servidor manda una muestra y el
  // total de verdad. Con 9 citas y 5 en la muestra, «y 4 más».
  const restantes = Math.max(0, conflicto.total - visibles.length);

  // El día al que lleva «Ver en la agenda»: el de la primera cita que choca,
  // que es la primera que hay que mover.
  const primerDia = visibles.length > 0 ? diaDeCita(visibles[0].fecha, timezone) : null;

  return (
    <div className={s.aviso} role="alert">
      <div className={s.avisoCabecera}>
        <AlertTriangle size={16} strokeWidth={2.2} aria-hidden className={s.avisoIcono} />
        <div>
          <p className={s.avisoTitulo}>
            {t("settings.bloqueos.avisoTitulo", { count: conflicto.total })}
          </p>
          <p className={s.avisoSub}>{t("settings.bloqueos.avisoSub")}</p>
        </div>
      </div>

      <ul className={s.avisoLista}>
        {visibles.map((c) => {
          const dia = diaDeCita(c.fecha, timezone);
          return (
            <li key={c.id}>
              <a
                className={s.avisoCita}
                href={`/dashboard/agenda?date=${encodeURIComponent(dia)}&highlight=${encodeURIComponent(c.id)}`}
              >
                <span className={s.avisoCitaCuando}>
                  {diaCorto(dia, locale)}, {c.hora}
                </span>
                <span className={s.avisoCitaQuien}>
                  {c.pacienteNombre}
                  {c.doctorNombre
                    ? ` — ${t("settings.bloqueos.avisoCon", { doctor: c.doctorNombre })}`
                    : ""}
                </span>
              </a>
            </li>
          );
        })}
        {restantes > 0 && (
          <li className={s.avisoMas}>{t("settings.bloqueos.avisoYMas", { count: restantes })}</li>
        )}
      </ul>

      {primerDia && (
        <a
          className={s.avisoEnlace}
          href={`/dashboard/agenda?date=${encodeURIComponent(primerDia)}`}
        >
          <ExternalLink size={13} strokeWidth={2.2} aria-hidden />
          {t("settings.bloqueos.avisoVerAgenda")}
        </a>
      )}
    </div>
  );
}
