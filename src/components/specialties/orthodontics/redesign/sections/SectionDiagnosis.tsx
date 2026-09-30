"use client";
// Sección «Diagnóstico» de la pestaña Ortodoncia — CÓMO ESTÁ el paciente (ws1-t8, completo como Dentalink).
// Lo que se le va a hacer es la otra parte, el «Plan de tratamiento» (ws1-t12).
//
// Resumen visual, no filas de «-»: una franja con los valores clave (Angle, overjet, overbite, clase facial,
// línea media) con su punto normal/alterado; tarjetas por apartado que solo muestran lo que tiene dato (lo
// alterado resaltado); los apartados sin capturar, en una línea discreta con «Completar»; el resumen
// diagnóstico al final. Debajo, como antes: Imagen y análisis y Registros digitales.
//
// Lo de siempre llega en `diagnosis` (DTO del cargador); lo nuevo (`diagnosticoDetalle`) y los registros
// iniciales se leen aquí con `useDiagnosticoCompleto`, sin tocar el cargador de la ficha.

import type { ReactNode } from "react";
import { Activity, Camera, Crosshair, FileText, FolderOpen, GitBranch, Layers, Pencil, Plus, Smile, User } from "lucide-react";
import { Btn, Card } from "../atoms";
import { Pill } from "../atoms/Pill";
import { fmtDateShort } from "../atoms/format";
import type { DiagnosisDTO } from "../types";
import {
  FASE_DENTAL,
  baseSinRelleno,
  indicadoresClave,
  seccionesDelDiagnostico,
  type DiagnosticoBase,
  type LineaDx,
  type SeccionLegible,
} from "@/lib/orthodontics/diagnostico-detalle";
import type { DiagnosticoCompleto } from "@/app/actions/orthodontics/leerDiagnosticoCompleto";
import { pedirSeccionDelDiagnostico, useDiagnosticoCompleto } from "../diagnostico/useDiagnosticoCompleto";
import { VersionesDelCaso } from "../diagnostico/VersionesDelCaso";
import dx from "../diagnostico.module.css";
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
  /** @deprecated ws1-t8: las líneas medias salen del diagnóstico completo (superior e inferior). Se ignoran. */
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
      eyebrow="Cómo está el paciente"
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
      <ResumenDelDiagnostico d={d} onEdit={props.onEdit} treatmentPlanId={props.treatmentPlanId} />
      {/* Imagen y análisis + registros: rejilla 1×2 con una línea fina entre bloques. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[color:var(--pr-borde-suave)] border-t border-[color:var(--pr-borde-suave)] rounded-b-[14px] overflow-hidden">
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

/** Lo de siempre desde el DTO del cargador, mientras llega lo completo (sin inventar lo que el DTO no trae). */
function baseDesdeDto(d: DiagnosisDTO): DiagnosticoBase {
  return {
    angleClassRight: d.angleClassRight,
    angleClassLeft: d.angleClassLeft,
    overbiteMm: d.overbiteMm,
    overbitePercentage: null,
    overjetMm: d.overjetMm,
    midlineDeviationMm: d.midlineDeviationMm,
    crowdingUpperMm: d.crowdingUpperMm,
    crowdingLowerMm: d.crowdingLowerMm,
    crossbite: d.crossbite,
    crossbiteDetails: d.crossbiteDetails,
    openBite: d.openBite,
    openBiteDetails: d.openBiteDetails,
    etiologySkeletal: false,
    etiologyDental: false,
    etiologyFunctional: false,
    etiologyNotes: null,
    habits: d.habits,
    habitsDescription: d.habitsDescription,
    dentalPhase: null,
    skeletalPattern: d.skeletalPattern,
    tmjPainPresent: d.tmjPainPresent,
    tmjClickingPresent: d.tmjClickingPresent,
    tmjNotes: d.tmjNotes,
    clinicalSummary: d.clinicalSummary,
  };
}

const ICONO_BLOQUE: Record<string, ReactNode> = {
  facial: <User size={13} strokeWidth={1.9} />,
  oclusal: <Crosshair size={13} strokeWidth={1.9} />,
  dentoalveolar: <Smile size={13} strokeWidth={1.9} />,
  funcional: <Activity size={13} strokeWidth={1.9} />,
  cefalometria: <Layers size={13} strokeWidth={1.9} />,
  etiologia: <GitBranch size={13} strokeWidth={1.9} />,
  registros: <FolderOpen size={13} strokeWidth={1.9} />,
};

/** Apartados que se ofrecen «Completar» si no tienen nada (la clave es la sección del paso). */
const APARTADOS: Array<{ clave: string; titulo: string }> = [
  { clave: "facial", titulo: "Características faciales" },
  { clave: "oclusal", titulo: "Oclusal y dentario" },
  { clave: "dentoalveolar", titulo: "Dentoalveolar" },
  { clave: "funcional", titulo: "Funcional y ATM" },
  { clave: "cefalometria", titulo: "Cefalometría" },
  { clave: "etiologia", titulo: "Etiología" },
];

function ResumenDelDiagnostico({ d, onEdit, treatmentPlanId }: { d: DiagnosisDTO; onEdit?: () => void; treatmentPlanId?: string }) {
  const { datos, cargando } = useDiagnosticoCompleto(d.id);
  const base = datos ? datos.base : baseDesdeDto(d);
  const detalle = datos?.detalle ?? null;
  const indicadores = indicadoresClave(base, detalle);
  // La clasificación ya está en la franja; el resto, en tarjetas.
  const secciones = seccionesDelDiagnostico(base, detalle).filter((s) => s.clave !== "clasificacion");
  const conDato = new Set(secciones.map((s) => s.clave));
  const vacios = datos ? APARTADOS.filter((a) => !conDato.has(a.clave)) : [];
  const completar = (clave: string) => {
    if (!onEdit) return;
    pedirSeccionDelDiagnostico(clave);
    onEdit();
  };
  const resumen = (base.clinicalSummary ?? "").trim();
  // La etapa de dentición de relleno (sin capturar) no se dice.
  const fase = baseSinRelleno(base, detalle).dentalPhase;
  const meta = [
    fase ? `Dentición ${(FASE_DENTAL[fase] ?? fase).toLowerCase()}` : null,
    datos ? `valorado el ${fmtDateShort(datos.diagnosticadoEl)}` : null,
  ].filter(Boolean);

  return (
    <div className={dx.dxCuerpo}>
      {meta.length ? <div className={`${orto.tonoApagado} text-xs`}>{meta.join(" · ")}</div> : null}
      {/* Reevaluaciones del caso: versión actual, historial y «Nueva reevaluación» (sin el SQL, no se pinta). */}
      {treatmentPlanId ? <VersionesDelCaso treatmentPlanId={treatmentPlanId} puedeReevaluar={Boolean(onEdit)} onReevaluacionCreada={onEdit} /> : null}
      <div className={dx.dxFranja} role="list" aria-label="Valores clave del diagnóstico">
        {indicadores.map((i) => (
          <div key={i.clave} className={dx.dxIndicador} role="listitem">
            <div className={dx.dxIndicadorEtiqueta}>
              <span>{i.etiqueta}</span>
              {i.estado && i.estado !== "neutro" ? (
                <span
                  className={`${dx.dxPunto} ${i.estado === "normal" ? dx.dxPuntoNormal : dx.dxPuntoAlterado}`}
                  role="img"
                  aria-label={i.estado === "normal" ? "normal" : "alterado"}
                  title={i.estado === "normal" ? "Normal" : "Alterado"}
                />
              ) : null}
            </div>
            {i.valor === "—" ? (
              <div className={dx.dxIndicadorVacio}>Sin capturar</div>
            ) : (
              <div className={dx.dxIndicadorValor}>{i.valor}</div>
            )}
            {i.detalle ? <div className={dx.dxIndicadorDetalle}>{i.detalle}</div> : null}
          </div>
        ))}
      </div>

      {cargando && !datos ? (
        <div className={dx.dxTarjetas} aria-hidden>
          <div className={dx.dxEsqueleto} />
          <div className={dx.dxEsqueleto} />
        </div>
      ) : (
        <div className={dx.dxTarjetas}>
          {secciones.map((s) => (
            <BloqueDx key={s.clave} s={s} />
          ))}
          {datos ? <BloqueRegistros datos={datos} /> : null}
        </div>
      )}

      {vacios.length > 0 ? (
        <div className={dx.dxVacios}>
          <span>Sin capturar:</span>
          {vacios.map((v) =>
            onEdit ? (
              <button key={v.clave} type="button" className={dx.dxCompletar} onClick={() => completar(v.clave)}>
                + {v.titulo}
              </button>
            ) : (
              <span key={v.clave}>{v.titulo}</span>
            ),
          )}
        </div>
      ) : null}

      <div className={dx.dxResumen}>
        <div className={dx.dxResumenEtiqueta}>Resumen diagnóstico</div>
        {resumen ? (
          <p className={dx.dxResumenTexto}>{resumen}</p>
        ) : (
          <p className={`${dx.dxResumenTexto} ${orto.tonoApagado}`}>
            Todavía sin resumen.{" "}
            {onEdit ? (
              <button type="button" className={dx.dxCompletar} onClick={() => completar("resumen")}>
                Escribirlo
              </button>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}

function Renglon({ l }: { l: LineaDx }) {
  const largo = l.valor.length > 42 || l.valor.includes("\n");
  const tono = l.estado === "alterado" ? dx.dxValorAlterado : l.estado === "normal" ? dx.dxValorNormal : "";
  return (
    <div className={`${dx.dxRenglon} ${largo ? dx.dxRenglonLargo : ""}`}>
      <span className={dx.dxRenglonEtiqueta}>{l.etiqueta}</span>
      <span className={dx.dxRenglonValor}>{largo ? l.valor : <span className={tono}>{l.valor}</span>}</span>
    </div>
  );
}

function BloqueDx({ s }: { s: SeccionLegible }) {
  const alterados = s.lineas.filter((l) => l.estado === "alterado").length;
  return (
    <section className={dx.dxBloque} aria-label={s.titulo}>
      <header className={dx.dxBloqueCabeza}>
        <span className={dx.dxBloqueIcono} aria-hidden>
          {ICONO_BLOQUE[s.clave] ?? <FileText size={13} strokeWidth={1.9} />}
        </span>
        <h4 className={dx.dxBloqueTitulo}>{s.titulo}</h4>
        <span className={dx.dxBloqueCuenta}>
          {alterados > 0 ? `${alterados} alterado${alterados === 1 ? "" : "s"}` : `${s.lineas.length} dato${s.lineas.length === 1 ? "" : "s"}`}
        </span>
      </header>
      <div className={dx.dxRenglones}>
        {s.lineas.map((l) => (
          <Renglon key={l.clave} l={l} />
        ))}
      </div>
    </section>
  );
}

/** Registros iniciales: el PDF del trazado (con enlace), el escaneo y las fotos. Sin nada, no se pinta. */
function BloqueRegistros({ datos }: { datos: DiagnosticoCompleto }) {
  const r = datos.registros;
  if (!r.trazado && !r.escaneo && !r.fotosIniciales) return null;
  const enlace = (a: { nombre: string; url: string | null }) =>
    a.url ? (
      <a className={dx.dxEnlace} href={a.url} target="_blank" rel="noopener noreferrer">
        <FileText size={13} strokeWidth={1.9} aria-hidden />
        {a.nombre}
      </a>
    ) : (
      a.nombre
    );
  return (
    <section className={dx.dxBloque} aria-label="Registros iniciales">
      <header className={dx.dxBloqueCabeza}>
        <span className={dx.dxBloqueIcono} aria-hidden>
          {ICONO_BLOQUE.registros}
        </span>
        <h4 className={dx.dxBloqueTitulo}>Registros iniciales</h4>
      </header>
      <div className={dx.dxRenglones}>
        {r.trazado ? (
          <div className={dx.dxRenglon}>
            <span className={dx.dxRenglonEtiqueta}>{r.trazadoLigado ? "Trazado cefalométrico" : "Trazado (del caso)"}</span>
            <span className={dx.dxRenglonValor}>{enlace(r.trazado)}</span>
          </div>
        ) : null}
        {r.escaneo ? (
          <div className={dx.dxRenglon}>
            <span className={dx.dxRenglonEtiqueta}>Escaneo</span>
            <span className={dx.dxRenglonValor}>{enlace(r.escaneo)}</span>
          </div>
        ) : null}
        {r.fotosIniciales ? (
          <div className={dx.dxRenglon}>
            <span className={dx.dxRenglonEtiqueta}>Fotos iniciales</span>
            <span className={dx.dxRenglonValor}>
              <Camera size={13} strokeWidth={1.9} className="inline mr-1" aria-hidden />
              Ligadas
            </span>
          </div>
        ) : null}
      </div>
    </section>
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
