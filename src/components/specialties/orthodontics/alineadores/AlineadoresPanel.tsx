"use client";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026).
// Ranura NUEVA en el compositor (mismo patrón que ResumenCobranza de la
// Ola 0): self-fetch, se calla si no hay caso de alineadores Y no hay
// cumplimiento registrado. H12 (seguimiento) + H14 (cumplimiento de
// elásticos, vista de clínica) + H15 (bandeja de fotos de monitoreo).

import { useEffect, useId, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Circle, Layers } from "lucide-react";
import { Card } from "../redesign/atoms/Card";
import { Btn } from "../redesign/atoms/Btn";
import { Pill } from "../redesign/atoms/Pill";
import { getAlignerCase, type AlignerCaseRow } from "@/app/actions/orthodontics/alineadores/getAlignerCase";
import { upsertAlignerCase } from "@/app/actions/orthodontics/alineadores/upsertAlignerCase";
import { logAlignerEvent } from "@/app/actions/orthodontics/alineadores/logAlignerEvent";
import { getElasticsCompliance, type ElasticsComplianceView } from "@/app/actions/orthodontics/alineadores/getElasticsCompliance";
import { listMonitoringPhotos, type MonitoringPhotoRow } from "@/app/actions/orthodontics/alineadores/listMonitoringPhotos";
import { reviewMonitoringPhoto } from "@/app/actions/orthodontics/alineadores/reviewMonitoringPhoto";
import { isFailure } from "@/app/actions/orthodontics/result";
import { nombreDeLaFoto, notaCorta } from "@/lib/orthodontics/fotos-paciente";
import {
  EJEMPLO_SISTEMA,
  PISTA_SISTEMA,
  ROTULO_SISTEMA,
  avisoNombreSistema,
  limpiarNombreSistema,
} from "@/lib/orthodontics/alineadores/nombre-sistema";
import orto from "../redesign/orto.module.css";

export interface AlineadoresPanelProps {
  treatmentPlanId: string;
}

const ICONO_SECCION = <Layers size={15} strokeWidth={1.75} />;
const SUB_SECCION = "Seguimiento de alineadores, elásticos y fotos del paciente";

export function AlineadoresPanel({ treatmentPlanId }: AlineadoresPanelProps) {
  const [aligner, setAligner] = useState<AlignerCaseRow | null | undefined>(undefined);
  const [compliance, setCompliance] = useState<ElasticsComplianceView | null>(null);
  const [photos, setPhotos] = useState<MonitoringPhotoRow[]>([]);
  const [showSetup, setShowSetup] = useState(false);

  const load = async () => {
    const [a, c, p] = await Promise.all([
      getAlignerCase(treatmentPlanId),
      getElasticsCompliance(treatmentPlanId),
      listMonitoringPhotos(treatmentPlanId),
    ]);
    if (a.ok) setAligner(a.data);
    if (c.ok) setCompliance(c.data);
    if (p.ok) setPhotos(p.data);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentPlanId]);

  if (aligner === undefined) return null; // cargando

  const hasAnything = aligner !== null || (compliance && compliance.loggedDays > 0) || photos.length > 0;
  if (!hasAnything && !showSetup) {
    return (
      <Card icon={ICONO_SECCION} eyebrow={SUB_SECCION} title="Alineadores y cumplimiento">
        <div className={orto.tarjetaCuerpo}>
          <div className={orto.vacio}>
            <p className={orto.vacioTitulo}>Este caso no lleva alineadores</p>
            <p className={orto.vacioPista}>
              Si el tratamiento es con alineadores, configúralos para seguir el cambio de cada
              uno y el cumplimiento del paciente.
            </p>
            <Btn variant="secondary" size="sm" className="mt-1" onClick={() => setShowSetup(true)}>
              Configurar alineadores
            </Btn>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card icon={ICONO_SECCION} eyebrow={SUB_SECCION} title="Alineadores y cumplimiento">
      <div className={`${orto.tarjetaCuerpo} grid grid-cols-1 lg:grid-cols-3 gap-x-[18px] gap-y-[16px]`}>
        <AlignerTrackingBlock treatmentPlanId={treatmentPlanId} aligner={aligner} showSetup={showSetup || aligner === null} onSaved={load} />
        <ComplianceBlock compliance={compliance} />
        <MonitoringBlock treatmentPlanId={treatmentPlanId} photos={photos} onReviewed={load} />
      </div>
    </Card>
  );
}

function AlignerTrackingBlock({
  treatmentPlanId,
  aligner,
  showSetup,
  onSaved,
}: {
  treatmentPlanId: string;
  aligner: AlignerCaseRow | null;
  showSetup: boolean;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    systemName: aligner?.systemName ?? "",
    totalTrays: aligner?.totalTrays ?? 20,
    currentTray: aligner?.currentTray ?? 1,
    changeIntervalDays: aligner?.changeIntervalDays ?? 14,
    startedAt: aligner?.startedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState<string | null>(null);
  const idSistema = useId();
  const idInicio = useId();
  const avisoSistema = avisoNombreSistema(form.systemName);

  if (showSetup && !aligner) {
    return (
      <div>
        <div className={`${orto.ceja} mb-2`}>Seguimiento de alineadores</div>
        {error ? (
          <div className={`${orto.aviso} ${orto.avisoPeligro} mb-2`} role="alert">
            {error}
          </div>
        ) : null}
        <div className="flex flex-col gap-[10px]">
          {/* H25 (QA en vivo, 28-sep-2026): este campo no tenía rótulo a la
              vista y se confundía con el total. Ver nombre-sistema.ts. */}
          <div className={orto.campo}>
            <label htmlFor={idSistema} className={orto.campoEtiqueta}>
              {ROTULO_SISTEMA}
            </label>
            <input
              id={idSistema}
              type="text"
              placeholder={EJEMPLO_SISTEMA}
              value={form.systemName}
              onChange={(e) => setForm({ ...form, systemName: e.target.value })}
              aria-describedby={`${idSistema}-pista`}
              className={`${orto.entrada} w-full`}
            />
            <p id={`${idSistema}-pista`} className={`${orto.campoPista} ${avisoSistema ? orto.tonoAlerta : ""}`} role={avisoSistema ? "status" : undefined}>
              {avisoSistema ?? PISTA_SISTEMA}
            </p>
          </div>
          <div className={orto.rejilla2} style={{ gap: 10 }}>
            <NumberField label="Total de alineadores" value={form.totalTrays} onChange={(v) => setForm({ ...form, totalTrays: v })} />
            <NumberField label="Alineador actual" value={form.currentTray} onChange={(v) => setForm({ ...form, currentTray: v })} />
            <NumberField label="Cambio cada (días)" value={form.changeIntervalDays} onChange={(v) => setForm({ ...form, changeIntervalDays: v })} />
            <div className={orto.campo}>
              <label htmlFor={idInicio} className={orto.campoEtiqueta}>Fecha de inicio</label>
              <input
                id={idInicio}
                type="date"
                value={form.startedAt}
                onChange={(e) => setForm({ ...form, startedAt: e.target.value })}
                className={`${orto.entrada} w-full`}
              />
            </div>
          </div>
          <Btn
            size="md"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await upsertAlignerCase({
                  treatmentPlanId,
                  ...form,
                  systemName: limpiarNombreSistema(form.systemName),
                });
                if (isFailure(res)) setError(res.error);
                else onSaved();
              });
            }}
          >
            {isPending ? "Guardando…" : "Guardar"}
          </Btn>
        </div>
      </div>
    );
  }

  if (!aligner) return <div />;

  const statusColor = aligner.isPastLastTray ? "amber" : aligner.expectedTray !== aligner.currentTray ? "rose" : "emerald";

  return (
    <div>
      <div className={`${orto.ceja} mb-2`}>Seguimiento de alineadores</div>
      <div className={`${orto.datoValor} ${orto.datoValorGrande} mb-[6px]`} style={{ marginTop: 0 }}>
        {aligner.currentTray}
        <span className={`${orto.datoNota} ${orto.tonoApagado}`}>de {aligner.totalTrays}</span>
      </div>
      <Pill color={statusColor}>
        {aligner.isPastLastTray
          ? "Pasó el último alineador"
          : aligner.expectedTray === aligner.currentTray
            ? "Al día"
            : aligner.currentTray < aligner.expectedTray
              ? `Debería traer el ${aligner.expectedTray}`
              : `Va adelantado (esperado ${aligner.expectedTray})`}
      </Pill>
      <div className="mt-2 text-xs text-[color:var(--pr-texto-3)]">
        {aligner.refinementCount > 0 ? `${aligner.refinementCount} refinamiento(s) · ` : ""}
        {aligner.attachmentsLost > 0 ? `${aligner.attachmentsLost} aditamento(s) perdido(s)` : "sin aditamentos perdidos"}
      </div>
      <div className="mt-[10px] flex flex-wrap gap-[6px]">
        <QuickEventBtn treatmentPlanId={treatmentPlanId} eventType="TRAY_CHANGE" trayNumber={aligner.currentTray + 1} label="Cambió de alineador" onDone={onSaved} />
        <QuickEventBtn treatmentPlanId={treatmentPlanId} eventType="ATTACHMENT_LOST" label="Aditamento perdido" onDone={onSaved} />
        <QuickEventBtn treatmentPlanId={treatmentPlanId} eventType="REFINEMENT" label="Nuevo refinamiento" onDone={onSaved} />
      </div>
    </div>
  );
}

function QuickEventBtn({
  treatmentPlanId,
  eventType,
  trayNumber,
  label,
  onDone,
}: {
  treatmentPlanId: string;
  eventType: "TRAY_CHANGE" | "ATTACHMENT_LOST" | "REFINEMENT";
  trayNumber?: number;
  label: string;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <Btn
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await logAlignerEvent({ treatmentPlanId, eventType, trayNumber });
          onDone();
        })
      }
    >
      {label}
    </Btn>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className={orto.campo}>
      <label htmlFor={id} className={orto.campoEtiqueta}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={orto.entrada}
      />
    </div>
  );
}

function ComplianceBlock({ compliance }: { compliance: ElasticsComplianceView | null }) {
  if (!compliance || compliance.loggedDays === 0) {
    return (
      <div>
        <div className={`${orto.ceja} mb-2`}>Cumplimiento de elásticos</div>
        <p className={orto.vacioLinea}>Sin registros todavía del paciente ni de recepción.</p>
      </div>
    );
  }
  return (
    <div>
      <div className={`${orto.ceja} mb-2`}>
        Cumplimiento de elásticos ({compliance.windowDays} días)
      </div>
      <div className={`${orto.datoValor} ${orto.datoValorGrande} ${compliance.isLow ? orto.tonoAlerta : orto.tonoExito}`} style={{ marginTop: 0 }}>
        {compliance.compliancePct}%
      </div>
      {compliance.avgHours !== null ? (
        <div className={orto.datoSub}>Promedio {compliance.avgHours} h/día</div>
      ) : null}
      {compliance.isLow ? (
        <div className={`${orto.tonoAlerta} mt-1 inline-flex items-center gap-1 text-xs font-semibold`}>
          <AlertTriangle size={13} strokeWidth={1.75} aria-hidden /> Cumplimiento bajo
        </div>
      ) : null}
    </div>
  );
}

function MonitoringBlock({
  treatmentPlanId,
  photos,
  onReviewed,
}: {
  treatmentPlanId: string;
  photos: MonitoringPhotoRow[];
  onReviewed: () => void;
}) {
  const pending = photos.filter((p) => p.reviewStatus === "PENDING");
  const [marcando, setMarcando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  // ws1-t5 (ronda 6, hallazgo 96): la miniatura ABRE la foto. Antes un clic la
  // marcaba como revisada sin haberla visto en grande, y lo que el paciente
  // escribió junto a la foto no se leía en ningún sitio.
  async function marcarRevisada(photoId: string) {
    setMarcando(photoId);
    setFallo(null);
    try {
      const res = await reviewMonitoringPhoto({ photoId, treatmentPlanId, reviewStatus: "REVIEWED" });
      if (isFailure(res)) setFallo(res.error);
      else onReviewed();
    } catch {
      setFallo("No se pudo marcar como revisada. Intenta de nuevo.");
    } finally {
      setMarcando(null);
    }
  }

  if (photos.length === 0) {
    return (
      <div>
        <div className={`${orto.ceja} mb-2`}>Monitoreo del paciente</div>
        <p className={orto.vacioLinea}>El paciente no ha enviado fotos desde su portal.</p>
      </div>
    );
  }
  return (
    <div>
      <div className={`${orto.ceja} mb-2`}>
        Monitoreo del paciente {pending.length > 0 ? <Pill color="amber" size="xs">{pending.length} por revisar</Pill> : null}
      </div>
      <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
        {photos.slice(0, 8).map((p) => {
          const porRevisar = p.reviewStatus === "PENDING";
          const rotulo = `${porRevisar ? "Por revisar" : "Revisada"}: ${nombreDeLaFoto(p.angle)}. Abrir en grande`;
          const marca = (
            <span className="absolute top-0.5 right-0.5">
              {porRevisar ? (
                <Circle className="w-3 h-3 text-[color:var(--pr-alerta)] fill-[var(--pr-alerta)]" />
              ) : (
                <CheckCircle2 className="w-3 h-3 text-[color:var(--pr-exito)] fill-[var(--pr-tarjeta)]" />
              )}
            </span>
          );
          const caja = "relative block aspect-square rounded-[8px] overflow-hidden border border-[color:var(--pr-borde)]";
          return p.url ? (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className={caja} title={rotulo} aria-label={rotulo}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="w-full h-full object-cover" />
              {marca}
            </a>
          ) : (
            <div key={p.id} className={caja} title="No se pudo cargar la foto">
              <div className="w-full h-full bg-[color:var(--pr-hover)]" />
              {marca}
            </div>
          );
        })}
      </div>

      {pending.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {pending.slice(0, 4).map((p) => {
            const nota = notaCorta(p.patientNote, 160);
            return (
              <li key={p.id}>
                <div className={orto.datoSub} style={{ marginTop: 0 }}>
                  <span className="font-semibold capitalize">{nombreDeLaFoto(p.angle)}</span>
                  {" · "}
                  {new Date(p.submittedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                </div>
                {nota ? <div className={orto.datoNota}>«{nota}»</div> : null}
                <Btn
                  variant="secondary"
                  size="sm"
                  className="mt-1"
                  disabled={marcando !== null}
                  onClick={() => marcarRevisada(p.id)}
                >
                  {marcando === p.id ? "Marcando…" : "Marcar como revisada"}
                </Btn>
              </li>
            );
          })}
          {pending.length > 4 ? (
            <li className={orto.vacioLinea}>Y {pending.length - 4} más por revisar.</li>
          ) : null}
        </ul>
      ) : null}
      {fallo ? (
        <p role="alert" className={`${orto.tonoAlerta} mt-1 text-xs font-semibold`}>
          {fallo}
        </p>
      ) : null}
    </div>
  );
}
