"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardCheck,
  History,
  Loader2,
  Save,
  ShieldAlert,
  Smile,
  Stethoscope,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  ALERGIAS,
  HABITOS,
  PADECIMIENTOS,
  RISK_FLAG_LABELS,
  computeRiskFlags,
  type Answers,
  type QDef,
} from "@/lib/health-questionnaire";
import { useT } from "@/i18n/i18n-provider";
import { fechaLarga } from "./fechas";
import s from "./rediseno.module.css";

/**
 * Cuestionario de salud, rediseñado.
 *
 * El contenido es EL MISMO: las mismas 16 preguntas de padecimientos, 5 de
 * alergias y 3 de hábitos, los mismos campos de antecedentes, el mismo motivo
 * de consulta, el mismo dolor de 0 a 10 y el mismo historial de versiones.
 * Ninguna pregunta se añade, se quita ni se renombra, y guarda contra el
 * mismo endpoint con el mismo cuerpo: lo que cambia es cómo se ve y cómo se
 * usa.
 *
 * Lo que cambia:
 *  · Los tres grupos van en tarjetas con su ícono, no en cajas iguales.
 *  · Un «Sí» pinta la pregunta entera de rojo suave — de un vistazo se ve qué
 *    tiene el paciente sin leer las treinta y cuatro líneas.
 *  · Las banderas de riesgo se calculan mientras escribes y viven arriba, en
 *    su propia tarjeta, no como un rebujo de chips bajo el título.
 *  · El botón de guardar va en una barra PEGADA ABAJO: el cuestionario mide
 *    varias pantallas y antes había que bajar del todo para guardar.
 *  · El historial de versiones, plegado al final.
 */

interface Props {
  patientId: string;
  onSaved?: () => void;
}

function Pregunta({
  def,
  answers,
  onSet,
  textoSi,
  textoNo,
}: {
  def: QDef;
  answers: Answers;
  onSet: (k: string, v: any) => void;
  textoSi: string;
  textoNo: string;
}) {
  const si = answers[def.key] === true;
  const no = answers[def.key] === false;
  return (
    <div className={[s.pregunta, si ? s.preguntaSi : ""].filter(Boolean).join(" ")}>
      <div className={s.preguntaFila}>
        <span className={s.preguntaTexto}>{def.label}</span>
        <span className={s.siNo} role="group" aria-label={def.label}>
          <button
            type="button"
            className={[s.siNoBoton, si ? s.siNoSiActivo : ""].filter(Boolean).join(" ")}
            aria-pressed={si}
            onClick={() => onSet(def.key, true)}
          >
            {textoSi}
          </button>
          <button
            type="button"
            className={[s.siNoBoton, no ? s.siNoNoActivo : ""].filter(Boolean).join(" ")}
            aria-pressed={no}
            onClick={() => onSet(def.key, false)}
          >
            {textoNo}
          </button>
        </span>
      </div>
      {def.detail && si && (
        <input
          className={s.campoEntrada}
          placeholder={def.detailLabel ?? def.detailPlaceholder ?? ""}
          value={answers[def.key + "Detail"] ?? ""}
          onChange={(e) => onSet(def.key + "Detail", e.target.value)}
        />
      )}
    </div>
  );
}

function Grupo({
  icono: Icono,
  tono,
  titulo,
  preguntas,
  answers,
  onSet,
  textoSi,
  textoNo,
}: {
  icono: typeof Smile;
  tono?: string;
  titulo: string;
  preguntas: QDef[];
  answers: Answers;
  onSet: (k: string, v: any) => void;
  textoSi: string;
  textoNo: string;
}) {
  const conSi = preguntas.filter((q) => answers[q.key] === true).length;
  return (
    <section className={s.tarjeta}>
      <header className={s.tarjetaCabeza}>
        <span className={[s.tarjetaIcono, tono ?? ""].filter(Boolean).join(" ")}>
          <Icono size={15} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className={s.tarjetaTitulo}>{titulo}</h2>
        {conSi > 0 && <span className={`${s.etiqueta} ${s.etiquetaPeligro}`}>{conSi}</span>}
      </header>
      <div className={s.tarjetaCuerpo}>
        <div className={s.preguntas}>
          {preguntas.map((q) => (
            <Pregunta
              key={q.key}
              def={q}
              answers={answers}
              onSet={onSet}
              textoSi={textoSi}
              textoNo={textoNo}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function Cuestionario({ patientId, onSaved }: Props) {
  const t = useT();
  const [answers, setAnswers] = useState<Answers>({});
  const [notes, setNotes] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [vigente, setVigente] = useState<any | null>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    fetch(`/api/patients/${patientId}/health-questionnaire`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se pudo cargar"))))
      .then((data) => {
        if (cancelado) return;
        setVigente(data.current ?? null);
        setHistorial(Array.isArray(data.history) ? data.history : []);
        if (data.current?.answers && typeof data.current.answers === "object") {
          setAnswers(data.current.answers);
        }
        if (typeof data.current?.notes === "string") setNotes(data.current.notes);
      })
      .catch(() => {
        if (!cancelado) toast.error(t("pacientesRediseno.cuestionario.errorCargar"));
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [patientId, t]);

  const set = (key: string, value: any) => setAnswers((a) => ({ ...a, [key]: value }));

  const banderas = useMemo(() => computeRiskFlags(answers), [answers]);

  async function guardar() {
    setGuardando(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/health-questionnaire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, notes }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).error ?? t("pacientesRediseno.cuestionario.errorGuardar"));
      }
      const data = await res.json();
      setVigente(data.questionnaire ?? null);
      setHistorial((prev) => [data.questionnaire, ...prev]);
      toast.success(t("pacientesRediseno.cuestionario.guardado"));
      onSaved?.();
    } catch (err: any) {
      toast.error(err.message ?? t("pacientesRediseno.cuestionario.errorGuardar"));
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return (
      <div className={s.tarjeta}>
        <div className={s.cargando}>
          <Loader2 size={16} strokeWidth={2} aria-hidden className={s.girando} />
          {t("pacientesRediseno.cuestionario.cargando")}
        </div>
      </div>
    );
  }

  const dolor = Number(answers.painLevel ?? 0);
  const si = t("common.yes");
  const no = t("common.no");

  return (
    <div className={s.columna}>
      <header className={s.pantallaCabeza}>
        <div>
          <h1 className={s.pantallaTitulo}>{t("patients.tabs.cuestionario")}</h1>
          <p className={s.pantallaSub}>
            {vigente
              ? t("pacientesRediseno.cuestionario.vigente", {
                  fecha: fechaLarga(vigente.filledAt),
                  quien: vigente.filledByName ?? "—",
                })
              : t("pacientesRediseno.cuestionario.sinPrevio")}
          </p>
        </div>
      </header>

      {/* Banderas de riesgo — se recalculan mientras se contesta. */}
      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span
            className={`${s.tarjetaIcono} ${banderas.length > 0 ? s.tarjetaIconoPeligro : s.tarjetaIconoExito}`}
          >
            {banderas.length > 0 ? (
              <ShieldAlert size={15} strokeWidth={1.75} aria-hidden />
            ) : (
              <Check size={15} strokeWidth={1.75} aria-hidden />
            )}
          </span>
          <h2 className={s.tarjetaTitulo}>{t("pacientesRediseno.cuestionario.banderas")}</h2>
        </header>
        <div className={s.tarjetaCuerpo}>
          {banderas.length > 0 ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {banderas.map((f) => (
                  <span key={f} className={`${s.etiqueta} ${s.etiquetaPeligro}`}>
                    <AlertTriangle size={11} strokeWidth={2} aria-hidden />
                    {RISK_FLAG_LABELS[f] ?? f}
                  </span>
                ))}
              </div>
              <p className={s.pantallaSub} style={{ marginTop: 10, fontSize: 12 }}>
                {t("pacientesRediseno.cuestionario.banderasPie")}
              </p>
            </>
          ) : (
            <p className={s.pantallaSub} style={{ margin: 0 }}>
              {t("pacientesRediseno.cuestionario.sinBanderas")}
            </p>
          )}
        </div>
      </section>

      <Grupo
        icono={Stethoscope}
        titulo={t("pacientesRediseno.cuestionario.padecimientos")}
        preguntas={PADECIMIENTOS}
        answers={answers}
        onSet={set}
        textoSi={si}
        textoNo={no}
      />
      <Grupo
        icono={AlertTriangle}
        tono={s.tarjetaIconoPeligro}
        titulo={t("pacientesRediseno.cuestionario.alergias")}
        preguntas={ALERGIAS}
        answers={answers}
        onSet={set}
        textoSi={si}
        textoNo={no}
      />
      <Grupo
        icono={Smile}
        tono={s.tarjetaIconoAlerta}
        titulo={t("pacientesRediseno.cuestionario.habitos")}
        preguntas={HABITOS}
        answers={answers}
        onSet={set}
        textoSi={si}
        textoNo={no}
      />

      {/* Antecedentes médicos */}
      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span className={s.tarjetaIcono}>
            <ClipboardCheck size={15} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.tarjetaTitulo}>{t("pacientesRediseno.cuestionario.antecedentes")}</h2>
        </header>
        <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={s.campo}>
            <label className={s.campoEtiqueta} htmlFor="pr-medicacion">
              {t("pacientesRediseno.cuestionario.medicacion")}
            </label>
            <textarea
              id="pr-medicacion"
              className={`${s.campoEntrada} ${s.campoArea}`}
              placeholder={t("pacientesRediseno.cuestionario.medicacionEjemplo")}
              value={answers.currentMedications ?? ""}
              onChange={(e) => set("currentMedications", e.target.value)}
            />
          </div>
          <div className={s.campoDoble}>
            <div className={s.campo}>
              <label className={s.campoEtiqueta} htmlFor="pr-medico">
                {t("pacientesRediseno.cuestionario.medicoTratante")}
              </label>
              <input
                id="pr-medico"
                className={s.campoEntrada}
                value={answers.treatingDoctorName ?? ""}
                onChange={(e) => set("treatingDoctorName", e.target.value)}
              />
            </div>
            <div className={s.campo}>
              <label className={s.campoEtiqueta} htmlFor="pr-medico-tel">
                {t("pacientesRediseno.cuestionario.medicoTelefono")}
              </label>
              <input
                id="pr-medico-tel"
                className={s.campoEntrada}
                value={answers.treatingDoctorPhone ?? ""}
                onChange={(e) => set("treatingDoctorPhone", e.target.value)}
              />
            </div>
          </div>
          <div className={s.campo}>
            <label className={s.campoEtiqueta} htmlFor="pr-hospital">
              {t("pacientesRediseno.cuestionario.hospitalizaciones")}
            </label>
            <textarea
              id="pr-hospital"
              className={`${s.campoEntrada} ${s.campoArea}`}
              value={answers.hospitalizations ?? ""}
              onChange={(e) => set("hospitalizations", e.target.value)}
            />
          </div>
          <Pregunta
            def={{
              key: "anesthesiaComplications",
              label: t("pacientesRediseno.cuestionario.complicacionesAnestesia"),
              detail: true,
              detailLabel: t("pacientesRediseno.cuestionario.complicacionesDetalle"),
            }}
            answers={answers}
            onSet={set}
            textoSi={si}
            textoNo={no}
          />
        </div>
      </section>

      {/* Motivo y estado dental */}
      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span className={s.tarjetaIcono}>
            <Smile size={15} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.tarjetaTitulo}>{t("pacientesRediseno.cuestionario.motivo")}</h2>
        </header>
        <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={s.campoDoble}>
            <div className={s.campo}>
              <label className={s.campoEtiqueta} htmlFor="pr-motivo">
                {t("pacientesRediseno.cuestionario.motivoPrincipal")}
              </label>
              <input
                id="pr-motivo"
                className={s.campoEntrada}
                value={answers.chiefComplaint ?? ""}
                onChange={(e) => set("chiefComplaint", e.target.value)}
              />
            </div>
            <div className={s.campo}>
              <label className={s.campoEtiqueta} htmlFor="pr-ultima">
                {t("pacientesRediseno.cuestionario.ultimaVisita")}
              </label>
              <input
                id="pr-ultima"
                className={s.campoEntrada}
                placeholder={t("pacientesRediseno.cuestionario.ultimaVisitaEjemplo")}
                value={answers.lastDentalVisit ?? ""}
                onChange={(e) => set("lastDentalVisit", e.target.value)}
              />
            </div>
          </div>
          <Pregunta
            def={{ key: "bleedingGums", label: t("pacientesRediseno.cuestionario.sangrado") }}
            answers={answers}
            onSet={set}
            textoSi={si}
            textoNo={no}
          />
          <div className={s.campo}>
            <label className={s.campoEtiqueta} htmlFor="pr-dolor">
              {t("pacientesRediseno.cuestionario.dolor", { nivel: dolor })}
            </label>
            <input
              id="pr-dolor"
              type="range"
              min={0}
              max={10}
              step={1}
              value={dolor}
              onChange={(e) => set("painLevel", Number(e.target.value))}
              className={s.deslizador}
            />
          </div>
          <div className={s.campo}>
            <label className={s.campoEtiqueta} htmlFor="pr-notas">
              {t("pacientesRediseno.cuestionario.notas")}
            </label>
            <textarea
              id="pr-notas"
              className={`${s.campoEntrada} ${s.campoArea}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Guardar — pegado abajo: el cuestionario mide varias pantallas. */}
      <div className={s.guardarBarra}>
        <span className={s.guardarNota}>{t("pacientesRediseno.cuestionario.avisoGuardado")}</span>
        <button
          type="button"
          className={`${s.boton} ${s.botonPrincipal}`}
          onClick={guardar}
          disabled={guardando}
        >
          {guardando ? (
            <Loader2 size={14} strokeWidth={2} aria-hidden className={s.girando} />
          ) : (
            <Save size={14} strokeWidth={1.75} aria-hidden />
          )}
          {guardando
            ? t("pacientesRediseno.cuestionario.guardando")
            : vigente
              ? t("pacientesRediseno.cuestionario.guardarVersion")
              : t("pacientesRediseno.cuestionario.guardar")}
        </button>
      </div>

      {historial.length > 1 && (
        <section className={`${s.tarjeta} ${s.bitacoraCaja}`}>
          <button
            type="button"
            className={s.bitacoraCabeza}
            onClick={() => setHistorialAbierto((v) => !v)}
            aria-expanded={historialAbierto}
          >
            <span className={s.tarjetaIcono}>
              <History size={15} strokeWidth={1.75} aria-hidden />
            </span>
            <span className={s.tarjetaTitulo}>
              {t("pacientesRediseno.cuestionario.historial", { count: historial.length - 1 })}
            </span>
            <ChevronDown
              size={16}
              strokeWidth={2}
              aria-hidden
              style={{
                marginLeft: "auto",
                flexShrink: 0,
                transform: historialAbierto ? "rotate(180deg)" : undefined,
                transition: "transform .15s",
              }}
            />
          </button>
          {historialAbierto && (
            <div className={s.bitacoraCuerpo}>
              <div className={s.lista}>
                {historial.slice(1).map((q: any) => (
                  <div key={q.id} className={s.listaFila}>
                    <span className={s.listaPunto} aria-hidden />
                    <span className={s.listaCuerpo}>
                      <span className={s.listaTitulo}>{fechaLarga(q.filledAt)}</span>
                      {q.filledByName && <span className={s.listaSub}>{q.filledByName}</span>}
                    </span>
                    {Array.isArray(q.riskFlags) && q.riskFlags.length > 0 && (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
                        {q.riskFlags.map((f: string) => (
                          <span key={f} className={`${s.etiqueta} ${s.etiquetaPeligro}`}>
                            {RISK_FLAG_LABELS[f] ?? f}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
