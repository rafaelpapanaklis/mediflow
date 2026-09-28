"use client";
// Sección I — Documentos & comunicación.
//
// 4 tabs: Lab orders (G18) / Consentimientos / Cartas referencia / WhatsApp log.
// LabOrder catalog ampliado con 8 chips clickeables al pie del tab Lab.

import { useState } from "react";
import { ExternalLink, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { fmtDate, fmtDateShort } from "../atoms/format";
import orto from "../orto.module.css";

export interface LabOrderRow {
  id: string;
  catalog: string;
  description: string;
  lab: string;
  orderedAt: string | null;
  status: "borrador" | "enviada" | "en proceso" | "recibida" | "cancelada";
}

export interface ConsentRow {
  name: string;
  signed: boolean;
  date: string | null;
  risks: string;
}

export interface ReferralLetterRow {
  id: string;
  recipient: string;
  reason: string;
  sentAt: string | null;
  status: "borrador" | "enviada" | "en proceso";
}

export interface WhatsAppLogEntry {
  id: string;
  at: string;
  direction: "in" | "out";
  template: string | null;
  preview: string;
  patientName?: string;
}

export interface SectionDocsProps {
  labOrders: LabOrderRow[];
  consents: ConsentRow[];
  referralLetters: ReferralLetterRow[];
  whatsappLog: WhatsAppLogEntry[];
  onNewLabOrder?: () => void;
  onNewReferral?: () => void;
  /**
   * El caso (plan de tratamiento). Con él salen los PDFs del caso: «PDF del
   * plan de tratamiento» y «Reporte de avance (PDF)», que abren sus rutas
   * (`/api/orthodontics/treatment-plans/<id>/…`) en pestaña nueva.
   */
  treatmentPlanId?: string | null;
  /**
   * `null` = el reporte de avance se puede abrir; un texto = sale deshabilitado
   * con ese motivo (hace falta el juego T0 y uno posterior).
   */
  motivoSinReporteDeAvance?: string | null;
}

const CATALOG_AMPLIADO = [
  "Alineadores serie 1-30",
  "Refinamiento 1-5",
  "Retenedor Hawley sup/inf",
  "Retenedor Essix sup/inf",
  "Retenedor fijo lingual 3-3",
  "Expansor RPE Hyrax",
  "Expansor Quad-Helix",
  "Modelos estudio digital",
];

const STATUS_PILL: Record<LabOrderRow["status"], "emerald" | "slate" | "amber" | "rose" | "violet"> = {
  recibida: "emerald",
  enviada: "violet",
  "en proceso": "amber",
  borrador: "slate",
  cancelada: "rose",
};

type TabKey = "lab" | "consent" | "ref" | "wa";

const TABS: ReadonlyArray<{ id: TabKey; label: string; badge?: string }> = [
  { id: "lab", label: "Laboratorio" },
  { id: "consent", label: "Consentimientos" },
  { id: "ref", label: "Cartas de referencia" },
  { id: "wa", label: "WhatsApp" },
];

export function SectionDocs(props: SectionDocsProps) {
  const [tab, setTab] = useState<TabKey>("lab");

  return (
    <Card
      id="docs"
      icon={<FileText size={15} strokeWidth={1.75} />}
      title="Documentos y comunicación"
      eyebrow="Órdenes de laboratorio, consentimientos, cartas y mensajes"
    >
      <div className="px-[18px] pt-[14px] flex items-center justify-between flex-wrap gap-2">
        <div className={orto.segmento} role="tablist" aria-label="Documentos">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={[orto.segmentoBoton, tab === t.id ? orto.segmentoActivo : ""]
                .filter(Boolean)
                .join(" ")}
            >
              {t.label}
              {t.badge ? (
                <Pill color="violet" size="xs" className="ml-1.5">
                  {t.badge}
                </Pill>
              ) : null}
            </button>
          ))}
        </div>
        {tab === "lab" && props.onNewLabOrder ? (
          <Btn
            variant="violet-soft"
            size="sm"
            icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
            onClick={props.onNewLabOrder}
          >
            Nueva orden de laboratorio
          </Btn>
        ) : null}
      </div>

      {props.treatmentPlanId ? (
        <PdfsDelCaso
          treatmentPlanId={props.treatmentPlanId}
          motivoSinReporteDeAvance={props.motivoSinReporteDeAvance ?? null}
        />
      ) : null}

      {tab === "lab" ? <LabOrdersPanel rows={props.labOrders} /> : null}
      {tab === "consent" ? <ConsentsPanel rows={props.consents} /> : null}
      {tab === "ref" ? (
        <ReferralPanel rows={props.referralLetters} onNew={props.onNewReferral} />
      ) : null}
      {tab === "wa" ? <WhatsAppPanel entries={props.whatsappLog} /> : null}
    </Card>
  );
}

/** Rutas de los PDFs del caso. Exportadas para los tests. */
export function rutaPdfDelPlan(treatmentPlanId: string): string {
  return `/api/orthodontics/treatment-plans/${encodeURIComponent(treatmentPlanId)}/treatment-plan-pdf`;
}
export function rutaReporteDeAvance(treatmentPlanId: string): string {
  return `/api/orthodontics/treatment-plans/${encodeURIComponent(treatmentPlanId)}/progress-report-pdf`;
}

function abrirEnPestanaNueva(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function PdfsDelCaso({
  treatmentPlanId,
  motivoSinReporteDeAvance,
}: {
  treatmentPlanId: string;
  motivoSinReporteDeAvance: string | null;
}) {
  return (
    <div className="px-[18px] pt-[12px]">
      <div className={`${orto.ceja} mb-2`}>PDFs del caso</div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          variant="secondary"
          size="sm"
          icon={<ExternalLink size={14} strokeWidth={1.75} aria-hidden />}
          onClick={() => abrirEnPestanaNueva(rutaPdfDelPlan(treatmentPlanId))}
        >
          PDF del plan de tratamiento
        </Btn>
        <Btn
          variant="secondary"
          size="sm"
          icon={<ExternalLink size={14} strokeWidth={1.75} aria-hidden />}
          disabled={motivoSinReporteDeAvance !== null}
          title={motivoSinReporteDeAvance ?? undefined}
          aria-describedby={motivoSinReporteDeAvance ? "orto-docs-motivo-avance" : undefined}
          onClick={() => abrirEnPestanaNueva(rutaReporteDeAvance(treatmentPlanId))}
        >
          Reporte de avance (PDF)
        </Btn>
      </div>
      {motivoSinReporteDeAvance ? (
        <p id="orto-docs-motivo-avance" className="mt-[6px] text-xs text-[color:var(--pr-texto-3)]">
          Reporte de avance: {motivoSinReporteDeAvance.charAt(0).toLowerCase() + motivoSinReporteDeAvance.slice(1)}.
        </p>
      ) : null}
    </div>
  );
}

function LabOrdersPanel({ rows }: { rows: LabOrderRow[] }) {
  return (
    <div className="p-[18px]">
      {rows.length === 0 ? (
        <div className={orto.vacioLinea}>Aún no hay órdenes de laboratorio para este caso.</div>
      ) : (
        <div className={`${orto.tablaCaja} border border-[color:var(--pr-borde-suave)] rounded-[10px]`}>
          <table className={`${orto.tabla} ${orto.tablaDensa}`} style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Descripción</th>
                <th>Laboratorio</th>
                <th>Fecha</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="font-semibold">{o.catalog}</td>
                  <td className={orto.tonoTexto2}>{o.description}</td>
                  <td className={orto.tonoTexto2}>{o.lab}</td>
                  <td className={`${orto.tonoApagado} whitespace-nowrap`}>
                    {fmtDateShort(o.orderedAt)}
                  </td>
                  <td>
                    <Pill color={STATUS_PILL[o.status]} size="xs">
                      {o.status}
                    </Pill>
                  </td>
                  {/* El botón «···» de cada fila no tenía acción conectada: se
                      deja de pintar hasta que exista el menú. */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-[14px]">
        <div className={`${orto.ceja} mb-2`}>Qué se puede pedir</div>
        <div className="flex flex-wrap gap-[5px]">
          {CATALOG_AMPLIADO.map((c) => (
            <Pill key={c} color="slate">
              {c}
            </Pill>
          ))}
        </div>
      </div>
      {/* H53: los pedidos a laboratorios de la plataforma viven en otra lista. */}
      <p className="mt-[12px] text-xs text-[color:var(--pr-texto-2)]">
        Aquí se guardan las órdenes de ortodoncia. Los pedidos enviados a un laboratorio de la plataforma están en{" "}
        <Link href="/dashboard/ordenes-laboratorio" className={orto.enlace}>
          Órdenes de laboratorio
        </Link>
        .
      </p>
    </div>
  );
}

function ConsentsPanel({ rows }: { rows: ConsentRow[] }) {
  return (
    <div className="p-[18px]">
      {rows.length === 0 ? (
        <div className={orto.vacioLinea}>Sin consentimientos registrados todavía.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((c) => (
            <div
              key={c.name}
              className={`${orto.caja} ${c.signed ? "" : orto.cajaAlerta}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-[13px] font-semibold text-[color:var(--pr-texto)]">
                  {c.name}
                </div>
                <Pill color={c.signed ? "emerald" : "amber"} size="xs">
                  {c.signed ? "Firmado" : "Pendiente"}
                </Pill>
              </div>
              <div className="text-xs text-[color:var(--pr-texto-2)] mb-1">
                {c.risks}
              </div>
              {c.date ? (
                <div className="text-[11px] text-[color:var(--pr-texto-3)]">
                  {fmtDate(c.date)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReferralPanel({
  rows,
  onNew,
}: {
  rows: ReferralLetterRow[];
  onNew?: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="p-[18px]">
        <div className={orto.vacio}>
          <span className={orto.vacioIcono} aria-hidden>
            <FileText size={17} strokeWidth={1.75} />
          </span>
          <p className={orto.vacioTitulo}>Sin cartas de referencia</p>
          <p className={orto.vacioPista}>
            Para enviar al paciente con el periodoncista, el endodoncista o el cirujano
            maxilofacial.
          </p>
          {onNew ? (
            <Btn
              variant="secondary"
              size="sm"
              className="mt-1"
              icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
              onClick={onNew}
            >
              Nueva carta de referencia
            </Btn>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="p-[18px] space-y-2">
      {rows.map((r) => (
        <div
          key={r.id}
          className={`${orto.caja} flex items-start justify-between gap-3`}
        >
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[color:var(--pr-texto)]">
              Para {r.recipient}
            </div>
            <div className="text-[11px] text-[color:var(--pr-texto-3)]">
              {r.reason}
            </div>
          </div>
          <div className="text-right">
            <Pill
              color={r.status === "enviada" ? "emerald" : r.status === "en proceso" ? "amber" : "slate"}
              size="xs"
            >
              {r.status}
            </Pill>
            <div className="text-[11px] text-[color:var(--pr-texto-3)] mt-1">
              {fmtDateShort(r.sentAt)}
            </div>
          </div>
        </div>
      ))}
      {onNew ? (
        <Btn
          variant="violet-soft"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
          onClick={onNew}
        >
          Nueva carta
        </Btn>
      ) : null}
    </div>
  );
}

function WhatsAppPanel({ entries }: { entries: WhatsAppLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className={`p-[18px] ${orto.vacioLinea}`}>
        Todavía no hay mensajes de WhatsApp con este paciente.
      </div>
    );
  }
  return (
    <div className="p-[18px]">
      <div className="space-y-2">
        {entries.map((w) => (
          <div
            key={w.id}
            className={`${orto.caja} flex items-start gap-3`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                w.direction === "in"
                  ? "bg-[color:var(--pr-exito-suave)] text-[color:var(--pr-exito)]"
                  : "bg-[color:var(--pr-activo-suave)] text-[color:var(--orto-violeta)]"
              }`}
              aria-hidden
            >
              <FileText className="w-4 h-4" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="text-xs font-semibold text-[color:var(--pr-texto)]">
                  {w.direction === "in"
                    ? w.patientName ?? "Paciente"
                    : "DaleControl → paciente"}
                </span>
                {w.template ? (
                  <Pill color="violet" size="xs">
                    {w.template}
                  </Pill>
                ) : null}
                <span className="text-[11px] text-[color:var(--pr-texto-3)] ml-auto">
                  {w.at}
                </span>
              </div>
              <div className="text-[13px] text-[color:var(--pr-texto-2)]">{w.preview}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
