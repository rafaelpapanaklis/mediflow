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
import { useT, useLocale } from "@/i18n/i18n-provider";
import { derivePaymentForm } from "@/lib/invoice-totals";
import { usoCfdiPorRegimen } from "@/lib/invoices/cfdi-reglas";
import { cfdiAvisoPersistente } from "@/lib/cfdi-avisos";

export interface PaymentCfdiButtonProps {
  paymentId: string;
  /** La factura del pago: para preguntarle al servidor la forma de un «anticipo». */
  invoiceId?: string;
  amount: number;
  method: string | null;
  clinicTaxMode: string | null;
  defaultReceptor?: { rfc?: string | null; nombre?: string | null; regimen?: string | null; cp?: string | null; email?: string | null } | null;
  cfdi?: CfdiDePago;
  onStamped: () => void;
}

export function PaymentCfdiButton(props: PaymentCfdiButtonProps) {
  const t = useT();
  const locale = useLocale();
  const en = locale.startsWith("en");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bloqueado, setBloqueado] = useState<string | null>(null);
  // Un «no se puede» que dice qué hacer (retención, forma de pago): se queda en
  // el formulario en vez de irse en un toast.
  const [aviso, setAviso] = useState<string | null>(null);
  // ws1-t4, tanda 0: la forma sale de la regla compartida (null = Mercado Pago,
  // tarjeta sin tipo… → «Elige») en vez de una tabla propia que mandaba
  // Mercado Pago y «otro» a «03 transferencia»; el uso, del régimen.
  const [fiscal, setFiscal] = useState(() => ({
    rfc:       props.defaultReceptor?.rfc ?? "",
    nombre:    props.defaultReceptor?.nombre ?? "",
    regimen:   props.defaultReceptor?.regimen || "612",
    cp:        props.defaultReceptor?.cp ?? "",
    email:     props.defaultReceptor?.email ?? "",
    uso:       usoCfdiPorRegimen(props.defaultReceptor?.regimen || "612", props.defaultReceptor?.rfc),
    usoManual: false,
    formaPago: derivePaymentForm([{ method: props.method, amount: props.amount }]) ?? "",
    impuestos: (props.clinicTaxMode === "exempt" ? "exento" : "iva16") as "exento" | "iva16",
  }));
  // ws1-t10 (punto 9): el responsable de pago llega DESPUÉS de montar el botón
  // (lo pide el detalle de la factura); mientras el formulario está cerrado, los
  // datos por defecto lo siguen. Abierto, no se le pisa lo que el usuario teclee.
  const { rfc: rfcPorDefecto, nombre: nombrePorDefecto, regimen: regimenPorDefecto, cp: cpPorDefecto } = props.defaultReceptor ?? {};
  useEffect(() => {
    if (open) return;
    setFiscal((f) => ({
      ...f, rfc: rfcPorDefecto ?? "", nombre: nombrePorDefecto ?? "", regimen: regimenPorDefecto || "612", cp: cpPorDefecto ?? "",
      uso: f.usoManual ? f.uso : usoCfdiPorRegimen(regimenPorDefecto || "612", rfcPorDefecto),
    }));
  }, [open, rfcPorDefecto, nombrePorDefecto, regimenPorDefecto, cpPorDefecto]);

  // Un «anticipo» (saldo a favor) hereda la forma del dinero que lo formó: eso
  // lo sabe el servidor. Al abrir, si la forma sigue vacía, se le pregunta.
  const { invoiceId, paymentId } = props;
  useEffect(() => {
    if (!open || fiscal.formaPago || !invoiceId) return;
    let vivo = true;
    fetch(`/api/cfdi/forma-pago?invoiceId=${encodeURIComponent(invoiceId)}&paymentId=${encodeURIComponent(paymentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d?.forma) setFiscal((f) => (f.formaPago ? f : { ...f, formaPago: d.forma })); })
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId, paymentId]);

  if (props.cfdi) {
    const vigente = props.cfdi.status === "valid";
    return (
      <div className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
        {vigente ? (
          <>
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--success, #16a34a)" }}>
              <FileText size={12} aria-hidden /> {en ? "Invoiced" : "Facturado"}
            </span>
            {props.cfdi.pdfUrl && <a href={props.cfdi.pdfUrl} target="_blank" rel="noreferrer" className="underline">PDF</a>}
            {props.cfdi.xmlUrl && <a href={props.cfdi.xmlUrl} target="_blank" rel="noreferrer" className="underline">XML</a>}
          </>
        ) : (
          <span className="italic text-muted-foreground">{en ? "Invoicing…" : "Facturando…"}</span>
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
        <Receipt size={12} aria-hidden /> {en ? "Invoice this payment" : "Facturar este pago"}
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
    if (!fiscal.formaPago) {
      toast.error(en ? "Choose how the patient paid." : "Elige con qué pagó el paciente.");
      return;
    }
    setBusy(true);
    setAviso(null);
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
          setBloqueado(mensajeDeError(data, t, { estado: res.status, porDefecto: "El CFDI de este pago quedó en un estado incierto. No lo vuelvas a intentar." }));
          return;
        }
        if (cfdiAvisoPersistente(data.code) && typeof data.error === "string") {
          setAviso(data.error);
          return;
        }
        toast.error(mensajeDeError(data, t, { porDefecto: "No se pudo facturar este pago." }));
        return;
      }
      toast.success(`CFDI del pago timbrado: ${data.descripcion ?? ""}`.trim());
      // F-07: el SAT timbró otro importe que el del pago. Ya está emitido: se avisa
      // con tiempo para leerlo antes de entregarlo.
      if (data.warning?.message) toast.error(data.warning.message, { duration: 12000 });
      // F-21: el pago entró en otro mes que el del CFDI (solo se avisa).
      if (typeof data.avisoMes === "string") toast(data.avisoMes, { duration: 12000 });
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
      <div className="text-[11px] max-w-[420px] rounded-md border p-2" style={{ gridColumn: "1 / -1", borderColor: "var(--danger, #dc2626)", color: "var(--danger, #dc2626)" }}>
        {bloqueado}
      </div>
    );
  }

  return (
    // ws1-t4, tanda 0: abierto ocupa TODA la fila del pago (en el detalle con
    // rediseño la fila es una rejilla de dos columnas y el formulario caía en
    // la estrecha: el régimen no se leía). Fuera de una rejilla no cambia nada.
    <div className="text-[11px] space-y-1.5 border border-border rounded-md p-2 bg-muted/20 max-w-[420px]" style={{ gridColumn: "1 / -1" }} data-cfdi-pago-form>
      <div className="font-semibold">{en ? "Invoice" : "Facturar"} {fmtMXNdec(props.amount)}</div>
      <input
        placeholder="RFC"
        value={fiscal.rfc}
        onChange={(e) => setFiscal((f) => ({ ...f, rfc: e.target.value.toUpperCase(), uso: f.usoManual ? f.uso : usoCfdiPorRegimen(f.regimen, e.target.value) }))}
        className="w-full text-[11px] px-1.5 py-1 border border-border rounded"
      />
      <input
        placeholder={en ? "Legal name" : "Razón social / nombre"}
        value={fiscal.nombre}
        onChange={(e) => setFiscal((f) => ({ ...f, nombre: e.target.value }))}
        className="w-full text-[11px] px-1.5 py-1 border border-border rounded"
      />
      <div className="flex gap-1">
        <select
          aria-label={en ? "Tax regime" : "Régimen fiscal"}
          value={fiscal.regimen}
          onChange={(e) => setFiscal((f) => ({ ...f, regimen: e.target.value, uso: f.usoManual ? f.uso : usoCfdiPorRegimen(e.target.value, f.rfc) }))}
          className="flex-1 text-[11px] px-1 py-1 border border-border rounded"
          style={{ flex: "1 1 auto", minWidth: 0 }}
        >
          {REGIMENES_FISCALES.map((r) => <option key={r.clave} value={r.clave}>{r.clave} — {r.descripcion}</option>)}
        </select>
        <input
          placeholder="CP"
          value={fiscal.cp}
          onChange={(e) => setFiscal((f) => ({ ...f, cp: e.target.value }))}
          className="w-16 text-[11px] px-1.5 py-1 border border-border rounded"
          // Las hojas del detalle ponen width:100% a los <input>: sin esto el CP
          // se comía la fila y el régimen quedaba en una flechita.
          style={{ flex: "0 0 72px", width: 72 }}
          aria-label={en ? "ZIP code" : "Código postal"}
          inputMode="numeric"
          maxLength={5}
        />
      </div>
      <div className="flex gap-1">
        <select
          aria-label={en ? "CFDI use" : "Uso del CFDI"}
          value={fiscal.uso}
          onChange={(e) => setFiscal((f) => ({ ...f, uso: e.target.value, usoManual: true }))}
          className="flex-1 text-[11px] px-1 py-1 border border-border rounded"
        >
          {USOS_CFDI.map((u) => <option key={u.clave} value={u.clave}>{u.clave} — {u.descripcion}</option>)}
        </select>
        <select
          value={fiscal.formaPago}
          onChange={(e) => setFiscal((f) => ({ ...f, formaPago: e.target.value }))}
          className="flex-1 text-[11px] px-1 py-1 border border-border rounded"
          aria-label={en ? "Payment form" : "Forma de pago"}
          aria-invalid={!fiscal.formaPago || undefined}
          data-cfdi-forma-pago
        >
          {!fiscal.formaPago && <option value="" disabled>{en ? "How did they pay?" : "¿Con qué pagó?"}</option>}
          {FORMAS_PAGO_SAT.map((p) => <option key={p.clave} value={p.clave}>{p.clave} — {p.descripcion}</option>)}
        </select>
      </div>
      {aviso && (
        <p className="rounded border p-1.5" style={{ borderColor: "var(--warning-border-strong, #d97706)", color: "var(--warning-strong, #b45309)" }} data-cfdi-aviso-pago>
          {aviso}
        </p>
      )}
      <div className="flex items-center gap-2 pt-0.5">
        <button type="button" disabled={busy || !fiscal.formaPago} onClick={timbrar} className="text-[11px] font-semibold px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">
          {busy ? (en ? "Stamping…" : "Timbrando…") : (en ? "Stamp CFDI" : "Timbrar CFDI")}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-[11px] underline">
          {en ? "Cancel" : "Cancelar"}
        </button>
      </div>
    </div>
  );
}
