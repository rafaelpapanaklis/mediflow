"use client";

// «Facturar este pago» — CFDI PUE de UN pago (ws1-t1, sep-2026). Desde la
// auditoría de uso (ws1-t4, C-48) cualquier cobro, no solo los de una factura a
// plazos; el detalle de factura decide cuándo montarlo (solo a dueño/admin, C-46).
//
// Segunda auditoría de uso (resto de C-45 y C-47, N-21): tiene lo mismo que el formulario de la
// nota — «Paciente extranjero», clave e IVA de los conceptos, «Impuestos», «Mandársela al
// paciente» — con el receptor que de verdad va al CFDI (XAXX rellena «PUBLICO EN GENERAL»; un
// régimen que no aplica al RFC pasa a «Elige») y el monto NETO del cobro (sin lo devuelto).
//
// Deliberadamente autocontenido (su propio POST, su propio estado) en vez de
// meterse en el `SubAction` de `invoice-detail-modal.tsx`: ese archivo ya es
// grande y esto es aditivo — una fila de pago que no lo usa no cambia nada.

import { useEffect, useId, useState } from "react";
import toast from "react-hot-toast";
import { Receipt, FileText } from "lucide-react";
import { REGIMENES_FISCALES, USOS_CFDI, FORMAS_PAGO_SAT } from "@/lib/cfdi-catalogs";
import { fmtMXNdec } from "@/lib/format";
import type { CfdiDePago } from "@/components/dashboard/plan-de-pagos/use-pagos-cfdi";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { useT, useLocale } from "@/i18n/i18n-provider";
import { derivePaymentForm } from "@/lib/invoice-totals";
import { usoCfdiPorRegimen } from "@/lib/invoices/cfdi-reglas";
import { cfdiAvisoPersistente } from "@/lib/cfdi-avisos";
import { faltaEnReceptor, receptorAlElegirRegimen, receptorAlTeclearRfc } from "@/lib/cfdi/receptor";
import { AvisoMesDeCobroCfdi, pideConfirmarGlobal } from "./aviso-mes-cobro-cfdi";
import { AvisosEmisorAlTimbrar } from "./cfdi-avisos-emisor-timbrado";
import { CamposReceptorExtranjero, useReceptorExtranjero } from "./cfdi-receptor-extranjero";
import { ConceptosAlTimbrar } from "./cfdi-conceptos-al-timbrar";
import { OpcionesEnvioAlTimbrar, enviarTrasTimbrar, type EnvioAlTimbrar } from "./enviar-cfdi";
import { useCpEmisor } from "./uso-cfdi-cliente";

export interface PaymentCfdiButtonProps {
  paymentId: string;
  /** La factura del pago: para preguntarle al servidor la forma de un «anticipo». */
  invoiceId?: string;
  amount: number;
  method: string | null;
  /** C-49: cuándo entró (un cobro de un mes anterior pide confirmar lo de la factura global). */
  paidAt?: string | Date | null;
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
  // C-49: «no entró en la global de ese mes» y C-44: al emisor le falta algo para timbrar.
  const [fueraDeGlobal, setFueraDeGlobal] = useState(false);
  const [emisorIncompleto, setEmisorIncompleto] = useState(false);
  // C-49 / N-22: el servidor pide confirmar la global aunque la pantalla no lo sepa (un «anticipo»
  // entró cuando se cobró su origen): entonces sale la casilla junto a su aviso.
  const [pideGlobal, setPideGlobal] = useState(false);
  const pagoParaAviso = [{ paidAt: props.paidAt ?? null, method: props.method, amount: props.amount }];
  const faltaConfirmarGlobal = (pideGlobal || pideConfirmarGlobal(pagoParaAviso)) && !fueraDeGlobal;
  // N-21: lo NETO del cobro que se puede facturar (sin lo devuelto); null = todavía no se sabe.
  const [monto, setMonto] = useState<number | null>(null);
  const extranjero = useReceptorExtranjero(props.paymentId);
  const cpEmisor = useCpEmisor();
  const [envio, setEnvio] = useState<EnvioAlTimbrar>({ correo: false, whatsapp: false });
  const ids = useId();
  // ws1-t4, tanda 0: la forma sale de la regla compartida (null = Mercado Pago,
  // tarjeta sin tipo… → «Elige») en vez de una tabla propia que mandaba
  // Mercado Pago y «otro» a «03 transferencia»; el uso, del régimen.
  // C-47 (segunda auditoría): sin régimen capturado no se propone 612 («Elige»): la mayoría de
  // los pacientes asalariados son 605 y el régimen tiene que ser el de su constancia.
  const [fiscal, setFiscal] = useState(() => ({
    rfc:       props.defaultReceptor?.rfc ?? "",
    nombre:    props.defaultReceptor?.nombre ?? "",
    regimen:   props.defaultReceptor?.regimen || "",
    cp:        props.defaultReceptor?.cp ?? "",
    email:     props.defaultReceptor?.email ?? "",
    uso:       usoCfdiPorRegimen(props.defaultReceptor?.regimen || "", props.defaultReceptor?.rfc),
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
      ...f, rfc: rfcPorDefecto ?? "", nombre: nombrePorDefecto ?? "", regimen: regimenPorDefecto || "", cp: cpPorDefecto ?? "",
      uso: f.usoManual ? f.uso : usoCfdiPorRegimen(regimenPorDefecto || "", rfcPorDefecto),
    }));
  }, [open, rfcPorDefecto, nombrePorDefecto, regimenPorDefecto, cpPorDefecto]);

  // Un «anticipo» (saldo a favor) hereda la forma del dinero que lo formó: eso
  // lo sabe el servidor. Al abrir, si la forma sigue vacía, se le pregunta.
  const { invoiceId, paymentId } = props;
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    fetch(`/api/payments/${encodeURIComponent(paymentId)}/cfdi/monto`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && typeof d?.monto === "number") setMonto(d.monto); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [open, paymentId]);
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
        // N-26 (segunda auditoría): en el celular medía 110×15; ahora al menos 40 px de alto.
        style={{ color: "var(--orto-violeta, var(--primary))", minHeight: 40, padding: "0 4px" }}
      >
        <Receipt size={12} aria-hidden /> {en ? "Invoice this payment" : "Facturar este pago"}
      </button>
    );
  }

  // Lo que falta, dicho antes y junto al botón apagado (mismas reglas que el servidor).
  const faltaReceptor = extranjero.activo ? extranjero.error(fiscal.nombre.trim()) : faltaEnReceptor(fiscal, locale);
  const montoAFacturar = monto ?? props.amount;

  async function timbrar() {
    const rfc = fiscal.rfc.trim().toUpperCase();
    const nombre = fiscal.nombre.trim();
    const cp = fiscal.cp.trim();
    if (faltaReceptor) { toast.error(faltaReceptor); return; }
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
          receptor: extranjero.receptor({ rfc, nombre, regimenFiscal: fiscal.regimen, cp, email: fiscal.email.trim() || undefined }),
          usoCfdi: extranjero.usoForzado ?? fiscal.uso,
          paymentForm: fiscal.formaPago,
          taxMode: fiscal.impuestos,
          ...(fueraDeGlobal ? { confirmaFueraDeGlobal: true } : {}),
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
          if (data.code === "CFDI_CONFIRMAR_GLOBAL") setPideGlobal(true);
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
      if (typeof data.cfdiId === "string") void enviarTrasTimbrar(data.cfdiId, envio, fiscal.email, locale);
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

  const regimenes = REGIMENES_FISCALES;
  const desactivado = busy || !fiscal.formaPago || emisorIncompleto || faltaConfirmarGlobal || !!faltaReceptor || !(montoAFacturar > 0);
  // N-26: el porqué del botón apagado, a la vista (el primero que aplique).
  const porQue = !(montoAFacturar > 0)
    ? (en ? "Nothing of this payment is left to invoice (it was refunded or is already covered)." : "No queda nada de este cobro por facturar (se devolvió o ya está amparado).")
    : faltaReceptor
      ?? (!fiscal.formaPago ? (en ? "Choose the payment form." : "Elige la forma de pago.") : null)
      ?? (faltaConfirmarGlobal ? (en ? "Confirm the global-invoice box above." : "Marca la casilla de la factura global de arriba.") : null);
  const id = (k: string) => `${ids}-${k}`;
  const campo = "w-full text-[11px] px-1.5 py-1 border border-border rounded";
  return (
    // ws1-t4, tanda 0: abierto ocupa TODA la fila del pago (en el detalle con
    // rediseño la fila es una rejilla de dos columnas y el formulario caía en
    // la estrecha: el régimen no se leía). Fuera de una rejilla no cambia nada.
    <div className="text-[11px] space-y-1.5 border border-border rounded-md p-2 bg-muted/20 max-w-[420px]" style={{ gridColumn: "1 / -1" }} data-cfdi-pago-form>
      <div className="font-semibold" data-cfdi-pago-monto>
        {en ? "Invoice" : "Facturar"} {fmtMXNdec(montoAFacturar)}
        {monto !== null && monto + 0.005 < props.amount && (
          <span className="font-normal" style={{ color: "var(--text-3)" }}>
            {" "}{en ? `(of ${fmtMXNdec(props.amount)} collected: the rest was refunded or is already invoiced)` : `(de ${fmtMXNdec(props.amount)} cobrados: lo demás se devolvió o ya está facturado)`}
          </span>
        )}
      </div>
      <AvisosEmisorAlTimbrar onBloqueo={setEmisorIncompleto} rfcReceptor={extranjero.activo ? null : fiscal.rfc} />
      <AvisoMesDeCobroCfdi
        pagos={pagoParaAviso}
        confirmado={fueraDeGlobal}
        onConfirmar={setFueraDeGlobal}
        className="rounded border p-1.5"
        style={{ borderColor: "var(--warning-border-strong)", color: "var(--warning-strong)" }}
      />
      <ConceptosAlTimbrar invoiceId={invoiceId} taxMode={fiscal.impuestos}
        titulo={en ? "Key and VAT of the invoice items (the payment CFDI takes the first one):" : "Clave e IVA de los conceptos de la nota (el CFDI del pago lleva la del primero):"}
        className="rounded border p-1.5" style={{ borderColor: "var(--warning-border-strong)", color: "var(--warning-strong)" }} />
      <CamposReceptorExtranjero ext={extranjero} idBase={id("ext")} />
      {!extranjero.activo && (
        <div className="space-y-0.5">
          <label htmlFor={id("rfc")} className="font-medium">RFC</label>
          <input id={id("rfc")} value={fiscal.rfc} maxLength={13}
            onChange={(e) => setFiscal((f) => receptorAlTeclearRfc(f, e.target.value, cpEmisor))}
            className={campo} />
        </div>
      )}
      <div className="space-y-0.5">
        <label htmlFor={id("nombre")} className="font-medium">{en ? "Legal name" : "Razón social / nombre"}</label>
        <input id={id("nombre")} value={fiscal.nombre} onChange={(e) => setFiscal((f) => ({ ...f, nombre: e.target.value }))} className={campo} />
      </div>
      {!extranjero.activo && (
        <div className="flex gap-1">
          <div className="space-y-0.5" style={{ flex: "1 1 auto", minWidth: 0 }}>
            <label htmlFor={id("regimen")} className="font-medium">{en ? "Tax regime" : "Régimen fiscal"}</label>
            <select id={id("regimen")} value={fiscal.regimen}
              onChange={(e) => setFiscal((f) => receptorAlElegirRegimen(f, e.target.value))}
              className={campo}>
              {!fiscal.regimen && <option value="" disabled>{en ? "Choose (it's on their tax certificate)…" : "Elige (viene en su constancia)…"}</option>}
              {regimenes.map((r) => <option key={r.clave} value={r.clave}>{r.clave} — {r.descripcion}</option>)}
            </select>
          </div>
          <div className="space-y-0.5" style={{ flex: "0 0 72px", width: 72 }}>
            <label htmlFor={id("cp")} className="font-medium">CP</label>
            <input id={id("cp")} value={fiscal.cp} inputMode="numeric" maxLength={5}
              onChange={(e) => setFiscal((f) => ({ ...f, cp: e.target.value.replace(/\D/g, "") }))}
              // Las hojas del detalle ponen width:100% a los <input>: sin esto el CP
              // se comía la fila y el régimen quedaba en una flechita.
              className={campo} style={{ width: 72 }} />
          </div>
        </div>
      )}
      <div className="flex gap-1">
        {!extranjero.activo && (
          <div className="space-y-0.5" style={{ flex: "1 1 0", minWidth: 0 }}>
            <label htmlFor={id("uso")} className="font-medium">{en ? "CFDI use" : "Uso del CFDI"}</label>
            <select id={id("uso")} value={fiscal.uso}
              onChange={(e) => setFiscal((f) => ({ ...f, uso: e.target.value, usoManual: true }))}
              className={campo}>
              {USOS_CFDI.map((u) => <option key={u.clave} value={u.clave}>{u.clave} — {u.descripcion}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-0.5" style={{ flex: "1 1 0", minWidth: 0 }}>
          <label htmlFor={id("forma")} className="font-medium">{en ? "Payment form" : "Forma de pago"}</label>
          <select id={id("forma")} value={fiscal.formaPago}
            onChange={(e) => setFiscal((f) => ({ ...f, formaPago: e.target.value }))}
            className={campo} aria-invalid={!fiscal.formaPago || undefined} data-cfdi-forma-pago>
            {!fiscal.formaPago && <option value="" disabled>{en ? "How did they pay?" : "¿Con qué pagó?"}</option>}
            {FORMAS_PAGO_SAT.map((p) => <option key={p.clave} value={p.clave}>{p.clave} — {p.descripcion}</option>)}
          </select>
        </div>
      </div>
      <div className="flex gap-1">
        <div className="space-y-0.5" style={{ flex: "1 1 0", minWidth: 0 }}>
          <label htmlFor={id("iva")} className="font-medium">{en ? "Taxes" : "Impuestos"}</label>
          <select id={id("iva")} value={fiscal.impuestos}
            onChange={(e) => setFiscal((f) => ({ ...f, impuestos: e.target.value as "exento" | "iva16" }))} className={campo}>
            <option value="exento">{en ? "VAT exempt (medical services)" : "Exento (servicios médicos)"}</option>
            <option value="iva16">{en ? "16% VAT" : "IVA 16%"}</option>
          </select>
        </div>
        <div className="space-y-0.5" style={{ flex: "1 1 0", minWidth: 0 }}>
          <label htmlFor={id("correo")} className="font-medium">{en ? "Email (optional)" : "Correo (opcional)"}</label>
          <input id={id("correo")} type="email" value={fiscal.email} onChange={(e) => setFiscal((f) => ({ ...f, email: e.target.value }))} className={campo} />
        </div>
      </div>
      <OpcionesEnvioAlTimbrar valor={envio} onChange={setEnvio} hayCorreo={!!fiscal.email.trim()} />
      {aviso && (
        <div className="rounded border p-1.5" style={{ borderColor: "var(--warning-border-strong, #d97706)", color: "var(--warning-strong, #b45309)" }} data-cfdi-aviso-pago>
          <p style={{ margin: 0 }}>{aviso}</p>
          {pideGlobal && (
            <label className="flex items-start gap-1.5 mt-1" data-cfdi-confirmar-global>
              <input type="checkbox" checked={fueraDeGlobal} onChange={(e) => setFueraDeGlobal(e.target.checked)} />
              <span>{en ? "Yes: I confirm it was NOT included in that global invoice." : "Sí: confirmo que NO entró en esa factura global."}</span>
            </label>
          )}
        </div>
      )}
      {porQue && <p data-cfdi-pago-porque style={{ color: "var(--text-3)", margin: 0 }}>{porQue}</p>}
      <div className="flex items-center gap-2 pt-0.5">
        <button type="button" disabled={desactivado} onClick={timbrar} className="text-[11px] font-semibold px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50" style={{ minHeight: 36 }}>
          {busy ? (en ? "Stamping…" : "Timbrando…") : (en ? "Stamp CFDI" : "Timbrar CFDI")}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-[11px] underline" style={{ minHeight: 36 }}>
          {en ? "Cancel" : "Cancelar"}
        </button>
      </div>
    </div>
  );
}
