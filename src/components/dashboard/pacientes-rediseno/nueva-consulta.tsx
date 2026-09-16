"use client";

import { AlertTriangle, ClipboardCheck, HeartPulse, Stethoscope } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { construirAntecedentes, type EntradaAntecedentes } from "./antecedentes";
import s from "./rediseno.module.css";

/**
 * Nueva consulta, rediseñada.
 *
 * El cambio que importa: **los antecedentes ya no se vuelven a pedir, se
 * enseñan.** El formulario de hoy abre con un cuadro de texto vacío,
 * «Antecedentes médicos relevantes», cuyo ejemplo es «Diabetes, hipertensión,
 * medicamentos actuales…» — exactamente lo que el Cuestionario de salud ya
 * guardó campo por campo y lo que la cabecera ya pinta en rojo. Se capturaba
 * dos veces lo mismo, a mano, y las dos versiones podían acabar diciendo
 * cosas distintas.
 *
 * Aquí arriba va lo que el expediente YA sabe, con las alergias y las
 * banderas de riesgo primero y en rojo, y un enlace al cuestionario para
 * corregirlo en su sitio. Si del paciente no se sabe nada, la pantalla lo
 * dice y manda a llenar el cuestionario en vez de ofrecer un cuadro en
 * blanco.
 *
 * El formulario de especialidad (dental, nutrición, psicología, medicina) es
 * el mismo de siempre y entra por `formulario`: esta pantalla lo coloca y le
 * pone la cabecera, no lo reescribe.
 */

export interface NuevaConsultaProps {
  especialidad: string;
  onCambiarEspecialidad: (valor: string) => void;
  /** Se ofrece volver al automático solo si hay un override puesto a mano. */
  onRestablecerEspecialidad?: () => void;
  antecedentes: EntradaAntecedentes;
  /** Aviso de cuestionario ausente o vencido, si la ficha lo levantó. */
  aviso?: React.ReactNode;
  onIrACuestionario: () => void;
  formulario: React.ReactNode;
}

/**
 * Los títulos, SIN emoji. Los de siempre empiezan por 🦷 / 🥗 / 🧠 / 🩺, y esa
 * es una de las mezclas que Rafael quiere fuera: casi toda la ficha usa íconos
 * de línea y unas pocas cajas meten emoji dentro del texto. (Además, en un
 * servidor sin fuente de emoji salen como un cuadradito.) Aquí el dibujo lo
 * pone el ícono de la tarjeta, que es del mismo juego que el resto.
 */
const TITULO: Record<string, string> = {
  dental: "pacientesRediseno.consulta.tituloDental",
  nutrition: "pacientesRediseno.consulta.tituloNutricion",
  psychology: "pacientesRediseno.consulta.tituloPsicologia",
  medicine: "pacientesRediseno.consulta.tituloMedicina",
};

export function NuevaConsulta({
  especialidad,
  onCambiarEspecialidad,
  onRestablecerEspecialidad,
  antecedentes,
  aviso,
  onIrACuestionario,
  formulario,
}: NuevaConsultaProps) {
  const t = useT();
  const bloques = construirAntecedentes(antecedentes);

  return (
    <div className={s.columna}>
      <header className={s.pantallaCabeza}>
        <div>
          <h1 className={s.pantallaTitulo}>
            {t(TITULO[especialidad] ?? TITULO.medicine)}
          </h1>
          <p className={s.pantallaSub}>{t("pacientesRediseno.consulta.subtitulo")}</p>
        </div>
        <div className={s.pantallaAcciones}>
          <label className={s.campoEtiqueta} htmlFor="pr-especialidad">
            {t("patients.newConsult.typeLabel")}
          </label>
          <select
            id="pr-especialidad"
            className={s.campoEntrada}
            style={{ width: "auto", minWidth: 170, minHeight: 38 }}
            value={especialidad}
            onChange={(e) => onCambiarEspecialidad(e.target.value)}
          >
            <option value="dental">{t("patients.newConsult.optDental")}</option>
            <option value="nutrition">{t("patients.newConsult.optNutrition")}</option>
            <option value="psychology">{t("patients.newConsult.optPsychology")}</option>
            <option value="medicine">{t("patients.newConsult.optMedicine")}</option>
          </select>
          {onRestablecerEspecialidad && (
            <button type="button" className={s.tarjetaEnlace} onClick={onRestablecerEspecialidad}>
              {t("patients.newConsult.reset")}
            </button>
          )}
        </div>
      </header>

      {aviso}

      {/* Antecedentes — lo que ya sabemos, no un cuadro que volver a llenar. */}
      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span
            className={`${s.tarjetaIcono} ${bloques.some((b) => b.critico) ? s.tarjetaIconoPeligro : ""}`}
          >
            <HeartPulse size={15} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.tarjetaTitulo}>{t("pacientesRediseno.consulta.antecedentes")}</h2>
          <button type="button" className={s.tarjetaEnlace} onClick={onIrACuestionario}>
            {t("pacientesRediseno.consulta.abrirCuestionario")}
          </button>
        </header>
        <div className={s.tarjetaCuerpo}>
          {bloques.length > 0 ? (
            <>
              <div className={s.filas}>
                {bloques.map((b) => (
                  <div key={b.id} className={s.fila}>
                    <span className={s.filaEtiqueta}>{t(b.labelKey)}</span>
                    <span className={s.filaValor} style={{ textAlign: "right" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          flexWrap: "wrap",
                          gap: 6,
                          justifyContent: "flex-end",
                        }}
                      >
                        {b.valores.map((v) => (
                          <span
                            key={v}
                            className={`${s.etiqueta} ${b.critico ? s.etiquetaPeligro : s.etiquetaNeutra}`}
                          >
                            {b.critico && <AlertTriangle size={11} strokeWidth={2} aria-hidden />}
                            {v}
                          </span>
                        ))}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className={s.pantallaSub} style={{ marginTop: 12, fontSize: 12 }}>
                {t("pacientesRediseno.consulta.antecedentesPie")}
              </p>
            </>
          ) : (
            <div className={s.vacio}>
              <span className={s.vacioIcono}>
                <ClipboardCheck size={17} strokeWidth={1.75} aria-hidden />
              </span>
              <span className={s.vacioTitulo}>{t("pacientesRediseno.consulta.sinAntecedentes")}</span>
              <span className={s.vacioPista}>{t("pacientesRediseno.consulta.sinAntecedentesPista")}</span>
              <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={onIrACuestionario}>
                <ClipboardCheck size={14} strokeWidth={1.75} aria-hidden />
                {t("pacientesRediseno.consulta.llenarCuestionario")}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span className={s.tarjetaIcono}>
            <Stethoscope size={15} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.tarjetaTitulo}>{t("pacientesRediseno.consulta.exploracion")}</h2>
        </header>
        <div className={s.tarjetaCuerpo}>{formulario}</div>
      </section>
    </div>
  );
}
