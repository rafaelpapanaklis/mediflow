"use client";

/**
 * LOS 7 DÍAS, con casilla y horas — la misma forma que el horario de la
 * clínica en Configuración (casilla · día · «09:00 a 18:00» · «Cerrado»). No
 * se rediseña lo que ya se entiende.
 *
 * Lo único que añade es el AVISO junto al día que se sale del horario de la
 * clínica: «la clínica cierra a las 18:00; esas horas no se van a ofrecer».
 * Avisa, no prohíbe — se guarda igual. Lo que sí frena el guardado es un
 * rango imposible (salida antes que entrada), que el servidor rechazaría.
 *
 * Solo pinta: el estado vive en quien lo monta (`PanelHorarioDoctor`).
 */

import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import {
  avisoFueraDeClinica,
  horaCorta,
  LLAVES_DIA,
  rangoInvalido,
  type AvisoClinica,
  type Dia,
} from "./tipos";
import s from "./horario-doctor.module.css";

export function EditorSemana({
  dias,
  clinica,
  onCambio,
  deshabilitado = false,
  idBase,
}: {
  /** Los 7 días, de lunes (0) a domingo (6). */
  dias: Dia[];
  /** El horario de la clínica, o `null` si no tiene: sin él no se avisa. */
  clinica: Dia[] | null;
  onCambio: (dayOfWeek: number, cambio: Partial<Omit<Dia, "dayOfWeek">>) => void;
  deshabilitado?: boolean;
  /** Prefijo de los `id` de los avisos: puede haber dos editores montados. */
  idBase: string;
}) {
  const t = useT();

  function textoAviso(a: AvisoClinica): string {
    if (a.tipo === "cerrada") return t("settings.horarioDoctor.avisoCerrada");
    if (a.antes && a.despues) {
      return t("settings.horarioDoctor.avisoAbreYCierra", { abre: horaCorta(a.abre), cierra: horaCorta(a.cierra) });
    }
    if (a.despues) return t("settings.horarioDoctor.avisoCierra", { hora: horaCorta(a.cierra) });
    return t("settings.horarioDoctor.avisoAbre", { hora: horaCorta(a.abre) });
  }

  return (
    <div className={s.editor}>
      {dias.map((d) => {
        const nombre = t(LLAVES_DIA[d.dayOfWeek]);
        const mal = rangoInvalido(d);
        const aviso = avisoFueraDeClinica(d, clinica);
        const idNota = `${idBase}-nota-${d.dayOfWeek}`;
        const hayNota = mal || aviso !== null;
        return (
          <div key={d.dayOfWeek} className={`${s.fila} ${d.enabled ? s.filaAbierta : ""}`}>
            <label className={s.dia}>
              <input
                type="checkbox"
                className={s.casilla}
                checked={d.enabled}
                disabled={deshabilitado}
                onChange={(e) => onCambio(d.dayOfWeek, { enabled: e.target.checked })}
              />
              <span className={s.diaNombre}>{nombre}</span>
            </label>

            <div className={s.horas}>
              {!d.enabled ? (
                <span className={s.cerrado}>{t("settings.client.hoursClosed")}</span>
              ) : (
                <>
                  <input
                    type="time"
                    className={`${s.hora} ${mal ? s.horaMal : ""}`}
                    value={d.openTime}
                    disabled={deshabilitado}
                    aria-label={t("settings.horarioDoctor.entradaAria", { dia: nombre })}
                    aria-invalid={mal || undefined}
                    aria-describedby={hayNota ? idNota : undefined}
                    onChange={(e) => onCambio(d.dayOfWeek, { openTime: e.target.value })}
                  />
                  <span className={s.hasta}>{t("settings.client.hoursTo")}</span>
                  <input
                    type="time"
                    className={`${s.hora} ${mal ? s.horaMal : ""}`}
                    value={d.closeTime}
                    disabled={deshabilitado}
                    aria-label={t("settings.horarioDoctor.salidaAria", { dia: nombre })}
                    aria-invalid={mal || undefined}
                    aria-describedby={hayNota ? idNota : undefined}
                    onChange={(e) => onCambio(d.dayOfWeek, { closeTime: e.target.value })}
                  />
                </>
              )}
            </div>

            {mal ? (
              <p className={`${s.avisoDia} ${s.errorDia}`} id={idNota}>
                {t("settings.horarioDoctor.rangoInvalido")}
              </p>
            ) : aviso ? (
              <p className={s.avisoDia} id={idNota}>
                <AlertTriangle size={14} strokeWidth={2.2} className={s.notaIcono} aria-hidden />
                <span>{textoAviso(aviso)}</span>
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
