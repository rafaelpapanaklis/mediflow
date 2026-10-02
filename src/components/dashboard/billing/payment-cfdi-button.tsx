"use client";

// «Facturar este pago» — CFDI PUE de UN pago de una factura a plazos
// (ws1-t1, sep-2026). Solo se pinta junto a pagos de una factura "a plazos"
// (el detalle de factura decide cuándo montarlo, con `condicionesPago`).
//
// Deliberadamente autocontenido (su propio POST, su propio estado) en vez de
// meterse en el `SubAction` de `invoice-detail-modal.tsx`: ese archivo ya es
// grande y esto es aditivo — una fila de pago que no lo usa no cambia nada.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Receipt, Download, FileText } from "lucide-react";
import { REGIMENES_FISCALES, USOS_CFDI, FORMAS_PAGO_SAT } from "@/lib/cfdi-catalogs";
import { fmtMXNdec } from "@/lib/format";
import type { CfdiDePago } from "@/components/dashboard/plan-de-pagos/use-pagos-cfdi";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { useT } from "@/i18n/i18n-provider";

export interface PaymentCfdiButtonProps {
  paymentId: string;
  amount: number;
  method: string | null;
  clinicTaxMode: string | null;
  defaultReceptor?: { rfc?: string | null; nombre?: string | null; regimen?: string | null; cp?: string | null; email?: string | null } | null;
  cfdi?: CfdiDePago;
  onStamped: () => void;
}

const METODO_A_FORMA_SAT: Record<string, string> = {
  cash: "01", debit: "28", credit: "04", transfer: "03", check: "02", other: "03", mercadopago: "03",
};

export function PaymentCfdiButton(props: PaymentCfdiButtonProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bloqueado, setBloqueado] = useState<string | null>(null);
  const [fiscal, setFiscal] = useState(() => ({
    rfc:       props.defaultReceptor?.rfc ?? "",
    nombre:    props.defaultReceptor?.nombre ?? "",
    regimen:   props.defaultReceptor?.regimen || "612",
    cp:        props.defaultReceptor?.cp ?? "",
    email:     props.defaultReceptor?.email ?? "",
    uso:       "D01",
    formaPago: METODO_A_FORMA_SAT[props.method ?? ""] ?? "03",
    impuestos: (props.clinicTaxMode === "exempt" ? "exento" : "iva16") as "exento" | "iva16",
  }));
  // ws1-t10 (punto 9): el responsable de pago llega DESPUÉS de montar el botón
  // (lo pide el detalle de la factura); mientras el formulario está cerrado, los
  // datos por defecto lo siguen. Abierto, no se le pisa lo que el usuario teclee.
  const { rfc: rfcPorDefecto, nombre: nombrePorDefecto, regimen: regimenPorDefecto, cp: cpPorDefecto } = props.defaultReceptor ?? {};
  useEffect(() => {
    if (open) return;
    setFiscal((f) => ({ ...f, rfc: rfcPorDefecto ?? "", nombre: nombrePorDefecto ?? "", regimen: regimenPorDefecto || "612", cp: cpPorDefecto ?? "" }));
  }, [open, rfcPorDefecto, nombrePorDefecto, regimenPorDefecto, cpPorDefecto]);

  if (props.cfdi) {
    const vigente = props.cfdi.status === "valid";
    return (
      <div className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
        {vigente ? (
          <>
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--success, #16a34a)" }}>
              <FileText size={12} aria-hidden /> Facturado
            </span>
            {props.cfdi.pdfUrl && <a href={props.cfdi.pdfUrl} target="_blank" rel="noreferrer" className="underline">PDF</a>}
            {props.cfdi.xmlUrl && <a href={props.cfdi.xmlUrl} target="_blank" rel="noreferrer" className="underline">XML</a>}
          </>
        ) : (
          <span className="italic text-muted-foreground">Facturando…</span>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold underline"
        style={{ color: "var(--orto-violeta, var(--primary))" }}
      >
        <Receipt size={12} aria-hidden /> Facturar este pago
      </button>
    );
  }

  async function timbrar() {
    const rfc = fiscal.rfc.trim().toUpperCase();
    const nombre = fiscal.nombre.trim();
    const cp = fiscal.cp.trim();
    if (!rfc || !nombre || !fiscal.regimen || !cp) {
      toast.error("Faltan datos fiscales del receptor (RFC, nombre, régimen, CP).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/payments/${props.paymentId}/cfdi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receptor: { rfc, nombre, regimenFiscal: fiscal.regimen, cp, email: fiscal.email.trim() || undefined },
          usoCfdi: fiscal.uso,
          paymentForm: fiscal.formaPago,
          taxMode: fiscal.impuestos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Igual que el timbrado de la factura completa: lo que diga que el
        // CFDI YA existe (o que no se sabe si existe) se queda en pantalla y
        // bloquea reintentar — un toast de 5s se perdería y un segundo click
        // pediría un segundo CFDI ante el SAT.
        if (data.code === "CFDI_TIMBRADO_SIN_GUARDAR" || data.code === "CFDI_TIMBRE_INCIERTO") {
          setBloqueado(data.error ?? "El CFDI de este pago quedó en un estado incierto. No lo vuelvas a intentar.");
          return;
        }
        toast.error(mensajeDeError(data, t, { porDefecto: "No se pudo facturar este pago." }));
        return;
      }
      toast.success(`CFDI del pago timbrado: ${data.descripcion ?? ""}`.trim());
      setOpen(false);
      props.onStamped();
    } catch (e: any) {
      toast.error(mensajeDeError(e, t, { porDefecto: "Error al facturar este pago." }));
    } finally {
      setBusy(false);
    }
  }

  if (bloqueado) {
    return (
      <div className="text-[11px] max-w-[260px] rounded-md border p-2" style={{ borderColor: "var(--danger, #dc2626)", color: "var(--danger, #dc2626)" }}>
        {bloqueado}
      </div>
    );
  }

  return (
    <div className="text-[11px] space-y-1.5 border border-border rounded-md p-2 bg-muted/20 max-w-[280px]">
      <div className="font-semibold">Facturar {fmtMXNdec(props.amount)}</div>
      <input
        placeholder="RFC"
        value={fiscal.rfc}
        onChange={(e) => setFiscal((f) => ({ ...f, rfc: e.target.value.toUpperCase() }))}
        className="w-full text-[11px] px-1.5 py-1 border border-border rounded"
      />
      <input
        placeholder="Razón social / nombre"
        value={fiscal.nombre}
        onChange={(e) => setFiscal((f) => ({ ...f, nombre: e.target.value }))}
        className="w-full text-[11px] px-1.5 py-1 border border-border rounded"
      />
      <div className="flex gap-1">
        <select
          value={fiscal.regimen}
          onChange={(e) => setFiscal((f) => ({ ...f, regimen: e.target.value }))}
          className="flex-1 text-[11px] px-1 py-1 border border-border rounded"
        >
          {REGIMENES_FISCALES.map((r) => <option key={r.clave} value={r.clave}>{r.clave} — {r.descripcion}</option>)}
        </select>
        <input
          placeholder="CP"
          value={fiscal.cp}
          onChange={(e) => setFiscal((f) => ({ ...f, cp: e.target.value }))}
          className="w-16 text-[11px] px-1.5 py-1 border border-border rounded"
        />
      </div>
      <div className="flex gap-1">
        <select
          value={fiscal.uso}
          onChange={(e) => setFiscal((f) => ({ ...f, uso: e.target.value }))}
          className="flex-1 text-[11px] px-1 py-1 border border-border rounded"
        >
          {USOS_CFDI.map((u) => <option key={u.clave} value={u.clave}>{u.clave} — {u.descripcion}</option>)}
        </select>
        <select
          value={fiscal.formaPago}
          onChange={(e) => setFiscal((f) => ({ ...f, formaPago: e.target.value }))}
          className="flex-1 text-[11px] px-1 py-1 border border-border rounded"
        >
          {FORMAS_PAGO_SAT.map((p) => <option key={p.clave} value={p.clave}>{p.clave} — {p.descripcion}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <button type="button" disabled={busy} onClick={timbrar} className="text-[11px] font-semibold px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">
          {busy ? "Timbrando…" : "Timbrar CFDI"}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-[11px] underline">
          Cancelar
        </button>
      </div>
    </div>
  );
}
