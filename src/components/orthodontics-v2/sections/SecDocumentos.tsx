// Sección H · Documentos & comunicación — 4 tabs (consent/refer/lab/WA).

"use client";

import { useState } from "react";
import { FileText, Send, Layers, MessageCircle, Plus, MoreHorizontal } from "lucide-react";
import type { OrthoCaseBundle } from "@/lib/orthodontics-v2/types";

interface SecDocumentosProps {
  bundle: OrthoCaseBundle;
  onCmd: (cmd: string) => void;
}

type TabKey = "consent" | "refer" | "lab" | "wa";

const TABS: Array<{ k: TabKey; label: string; Icon: typeof FileText }> = [
  { k: "consent", label: "Consentimientos", Icon: FileText },
  { k: "refer", label: "Cartas referencia", Icon: Send },
  { k: "lab", label: "Lab orders", Icon: Layers },
  { k: "wa", label: "WhatsApp log", Icon: MessageCircle },
];

const LAB_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Borrador", cls: "bg-muted text-muted-foreground" },
  SENT: { label: "Enviada", cls: "bg-amber-100 text-amber-700" },
  RECEIVED: { label: "Recibida", cls: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "Cancelada", cls: "bg-rose-100 text-rose-700" },
};

export function SecDocumentos({ bundle, onCmd }: SecDocumentosProps) {
  const [tab, setTab] = useState<TabKey>("consent");
  const consents = bundle.documents.filter((d) => d.kind === "CONSENT");
  const refers = bundle.documents.filter((d) => d.kind === "REFERRAL_LETTER");
  const labs = bundle.labOrders;
  const comms = bundle.comms;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Documentos y comunicación</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Consentimientos · cartas · lab orders · log WhatsApp
          </p>
        </div>
        <button
          onClick={() => onCmd(`drawer-new-${tab}`)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600"
        >
          <Plus className="h-3 w-3" /> Nuevo
        </button>
      </div>

      <div className="flex w-fit gap-1 rounded-xl bg-muted p-1">
        {TABS.map(({ k, label, Icon }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
              tab === k ? "bg-blue-500 text-white" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {tab === "consent" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Título</th>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Firmado</th>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Estado</th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {consents.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{d.title}</td>
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">
                    {d.signedAt ? new Date(d.signedAt).toLocaleDateString("es-MX") : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {d.signedAt ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">
                        Firmado
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                        Pendiente firma
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="rounded-md p-1 hover:bg-muted">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {consents.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    Sin consentimientos generados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "refer" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Destinatario</th>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Creada</th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {refers.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{d.title}</td>
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">
                    {new Date(d.createdAt).toLocaleDateString("es-MX")}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="rounded-md p-1 hover:bg-muted">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {refers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                    Sin cartas de referencia.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "lab" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Producto</th>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Lab</th>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Tracking</th>
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase">Estado</th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {labs.map((l) => {
                const st = LAB_STATUS_LABEL[l.status] ?? LAB_STATUS_LABEL.DRAFT;
                return (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium">{l.itemLabel}</td>
                    <td className="px-4 py-2.5">{l.labPartner}</td>
                    <td className="px-4 py-2.5 font-mono">{l.trackingCode ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="rounded-md p-1 hover:bg-muted">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {labs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    Sin lab orders.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "wa" && (
        <div className="rounded-2xl border border-border bg-muted/30 p-4 shadow-sm">
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {comms.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.direction === "OUT" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-3 py-2 ${
                    m.direction === "OUT"
                      ? "bg-card border border-border"
                      : "bg-blue-500 text-white"
                  }`}
                >
                  <div className="text-xs">{m.body}</div>
                  <div className="mt-1 font-mono text-[9px] opacity-60">
                    {new Date(m.sentAt).toLocaleString("es-MX", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
            {comms.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Sin mensajes en log.
              </p>
            )}
          </div>
          <div className="mt-2.5 rounded-md border border-dashed border-border bg-card p-2 text-center text-[11px] text-muted-foreground">
            Read-only · canal Twilio (Fase 2) — la clínica responde desde WhatsApp Business
          </div>
        </div>
      )}
    </div>
  );
}
