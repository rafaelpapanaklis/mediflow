"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { FileText, Download, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface Clinic {
  id: string;
  name: string;
  email: string | null;
  taxId: string | null;
  rfcEmisor: string | null;
  regimenFiscal: string | null;
  cpEmisor: string | null;
  city: string | null;
  address: string | null;
}

interface Props {
  paymentId: string;
  clinic: Clinic;
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  cfdiConfigured: boolean;
  cfdiInstructions: string;
}

export function CfdiClient({ paymentId, clinic, amount, currency, periodStart, periodEnd, cfdiConfigured, cfdiInstructions }: Props) {
  const [showInstructions, setShowInstructions] = useState(false);

  async function generate() {
    if (!cfdiConfigured) { setShowInstructions(true); return; }
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/cfdi`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        if (err.instructions) { setShowInstructions(true); return; }
        throw new Error(err.error ?? "Error");
      }
      const data = await res.json();
      toast.success(`CFDI generado: ${data.uuid}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function downloadReceipt() {
    // Abre en nueva pestaña una vista imprimible; el usuario puede "Guardar como PDF"
    window.open(`/api/admin/payments/${paymentId}/receipt`, "_blank");
  }

  const missingFiscales = !clinic.rfcEmisor || !clinic.regimenFiscal || !clinic.cpEmisor;

  return (
    <div className="space-y-5">
      {/* Datos fiscales de la clínica */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
        <h2 className="text-sm font-bold mb-4">Datos fiscales de la clínica receptora</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-400 mb-1">Razón social / Nombre</div>
            <div className="font-semibold">{clinic.name}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">RFC emisor</div>
            <div className={`font-mono font-semibold ${clinic.rfcEmisor ? "text-emerald-400" : "text-rose-400"}`}>
              {clinic.rfcEmisor ?? "— falta configurar"}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Régimen fiscal</div>
            <div className={`font-semibold ${clinic.regimenFiscal ? "" : "text-rose-400"}`}>
              {clinic.regimenFiscal ?? "— falta configurar"}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">CP emisor</div>
            <div className={`font-mono font-semibold ${clinic.cpEmisor ? "" : "text-rose-400"}`}>
              {clinic.cpEmisor ?? "— falta configurar"}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Email</div>
            <div className="font-semibold">{clinic.email ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Ubicación</div>
            <div className="font-semibold">{[clinic.city, clinic.address].filter(Boolean).join(", ") || "—"}</div>
          </div>
        </div>
        {missingFiscales && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-rose-950/40 border border-rose-700 rounded-lg text-xs text-rose-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              Faltan datos fiscales obligatorios. Pídele al cliente que los complete en
              <code className="bg-slate-800 px-1 rounded mx-1">/dashboard/settings</code>
              antes de generar CFDI.
            </div>
          </div>
        )}
      </div>

      {/* Datos del pago */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
        <h2 className="text-sm font-bold mb-4">Detalle del pago</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-400 mb-1">Monto</div>
            <div className="text-2xl font-extrabold text-emerald-400">{formatCurrency(amount, currency)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Periodo</div>
            <div className="font-semibold">
              {new Date(periodStart).toLocaleDateString("es-MX")} → {new Date(periodEnd).toLocaleDateString("es-MX")}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={generate}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <FileText className="w-4 h-4" />
            Generar CFDI
          </button>
          <button
            onClick={downloadReceipt}
            className="flex items-center gap-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            Descargar recibo (no fiscal)
          </button>
        </div>
        <p className="text-xs text-slate-500">
          El recibo no fiscal es un comprobante informativo del pago, no sustituye al CFDI emitido ante el SAT.
        </p>
      </div>

      {/* Modal instrucciones cuando no hay PAC */}
      {showInstructions && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowInstructions(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-bold">Contrata un PAC primero</h2>
            </div>
            <pre className="whitespace-pre-wrap text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-4 leading-relaxed">{cfdiInstructions}</pre>
            <button onClick={() => setShowInstructions(false)} className="mt-4 w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-2 rounded-lg text-sm">
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
