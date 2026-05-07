"use client";
// Sección I — Documentos & comunicación.
//
// 4 tabs: Lab orders (G18) / Consentimientos / Cartas referencia / WhatsApp log.
// LabOrder catalog ampliado con 8 chips clickeables al pie del tab Lab.

import { useState } from "react";
import { FileText, MoreHorizontal, Plus } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { fmtDate, fmtDateShort } from "../atoms/format";

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
}

const CATALOG_AMPLIADO = [
  "Alineadores serie 1-30",
  "Refinement 1-5",
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
  { id: "lab", label: "Lab orders", badge: "G18" },
  { id: "consent", label: "Consentimientos" },
  { id: "ref", label: "Cartas referencia" },
  { id: "wa", label: "WhatsApp log" },
];

export function SectionDocs(props: SectionDocsProps) {
  const [tab, setTab] = useState<TabKey>("lab");

  return (
    <Card id="docs" eyebrow="Sección I" title="Documentos & comunicación">
      <nav
        className="px-6 pt-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2 dark:border-slate-800"
        role="tablist"
        aria-label="Documentos"
      >
        <div className="flex gap-1 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors focus:outline-none ${
                tab === t.id
                  ? "border-violet-600 text-violet-700 font-medium dark:text-violet-300"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
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
            variant="primary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
            onClick={props.onNewLabOrder}
          >
            Nueva orden lab
          </Btn>
        ) : null}
      </nav>

      {tab === "lab" ? <LabOrdersPanel rows={props.labOrders} /> : null}
      {tab === "consent" ? <ConsentsPanel rows={props.consents} /> : null}
      {tab === "ref" ? (
        <ReferralPanel rows={props.referralLetters} onNew={props.onNewReferral} />
      ) : null}
      {tab === "wa" ? <WhatsAppPanel entries={props.whatsappLog} /> : null}
    </Card>
  );
}

function LabOrdersPanel({ rows }: { rows: LabOrderRow[] }) {
  return (
    <div className="p-6">
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500 italic dark:text-slate-400">
          Sin órdenes de laboratorio creadas.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className="text-left py-2 font-medium">Tipo</th>
                <th className="text-left py-2 font-medium">Descripción</th>
                <th className="text-left py-2 font-medium">Lab</th>
                <th className="text-left py-2 font-medium">Fecha</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-slate-50 hover:bg-slate-50/50 dark:border-slate-800/40 dark:hover:bg-slate-800/40"
                >
                  <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">
                    {o.catalog}
                  </td>
                  <td className="py-2.5 text-slate-600 dark:text-slate-400">
                    {o.description}
                  </td>
                  <td className="py-2.5 text-slate-600 dark:text-slate-400">{o.lab}</td>
                  <td className="py-2.5 text-slate-500 dark:text-slate-400">
                    {fmtDateShort(o.orderedAt)}
                  </td>
                  <td className="py-2.5">
                    <Pill color={STATUS_PILL[o.status]} size="xs">
                      {o.status}
                    </Pill>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      aria-label="Más opciones"
                    >
                      <MoreHorizontal className="w-4 h-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 bg-violet-50/40 border border-violet-100 rounded-lg p-4 dark:bg-violet-900/20 dark:border-violet-800">
        <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium mb-2 dark:text-violet-300">
          Catalog ampliado · G18
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 text-xs">
          {CATALOG_AMPLIADO.map((c) => (
            <Pill key={c} color="white" size="xs">
              {c}
            </Pill>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConsentsPanel({ rows }: { rows: ConsentRow[] }) {
  return (
    <div className="p-6">
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500 italic dark:text-slate-400">
          Sin consentimientos registrados todavía.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((c) => (
            <div
              key={c.name}
              className={`border rounded-lg p-3 ${
                c.signed
                  ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-900/20"
                  : "border-amber-200 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-900/20"
              }`}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {c.name}
                </div>
                <Pill color={c.signed ? "emerald" : "amber"} size="xs">
                  {c.signed ? "Firmado" : "Pendiente"}
                </Pill>
              </div>
              <div className="text-[11px] text-slate-600 mb-1 dark:text-slate-400">
                {c.risks}
              </div>
              {c.date ? (
                <div className="text-[10px] text-slate-400 dark:text-slate-500">
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
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        <div className="border border-dashed border-slate-200 rounded-lg p-8 text-center dark:border-slate-700">
          <FileText
            className="w-6 h-6 text-slate-300 mx-auto mb-2 dark:text-slate-600"
            aria-hidden
          />
          <div className="text-slate-700 font-medium dark:text-slate-300">
            Sin cartas de referencia generadas
          </div>
          <div className="text-xs text-slate-400 mt-1 dark:text-slate-500">
            Generar carta para periodoncista, endodoncista o cirujano maxilofacial.
          </div>
          {onNew ? (
            <Btn
              variant="violet-soft"
              size="sm"
              className="mt-3"
              icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
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
    <div className="p-6 space-y-2">
      {rows.map((r) => (
        <div
          key={r.id}
          className="border border-slate-200 rounded-lg p-3 flex items-start justify-between gap-3 dark:border-slate-700"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Para {r.recipient}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
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
            <div className="text-[10px] text-slate-400 mt-1 dark:text-slate-500">
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
      <div className="p-6 text-sm text-slate-500 italic dark:text-slate-400">
        Sin mensajes WhatsApp registrados todavía.
      </div>
    );
  }
  return (
    <div className="p-6">
      <div className="space-y-2">
        {entries.map((w) => (
          <div
            key={w.id}
            className={`flex items-start gap-3 border border-slate-200 rounded-lg p-3 dark:border-slate-700 ${
              w.direction === "in"
                ? "bg-emerald-50/40 dark:bg-emerald-900/10"
                : "bg-white dark:bg-slate-900"
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                w.direction === "in"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
              }`}
              aria-hidden
            >
              <FileText className="w-4 h-4" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                  {w.direction === "in"
                    ? w.patientName ?? "Paciente"
                    : "MediFlow → paciente"}
                </span>
                {w.template ? (
                  <Pill color="violet" size="xs">
                    {w.template}
                  </Pill>
                ) : null}
                <span className="text-[11px] text-slate-400 ml-auto dark:text-slate-500">
                  {w.at}
                </span>
              </div>
              <div className="text-sm text-slate-700 dark:text-slate-300">{w.preview}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
