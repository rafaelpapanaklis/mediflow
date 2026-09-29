"use client";
// Sección G — Retención · G9 régimen retención automatizado.
//
// 3 sub-bloques:
//   - Tipo de retenedor: 3 cards (Superior / Inferior / Fijo lingual 3-3)
//   - Régimen de uso: barra dividida horizontal "24/7 año 1" + "Nocturno años 2-5"
//   - Auto-scheduling: 5 cards (3m / 6m / 12m / 24m / 36m) + toggle pre-encuesta WA
//
// Trigger automático al avanzar fase a Retención: crear LabOrder retainer +
// agendar 5 revisiones (lo dispara advancePhase server action).

import { useState } from "react";
import { DateTimeField } from "@/components/ui/date-time-field";
import { hoyMasAniosISO } from "@/lib/orthodontics/fechas-de-formulario";
import { MessageCircle, Plus, Settings2, Shield } from "lucide-react";
import { agendarRevisionRetencion } from "@/app/actions/orthodontics/agendarRevisionRetencion";
import { isFailure } from "@/app/actions/orthodontics/result";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { fmtDateShort } from "../atoms/format";
import orto from "../orto.module.css";

export type RetainerArchwireGauge = "G_0175" | "G_0195" | "G_021";

const GAUGE_LABEL: Record<RetainerArchwireGauge, string> = {
  G_0175: ".0175",
  G_0195: ".0195",
  G_021: ".021",
};

export interface RetainerCheckupDTO {
  id: string;
  monthsFromDebond: 3 | 6 | 12 | 24 | 36 | number;
  scheduledDate: string;
  status: "PROGRAMMED" | "COMPLETED" | "MISSED" | "CANCELLED";
}

export interface RetentionRegimenDTO {
  id: string | null;
  upperLabel: string | null;
  upperDescription: string | null;
  lowerLabel: string | null;
  lowerDescription: string | null;
  fixedLingualPresent: boolean;
  fixedLingualGauge: RetainerArchwireGauge | null;
  regimenDescription: string;
  preSurveyEnabled: boolean;
  debondedAt: string | null;
}

export interface SectionRetentionProps {
  /** Régimen pre-cargado o null si aún no debondado. */
  regimen: RetentionRegimenDTO | null;
  /** Lista de checkups (3/6/12/24/36 meses). */
  checkups: RetainerCheckupDTO[];
  /** Estado actual del tratamiento — usado para derivar "Activa" vs "Programada". */
  treatmentStatus: "no-iniciado" | "en-tratamiento" | "retencion" | "completado";
  /**
   * El paciente no tiene un caso (plan de tratamiento) abierto. Se pregunta
   * por el caso y no por `treatmentStatus`, que sale «en-tratamiento» por
   * defecto cuando aún no hay nada cargado.
   */
  sinCaso?: boolean;
  onTogglePreSurvey?: (enabled: boolean) => Promise<void> | void;
  onConfigureRegimen?: () => void;
}

const STATUS_LABEL: Record<RetainerCheckupDTO["status"], string> = {
  PROGRAMMED: "futura",
  COMPLETED: "realizada",
  MISSED: "perdida",
  CANCELLED: "cancelada",
};

const STATUS_COLOR: Record<RetainerCheckupDTO["status"], "slate" | "emerald" | "rose"> = {
  PROGRAMMED: "slate",
  COMPLETED: "emerald",
  MISSED: "rose",
  CANCELLED: "slate",
};

export function SectionRetention(props: SectionRetentionProps) {
  const isActive = props.treatmentStatus === "retencion";
  const r = props.regimen;

  // H18d (QA ws1-t9, ws1-t3): sin caso abierto esta tarjeta enseñaba el
  // calendario de controles de retención («3 meses · futura»…) y el
  // interruptor de la pre-encuesta como si fueran de este paciente. Sin caso
  // no hay retención que planear: se dice eso, y nada más.
  if (props.sinCaso && !r && props.checkups.length === 0) {
    return (
      <Card
        id="retention"
        icon={<Shield size={15} strokeWidth={1.75} />}
        title="Retención"
        eyebrow="Retenedores, régimen de uso y controles"
      >
        <div className="px-[18px] py-[16px]">
          <div className={orto.vacio}>
            <span className={orto.vacioIcono} aria-hidden>
              <Shield size={17} strokeWidth={1.75} />
            </span>
            <p className={orto.vacioTitulo}>Aún no hay caso de ortodoncia</p>
            <p className={orto.vacioPista}>
              La retención se planea con el caso abierto: qué retenedor lleva, cómo lo usa y sus
              controles después de retirar la aparatología.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      id="retention"
      icon={<Shield size={15} strokeWidth={1.75} />}
      title="Retención"
      eyebrow="Retenedores, régimen de uso y controles"
      action={
        <div className="flex items-center gap-2">
          <Pill color={isActive ? "emerald" : "slate"}>
            {isActive ? "Activa" : "Empieza al retirar los brackets"}
          </Pill>
          {r && props.onConfigureRegimen ? (
            <Btn
              variant="secondary"
              size="sm"
              icon={<Settings2 size={14} strokeWidth={1.75} aria-hidden />}
              onClick={props.onConfigureRegimen}
            >
              Editar régimen
            </Btn>
          ) : null}
        </div>
      }
    >
      {/* Hallazgo ws1-t4 §6: sin régimen configurado, esto mostraba datos
          inventados (Hawley sup / Essix inf / .0195) como si la clínica ya
          los hubiera elegido — y el botón para configurarlo de verdad no
          existía aunque el cajón (DrawerConfigRetention, ver
          OrthodonticsRedesignClient) ya se podía abrir. */}
      {!r ? (
        <div className="px-[18px] py-[16px]">
          <div className={orto.vacio}>
            <span className={orto.vacioIcono} aria-hidden>
              <Shield size={17} strokeWidth={1.75} />
            </span>
            <p className={orto.vacioTitulo}>Nadie configuró el régimen de retención todavía</p>
            <p className={orto.vacioPista}>
              Elige qué retenedor lleva arriba y abajo, si hay fijo lingual y su calibre, y el
              régimen de uso (horas al día, cuánto dura cada etapa).
            </p>
            {props.onConfigureRegimen ? (
              <Btn
                variant="primary"
                className="mt-1"
                icon={<Plus size={15} strokeWidth={1.75} aria-hidden />}
                onClick={props.onConfigureRegimen}
              >
                Configurar régimen
              </Btn>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
            <h4 className={`${orto.bloqueTitulo} mb-[10px]`}>Tipo de retenedor</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <RetainerCard label="Superior" value={r.upperLabel ?? "—"} sub={r.upperDescription ?? "—"} />
              <RetainerCard label="Inferior" value={r.lowerLabel ?? "—"} sub={r.lowerDescription ?? "—"} />
              {r.fixedLingualPresent ? (
                <RetainerCard
                  label="Fijo lingual 3-3"
                  value={r.fixedLingualGauge ? GAUGE_LABEL[r.fixedLingualGauge] : "—"}
                  sub="Acero trenzado, mandibular"
                  mono
                />
              ) : (
                <RetainerCard label="Fijo lingual 3-3" value="Sin fijo" sub="—" />
              )}
            </div>
          </div>

          <div className="px-[18px] py-[16px] border-b border-[color:var(--pr-borde-suave)]">
            <h4 className={`${orto.bloqueTitulo} mb-[10px]`}>Régimen de uso</h4>
            <p className="text-[13px] text-[color:var(--pr-texto-2)]">{r.regimenDescription}</p>
          </div>
        </>
      )}

      <div className="px-[18px] py-[16px]">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h4 className={orto.bloqueTitulo}>Controles de retención</h4>
          <PreSurveyToggle
            enabled={r?.preSurveyEnabled ?? false}
            onChange={(v) => void props.onTogglePreSurvey?.(v)}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(props.checkups.length > 0 ? props.checkups : defaultCheckups()).map((c) => (
            <CheckupCard key={c.id} checkup={c} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function RetainerCard({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub: string;
  mono?: boolean;
}) {
  return (
    <div className={orto.caja}>
      <div className={orto.datoEtiqueta}>{label}</div>
      <div className={`${orto.datoValor} ${mono ? "tabular-nums" : ""}`}>{value}</div>
      <div className={orto.datoSub}>{sub}</div>
    </div>
  );
}

function PreSurveyToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <MessageCircle size={14} strokeWidth={1.75} className={orto.tonoApagado} aria-hidden />
      <span className="text-xs text-[color:var(--pr-texto-2)]" id="orto-pre-encuesta">
        Preguntar antes «¿estás usando tu retenedor?»
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby="orto-pre-encuesta"
        onClick={() => onChange(!enabled)}
        className={`w-9 h-5 rounded-full relative transition-colors flex-none ${
          enabled ? "bg-[color:var(--pr-activo)]" : "bg-[color:var(--pr-texto-3)]"
        }`}
      >
        <span
          className={`absolute top-[2px] w-4 h-4 bg-[color:var(--pr-tarjeta)] rounded-full transition-all ${
            enabled ? "left-[18px]" : "left-[2px]"
          }`}
          aria-hidden
        />
      </button>
    </div>
  );
}

function CheckupCard({ checkup }: { checkup: RetainerCheckupDTO }) {
  // H65: la revisión se convierte en cita de la Agenda.
  const puedeAgendar = checkup.status === "PROGRAMMED" && !checkup.id.startsWith("placeholder-");
  const [abierto, setAbierto] = useState(false);
  const [cuando, setCuando] = useState("");
  const [estado, setEstado] = useState<"idle" | "cargando" | "agendado" | "error">("idle");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const agendar = async () => {
    if (!cuando) return;
    setEstado("cargando");
    setMensaje(null);
    const r = await agendarRevisionRetencion({ checkupId: checkup.id, startsAt: new Date(cuando).toISOString() });
    if (isFailure(r)) {
      setEstado("error");
      setMensaje(r.error);
      return;
    }
    setEstado("agendado");
    setAbierto(false);
  };
  return (
    <div className={`${orto.caja} text-center flex flex-col items-center gap-[3px]`}>
      <div className="text-[15px] font-bold leading-tight">
        {checkup.monthsFromDebond} {checkup.monthsFromDebond === 1 ? "mes" : "meses"}
      </div>
      <div className="text-[11.5px] text-[color:var(--pr-texto-3)]">
        {fmtDateShort(checkup.scheduledDate)}
      </div>
      <Pill color={STATUS_COLOR[checkup.status]} size="xs">
        {STATUS_LABEL[checkup.status]}
      </Pill>
      {estado === "agendado" ? <span className="text-[11.5px]" role="status">Cita creada</span> : null}
      {puedeAgendar && estado !== "agendado" ? (
        abierto ? (
          <div className="flex flex-col gap-[4px] w-full mt-[4px]">
            <DateTimeField
              value={cuando}
              max={hoyMasAniosISO(5)}
              onChange={(e) => setCuando(e.target.value)}
              className={orto.entrada}
              aria-label={`Fecha y hora de la revisión de ${checkup.monthsFromDebond} meses`}
            />
            <Btn variant="secondary" size="sm" onClick={agendar} disabled={!cuando || estado === "cargando"}>
              {estado === "cargando" ? "Agendando…" : "Confirmar cita"}
            </Btn>
          </div>
        ) : (
          <button type="button" className={orto.enlace} onClick={() => setAbierto(true)}>
            Agendar
          </button>
        )
      ) : null}
      {mensaje ? <span className="text-[11.5px]" role="alert">{mensaje}</span> : null}
    </div>
  );
}


function defaultCheckups(): RetainerCheckupDTO[] {
  // Visualización pre-debond: muestra los slots como futuros sin fecha.
  return [3, 6, 12, 24, 36].map((m) => ({
    id: `placeholder-${m}`,
    monthsFromDebond: m,
    scheduledDate: "",
    status: "PROGRAMMED",
  }));
}
