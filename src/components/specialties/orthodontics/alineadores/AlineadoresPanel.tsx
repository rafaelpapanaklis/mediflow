"use client";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026).
// Ranura NUEVA en el compositor (mismo patrón que ResumenCobranza de la
// Ola 0): self-fetch, se calla si no hay caso de alineadores Y no hay
// cumplimiento registrado. H12 (seguimiento) + H14 (cumplimiento de
// elásticos, vista de clínica) + H15 (bandeja de fotos de monitoreo).

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
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

export interface AlineadoresPanelProps {
  treatmentPlanId: string;
}

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
      <Card eyebrow="Ortodoncia" title="Alineadores y cumplimiento" accent="violet">
        <div className="px-6 py-8 text-center">
          <p className="text-xs text-slate-500 mb-3 dark:text-slate-400">
            Este caso no tiene alineadores configurados todavía.
          </p>
          <Btn size="sm" onClick={() => setShowSetup(true)}>
            Configurar alineadores
          </Btn>
        </div>
      </Card>
    );
  }

  return (
    <Card eyebrow="Ortodoncia" title="Alineadores y cumplimiento" accent="violet">
      <div className="px-6 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
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

  if (showSetup && !aligner) {
    return (
      <div>
        <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Seguimiento de alineadores</div>
        {error ? <p className="text-xs text-rose-600 mb-2">{error}</p> : null}
        <div className="space-y-2">
          <input
            placeholder="Sistema (ej. Invisalign, marca propia)"
            value={form.systemName}
            onChange={(e) => setForm({ ...form, systemName: e.target.value })}
            className="w-full text-xs border border-slate-200 rounded px-2 py-1 dark:bg-slate-800 dark:border-slate-700"
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Total de alineadores" value={form.totalTrays} onChange={(v) => setForm({ ...form, totalTrays: v })} />
            <NumberField label="Alineador actual" value={form.currentTray} onChange={(v) => setForm({ ...form, currentTray: v })} />
            <NumberField label="Cambio cada (días)" value={form.changeIntervalDays} onChange={(v) => setForm({ ...form, changeIntervalDays: v })} />
            <div>
              <label className="text-[10px] text-slate-400">Fecha de inicio</label>
              <input
                type="date"
                value={form.startedAt}
                onChange={(e) => setForm({ ...form, startedAt: e.target.value })}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1 dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
          </div>
          <Btn
            size="sm"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await upsertAlignerCase({ treatmentPlanId, ...form });
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
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Seguimiento de alineadores</div>
      <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100">
        {aligner.currentTray}
        <span className="text-sm text-slate-400 font-normal"> / {aligner.totalTrays}</span>
      </div>
      <Pill color={statusColor} size="xs">
        {aligner.isPastLastTray
          ? "Pasó el último alineador"
          : aligner.expectedTray === aligner.currentTray
            ? "Al día"
            : aligner.currentTray < aligner.expectedTray
              ? `Debería traer el ${aligner.expectedTray}`
              : `Va adelantado (esperado ${aligner.expectedTray})`}
      </Pill>
      <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        {aligner.refinementCount > 0 ? `${aligner.refinementCount} refinamiento(s) · ` : ""}
        {aligner.attachmentsLost > 0 ? `${aligner.attachmentsLost} attachment(s) perdido(s)` : "sin attachments perdidos"}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <QuickEventBtn treatmentPlanId={treatmentPlanId} eventType="TRAY_CHANGE" trayNumber={aligner.currentTray + 1} label="Cambió de alineador" onDone={onSaved} />
        <QuickEventBtn treatmentPlanId={treatmentPlanId} eventType="ATTACHMENT_LOST" label="Attachment perdido" onDone={onSaved} />
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
      variant="ghost"
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
  return (
    <div>
      <label className="text-[10px] text-slate-400">{label}</label>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full text-xs border border-slate-200 rounded px-2 py-1 dark:bg-slate-800 dark:border-slate-700"
      />
    </div>
  );
}

function ComplianceBlock({ compliance }: { compliance: ElasticsComplianceView | null }) {
  if (!compliance || compliance.loggedDays === 0) {
    return (
      <div>
        <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Cumplimiento de elásticos</div>
        <p className="text-xs text-slate-400">Sin registros todavía (paciente o recepción).</p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">
        Cumplimiento de elásticos ({compliance.windowDays} días)
      </div>
      <div className={`text-2xl font-semibold ${compliance.isLow ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
        {compliance.compliancePct}%
      </div>
      {compliance.avgHours !== null ? (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">Promedio {compliance.avgHours} h/día</div>
      ) : null}
      {compliance.isLow ? (
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3" /> Cumplimiento bajo
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
  if (photos.length === 0) {
    return (
      <div>
        <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Monitoreo del paciente</div>
        <p className="text-xs text-slate-400">Sin fotos enviadas desde el portal.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">
        Monitoreo del paciente {pending.length > 0 ? <Pill color="amber" size="xs">{pending.length} por revisar</Pill> : null}
      </div>
      <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
        {photos.slice(0, 8).map((p) => (
          <button
            key={p.id}
            type="button"
            className="relative aspect-square rounded overflow-hidden border border-slate-200 dark:border-slate-700"
            onClick={() => {
              if (p.reviewStatus === "PENDING") {
                reviewMonitoringPhoto({ photoId: p.id, treatmentPlanId, reviewStatus: "REVIEWED" }).then(onReviewed);
              }
            }}
            title={p.reviewStatus === "PENDING" ? "Clic para marcar como revisada" : p.reviewStatus}
          >
            {p.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-slate-100 dark:bg-slate-800" />
            )}
            <span className="absolute top-0.5 right-0.5">
              {p.reviewStatus === "PENDING" ? (
                <Circle className="w-3 h-3 text-amber-500 fill-amber-500" />
              ) : (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 fill-white" />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
