"use client";
// Sección B — Diagnóstico de ortodoncia (4 bloques en rejilla 2×2).
//
// 1. Clasificación clínica (Angle, overbite, overjet, apiñamiento, mordida
//    cruzada, líneas medias).
// 2. ATM y hábitos (patrón esquelético, hábitos, ruidos/dolor de ATM).
// 3. Imagen y análisis (cefalometría, fotos con líneas, modelo 3D).
// 4. Registros digitales (radiografías, escaneos).

import { Camera, FileText, Layers, Pencil, Plus, Smile } from "lucide-react";
import { Btn, Card, KV } from "../atoms";
import { Pill } from "../atoms/Pill";
import { fmtDateShort, fmtMm } from "../atoms/format";
import { SKELETAL_PATTERN_LABELS, type DiagnosisDTO } from "../types";
import { ImagenYAnalisisCard } from "../../imagen/ImagenYAnalisisCard";
import orto from "../orto.module.css";

export interface DigitalRecordEntry {
  label: string;
  date: string | null;
  kind: "photo" | "ceph" | "pano" | "stl" | "other";
  href?: string;
}

export interface SectionDiagnosisProps {
  diagnosis: DiagnosisDTO | null;
  digitalRecords?: DigitalRecordEntry[];
  /** Snapshots opcionales de líneas medias para mostrar como texto en KVs. */
  midlineUpper?: string;
  midlineLower?: string;
  midlineLowerDeviated?: boolean;
  onStartWizard?: () => void;
  onEdit?: () => void;
  onUploadRecord?: () => void;
  /** Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026): habilita la
   *  ranura de cefalometría/fotos/3D en vez de la tarjeta decorativa. Sin
   *  esto (patientId sin caso todavía) se sigue viendo el placeholder. */
  treatmentPlanId?: string;
  patientId?: string;
}

const HABIT_LABELS: Record<string, string> = {
  DIGITAL_SUCKING: "succión digital",
  MOUTH_BREATHING: "respirador bucal",
  TONGUE_THRUSTING: "deglución atípica",
  BRUXISM: "bruxismo",
  NAIL_BITING: "onicofagia",
  LIP_BITING: "succión labial",
  OTHER: "otro hábito",
};

const ICONO = { size: 15, strokeWidth: 1.75 } as const;

export function SectionDiagnosis(props: SectionDiagnosisProps) {
  const d = props.diagnosis;

  if (!d) {
    return (
      <Card id="diagnosis" icon={<Smile {...ICONO} />} title="Diagnóstico">
        <div className={orto.tarjetaCuerpo}>
          <div className={orto.vacio}>
            <span className={orto.vacioIcono} aria-hidden>
              <Smile size={17} strokeWidth={1.75} />
            </span>
            <p className={orto.vacioTitulo}>Sin diagnóstico capturado</p>
            <p className={orto.vacioPista}>
              Clase de Angle, overbite, overjet, apiñamiento, mordidas y hábitos: es lo
              primero que pide el plan de tratamiento.
            </p>
            {props.onStartWizard ? (
              <Btn
                variant="secondary"
                size="md"
                className="mt-1"
                icon={<Plus size={15} strokeWidth={1.75} aria-hidden />}
                onClick={props.onStartWizard}
              >
                Capturar diagnóstico
              </Btn>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      id="diagnosis"
      icon={<Smile {...ICONO} />}
      title="Diagnóstico"
      action={
        props.onEdit ? (
          <Btn
            variant="secondary"
            size="sm"
            icon={<Pencil size={14} strokeWidth={1.75} aria-hidden />}
            onClick={props.onEdit}
          >
            Editar
          </Btn>
        ) : null
      }
    >
      {/* Rejilla 2×2 con una línea fina entre bloques: el fondo de la rejilla
          es la línea y cada bloque tapa el suyo. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[color:var(--pr-borde-suave)] rounded-b-[14px] overflow-hidden">
        <ClassificationCard
          d={d}
          midlineUpper={props.midlineUpper}
          midlineLower={props.midlineLower}
          midlineLowerDeviated={props.midlineLowerDeviated}
        />
        <SkeletalAtmCard d={d} />
        {props.treatmentPlanId && props.patientId ? (
          <ImagenYAnalisisCard treatmentPlanId={props.treatmentPlanId} patientId={props.patientId} />
        ) : (
          <CephalometryCard />
        )}
        <DigitalRecordsCard
          records={props.digitalRecords ?? []}
          onUpload={props.onUploadRecord}
        />
      </div>
    </Card>
  );
}

const BLOQUE = "bg-[color:var(--pr-tarjeta)] px-[18px] py-[16px] min-w-0";

function ClassificationCard({
  d,
  midlineUpper,
  midlineLower,
  midlineLowerDeviated,
}: {
  d: DiagnosisDTO;
  midlineUpper?: string;
  midlineLower?: string;
  midlineLowerDeviated?: boolean;
}) {
  const angleLabel = (k: string) => {
    if (k === "CLASS_I") return "Clase I";
    if (k === "CLASS_II_DIV_1") return "Clase II div. 1";
    if (k === "CLASS_II_DIV_2") return "Clase II div. 2";
    if (k === "CLASS_III") return "Clase III";
    return k;
  };
  const upperLabel = midlineUpper ?? "centrada";
  const lowerLabel =
    midlineLower ??
    (d.midlineDeviationMm != null && d.midlineDeviationMm !== 0
      ? `desviada ${Math.abs(d.midlineDeviationMm).toFixed(1)} mm`
      : "centrada");
  const lowerIsDeviated =
    midlineLowerDeviated ?? (d.midlineDeviationMm != null && Math.abs(d.midlineDeviationMm) > 0);
  return (
    <div className={BLOQUE}>
      <h4 className={`${orto.ceja} mb-[10px]`}>Clasificación clínica</h4>
      <div className={orto.filas2}>
        <KV k="Angle der." v={angleLabel(d.angleClassRight)} />
        <KV k="Angle izq." v={angleLabel(d.angleClassLeft)} />
        <KV k="Overbite" v={fmtMm(d.overbiteMm)} />
        <KV k="Overjet" v={fmtMm(d.overjetMm)} />
        <KV k="Apiñam. sup." v={fmtMm(d.crowdingUpperMm ?? null)} />
        <KV k="Apiñam. inf." v={fmtMm(d.crowdingLowerMm ?? null)} />
        <KV k="Línea sup." v={upperLabel} />
        <KV k="Línea inf." v={lowerLabel} vClass={lowerIsDeviated ? orto.tonoPeligro : ""} />
      </div>
      {d.crossbite || d.openBiteDetails ? (
        <div className="mt-[12px]">
          <div className={`${orto.campoEtiqueta} mb-[5px]`}>Mordida cruzada / abierta</div>
          <div className="flex flex-wrap gap-[5px]">
            {d.crossbite ? (
              <Pill color="amber">{d.crossbiteDetails ?? "cruzada"}</Pill>
            ) : null}
            {d.openBite && d.openBiteDetails ? (
              <Pill color="amber">{d.openBiteDetails}</Pill>
            ) : null}
          </div>
        </div>
      ) : null}
      {d.clinicalSummary ? (
        <div className="mt-[12px]">
          <div className={`${orto.campoEtiqueta} mb-[3px]`}>Resumen clínico</div>
          <p className={`${orto.tonoTexto2} text-[13px] leading-relaxed [overflow-wrap:anywhere]`}>
            {d.clinicalSummary}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SkeletalAtmCard({ d }: { d: DiagnosisDTO }) {
  // Hábitos y ATM van en un solo bloque.
  return (
    <div className={BLOQUE}>
      <h4 className={`${orto.ceja} mb-[10px]`}>ATM y hábitos</h4>
      <div className={orto.filas}>
        <KV
          k="Patrón esquelético"
          v={d.skeletalPattern ? SKELETAL_PATTERN_LABELS[d.skeletalPattern] : "sin clasificar"}
          vClass={d.skeletalPattern ? "" : orto.tonoApagado}
        />
        <KV
          k="Ruidos de ATM"
          v={
            d.tmjClickingPresent
              ? d.tmjNotes ?? "chasquido presente"
              : "ausentes"
          }
          vClass={d.tmjClickingPresent ? orto.tonoPeligro : ""}
        />
        <KV
          k="Dolor de ATM"
          v={d.tmjPainPresent ? "presente" : "ausente"}
          vClass={d.tmjPainPresent ? orto.tonoPeligro : ""}
        />
      </div>
      <div className="mt-[12px]">
        <div className={`${orto.campoEtiqueta} mb-[5px]`}>Hábitos parafuncionales</div>
        {d.habits.length === 0 ? (
          <span className={orto.vacioLinea}>Sin hábitos registrados.</span>
        ) : (
          <div className="flex flex-wrap gap-[5px]">
            {d.habits.map((h) => (
              <Pill key={h} color="rose">
                {HABIT_LABELS[h] ?? h.toLowerCase()}
              </Pill>
            ))}
          </div>
        )}
        {d.habitsDescription ? (
          <p className={`${orto.tonoApagado} text-xs mt-2 leading-snug`}>
            {d.habitsDescription}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Sin caso abierto todavía no hay dónde guardar el trazado. */
function CephalometryCard() {
  return (
    <div className={BLOQUE}>
      <h4 className={`${orto.ceja} mb-[10px]`}>Cefalometría</h4>
      <div className={orto.vacio}>
        <p className={orto.vacioTitulo}>Disponible al abrir el caso</p>
        <p className={orto.vacioPista}>
          El trazado cefalométrico se guarda dentro del caso de ortodoncia.
        </p>
      </div>
    </div>
  );
}

function DigitalRecordsCard({
  records,
  onUpload,
}: {
  records: DigitalRecordEntry[];
  onUpload?: () => void;
}) {
  const ICONS: Record<DigitalRecordEntry["kind"], React.ReactNode> = {
    photo: <Camera size={14} strokeWidth={1.75} className={orto.tonoApagado} aria-hidden />,
    ceph: <FileText size={14} strokeWidth={1.75} className={orto.tonoApagado} aria-hidden />,
    pano: <FileText size={14} strokeWidth={1.75} className={orto.tonoApagado} aria-hidden />,
    stl: <Layers size={14} strokeWidth={1.75} className={orto.tonoApagado} aria-hidden />,
    other: <FileText size={14} strokeWidth={1.75} className={orto.tonoApagado} aria-hidden />,
  };
  return (
    <div className={BLOQUE}>
      <h4 className={`${orto.ceja} mb-[10px]`}>Registros digitales</h4>
      {records.length === 0 ? (
        <div className={orto.vacioLinea}>
          Sin radiografías ni escaneos ligados a este caso.
        </div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {records.map((r) => (
            <div key={r.label} className={`${orto.caja} flex items-center justify-between gap-2`}>
              <div className="flex items-center gap-2 min-w-0">
                {ICONS[r.kind]}
                <span className="text-[13px] [overflow-wrap:anywhere]">{r.label}</span>
              </div>
              <Pill color="slate" size="xs">
                {fmtDateShort(r.date)}
              </Pill>
            </div>
          ))}
        </div>
      )}
      {onUpload ? (
        <Btn
          variant="secondary"
          size="sm"
          className="mt-3"
          icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
          onClick={onUpload}
        >
          Abrir radiografías y escaneos
        </Btn>
      ) : null}
    </div>
  );
}
