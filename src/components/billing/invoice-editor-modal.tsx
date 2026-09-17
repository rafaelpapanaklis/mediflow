"use client";

// ÚNICO editor de facturas del panel: lo usan la ficha del paciente y Caja.
// Tiene la misma riqueza que el editor de presupuestos (QuoteEditor): tarifario
// + línea libre, descuento por línea y descuento global (% / monto), doctor
// atribuido, impuestos y totales en vivo. Reusa la matemática autoritativa de
// `@/lib/quotes/compute` (computeTotals/round2) y mapea al contrato de
// POST /api/invoices = { patientId, items:[{description,quantity,unitPrice,discount?,total}],
// discount, notes?, doctorId?, taxRate?, taxIncluded? }.
// El servidor recalcula subtotal/total/balance (y aplica IVA agregado si taxIncluded=false).
//
// El paciente puede venir FIJO (ficha) o elegirse aquí con el buscador (Caja):
// ver `patientId` vs `patients` en las props.

import { useState, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Plus, Loader2, Trash2, Check, Search, User } from "lucide-react";
import toast from "react-hot-toast";
import { computeTotals, round2 } from "@/lib/quotes/compute";
import { clinicInvoiceTaxDefaults, cfdiTotalBreakdown, IVA_RATE_PCT, type CfdiTaxMode } from "@/lib/invoice-totals";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useT } from "@/i18n/i18n-provider";
// Ropa del diseño nuevo (solo con `rediseno`). Ver dashboard/factura-rediseno/.
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
// Lo que Nueva factura toma de Presupuestos (solo con `rediseno`): forma de pago
// y envío al paciente. Ver dashboard/factura-ficha-rediseno/.
import { condicionesPorDefecto, hayCondiciones, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { FormaDePagoFactura, EnvioFactura, FraseDelTrato, type EnvioAlCrear } from "@/components/dashboard/factura-ficha-rediseno/forma-de-pago";
import { enviarFactura, guardarCondiciones, useContactoDePaciente } from "@/components/dashboard/factura-ficha-rediseno/extras";
import type { BorradorDeFactura } from "@/components/dashboard/factura-ficha-rediseno/datos";

/**
 * Descuento de línea tal y como VIAJA en el payload: clampeado al importe de la
 * línea. Lo usan el preview de totales y `save()`, y tiene que ser el mismo en
 * los dos o la pantalla vuelve a decir un número distinto del que se guarda: un
 * descuento de línea MAYOR que su línea daba base negativa en el preview y 0 en
 * el servidor (que recibe ya el valor clampeado).
 */
function lineDiscount(it: { unitPrice: number; quantity: number; discount: number }): number {
  return Math.min(it.discount, round2(it.unitPrice * it.quantity));
}

function money(n: number): string {
  const v = isFinite(Number(n)) ? Number(n) : 0;
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);
}

interface CatalogProcedure { id: string; name: string; basePrice: number; category?: string }
interface DoctorOption { id: string; name: string }

/** Paciente del buscador. Lo provee el server ya filtrado por clínica y visibilidad. */
export interface InvoiceEditorPatient {
  id: string;
  firstName: string;
  lastName: string;
  patientNumber?: number | string | null;
}

interface EditorItem {
  key: string;
  procedureId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

let _seq = 0;
function newKey(): string { _seq += 1; return `inv-it-${_seq}`; }

function patientLabel(p: InvoiceEditorPatient): string {
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "—";
  return p.patientNumber ? `#${p.patientNumber} — ${name}` : name;
}

export interface InvoiceEditorModalProps {
  open: boolean;
  /** Paciente FIJO (ficha del paciente). Omitir para que el editor muestre el buscador. */
  patientId?: string;
  patientName?: string;
  /** Catálogo del buscador cuando no hay paciente fijo (Caja). Ya viene acotado por clínica. */
  patients?: InvoiceEditorPatient[];
  /** Clinic.cfdiTaxMode ("exempt" | "iva16"): impuestos con los que NACE la factura. */
  clinicTaxMode?: string | null;
  onClose: () => void;
  /** Recibe la factura creada (shape de POST /api/invoices) para insertarla sin recargar. */
  onCreated: (invoice: any) => void;
  /**
   * Interruptor `menu-dos-niveles` (lo pasa quien monta el modal). `true` =
   * vestido con el diseño nuevo; `false` (por defecto) = las clases de
   * siempre, byte por byte. Los cálculos y el payload no cambian con él.
   */
  rediseno?: boolean;
  /**
   * «Duplicar» de la ficha de factura (solo el diseño nuevo lo pasa): el popup
   * abre con estos conceptos y este trato ya puestos. Sin él, abre vacío como
   * siempre. La factura se crea igual, por el mismo POST.
   */
  inicial?: BorradorDeFactura | null;
}

export function InvoiceEditorModal({ open, patientId, patientName, patients, clinicTaxMode, onClose, onCreated, rediseno = false, inicial = null }: InvoiceEditorModalProps) {
  // Solo el diseño nuevo lo enciende, y solo mientras guarda el trato o envía al
  // paciente DESPUÉS de crear: en ese rato el popup no se cierra (ni Esc, ni
  // clic fuera, ni «Cancelar»). Si se cerrara, el `onCreated` que llega al
  // terminar cerraría el popup que se hubiera abierto entre tanto.
  const ocupado = useRef(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !ocupado.current) onClose(); }}>
      <DialogContent className={rediseno ? `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalAncho}` : "max-w-2xl"}>
        {/* El cuerpo se monta de cero en cada apertura → el formulario nunca queda con estado viejo. */}
        <InvoiceEditorBody
          patientId={patientId}
          patientName={patientName}
          patients={patients}
          clinicTaxMode={clinicTaxMode}
          onClose={onClose}
          onCreated={onCreated}
          rediseno={rediseno}
          inicial={inicial}
          ocupado={ocupado}
        />
      </DialogContent>
    </Dialog>
  );
}

function InvoiceEditorBody({
  patientId, patientName, patients, clinicTaxMode, onClose, onCreated, rediseno, inicial, ocupado,
}: {
  patientId?: string;
  patientName?: string;
  patients?: InvoiceEditorPatient[];
  clinicTaxMode?: string | null;
  onClose: () => void;
  onCreated: (invoice: any) => void;
  rediseno: boolean;
  inicial: BorradorDeFactura | null;
  ocupado: MutableRefObject<boolean>;
}) {
  const t = useT();
  // `cx(vieja, nueva)`: la clase del diseño nuevo con el interruptor, la de
  // siempre sin él. Sin `nueva`, el nodo queda sin clase en el diseño nuevo
  // (lo viste la hoja por elemento: inputs, selects…).
  // ELIGE una de las dos, nunca las junta: con el interruptor la cadena vieja
  // (y su `font-mono`) no llega al DOM. Lo vigila factura-rediseno.test.ts.
  const cx = (vieja: string, nueva?: string) => (rediseno ? nueva : vieja);
  // Sin `inicial` (siempre, salvo «Duplicar» del diseño nuevo) cada estado nace
  // con el valor de siempre.
  const [items, setItems] = useState<EditorItem[]>(() => (inicial?.items ?? []).map((it) => ({
    key: newKey(), procedureId: null, name: it.name, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
  })));
  const [discountMode, setDiscountMode] = useState<"none" | "pct" | "amount">(inicial && inicial.descuento > 0 ? "amount" : "none");
  const [discountValue, setDiscountValue] = useState<number>(inicial?.descuento ?? 0);
  const [notes, setNotes] = useState(inicial?.notes ?? "");
  // "Vence el" (Invoice.dueDate) — opcional. Viaja como "YYYY-MM-DD" y el
  // servidor lo ancla al día natural de la clínica. Es lo ÚNICO que hace que
  // una factura cuente como vencida (KPI, filtro "Vencidas", Caja, Finanzas).
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Paciente: fijo por prop (ficha) o elegido aquí con el buscador (Caja).
  const fixedPatient = Boolean(patientId);
  const [pickedPatient, setPickedPatient] = useState<InvoiceEditorPatient | null>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const effectivePatientId = patientId ?? pickedPatient?.id ?? "";
  const effectivePatientName = patientId
    ? (patientName ?? "")
    : (pickedPatient ? `${pickedPatient.firstName ?? ""} ${pickedPatient.lastName ?? ""}`.trim() : "");

  // Doctor atribuido (Invoice.doctorId) — opcional, alimenta los reportes por médico de Caja.
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [doctorId, setDoctorId] = useState(inicial?.doctorId ?? "");

  // Impuestos (Invoice.taxRate / taxIncluded). Nacen según la preferencia fiscal
  // de la clínica: exenta (odontología, lo común) = 0% sin desglose; iva16 = 16%
  // ya incluido en el precio. Cambiable por factura.
  const initialTax = useMemo(() => clinicInvoiceTaxDefaults(clinicTaxMode), [clinicTaxMode]);
  // Un duplicado conserva los impuestos de la original, pero solo los dos modos
  // que el editor sabe producir (0 o IVA_RATE_PCT).
  const [taxRate, setTaxRate] = useState<number>(
    inicial?.taxRate === 0 || inicial?.taxRate === IVA_RATE_PCT ? inicial.taxRate : initialTax.taxRate,
  );
  const [taxIncluded, setTaxIncluded] = useState<boolean>(
    inicial?.taxRate === IVA_RATE_PCT && inicial.taxIncluded !== null ? inicial.taxIncluded : initialTax.taxIncluded,
  );
  const taxMode: CfdiTaxMode = taxRate > 0 ? "iva16" : "exento";

  // Forma de pago y envío al paciente — SOLO el diseño nuevo los enseña y los
  // usa. Con el interruptor apagado se quedan en su valor neutro y `save()` no
  // hace ni una petición de más.
  const [cond, setCond] = useState<CondicionesPago>(() => inicial?.condiciones ?? condicionesPorDefecto());
  const [envioElegido, setEnvio] = useState<EnvioAlCrear>(null);
  // La factura YA existe y se está guardando el trato o enviando: «Cancelar» se
  // apaga. Con el interruptor apagado nunca deja de ser false.
  const [despuesDeCrear, setDespuesDeCrear] = useState(false);
  const contacto = useContactoDePaciente(effectivePatientId, rediseno);
  // Si se cambia a un paciente sin correo (o sin teléfono), la opción elegida
  // deja de valer: no se manda nada a quien no se le puede mandar.
  const envio: EnvioAlCrear =
    (envioElegido === "correo" && contacto?.correo === false) ||
    (envioElegido === "whatsapp" && contacto?.telefono === false)
      ? null
      : envioElegido;

  // Tarifario para el autocomplete (mismo endpoint que presupuestos).
  const [catalog, setCatalog] = useState<CatalogProcedure[]>([]);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    fetch("/api/procedures")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCatalog(Array.isArray(d) ? d.map((p: { id: string; name: string; basePrice: number; category?: string }) => ({ id: p.id, name: p.name, basePrice: Number(p.basePrice) || 0, category: p.category })) : []))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    fetch("/api/agenda/doctors")
      .then((r) => (r.ok ? r.json() : { doctors: [] }))
      .then((d) => {
        const lista: DoctorOption[] = Array.isArray(d?.doctors) ? d.doctors.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })) : [];
        setDoctors(lista);
        // Duplicar: si el doctor de la original ya no está en la lista, se suelta.
        // El select lo enseñaría en blanco y el POST lo rechazaría sin pista.
        if (inicial) setDoctorId((prev) => (lista.some((x) => x.id === prev) ? prev : ""));
      })
      .catch(() => setDoctors([]));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const base = q ? catalog.filter((p) => p.name.toLowerCase().includes(q)) : catalog;
    return base.slice(0, 30);
  }, [catalog, search]);

  const patientMatches = useMemo(() => {
    const list = patients ?? [];
    const q = patientQuery.toLowerCase().trim();
    const base = q
      ? list.filter((p) => `${p.firstName ?? ""} ${p.lastName ?? ""} ${p.patientNumber ?? ""}`.toLowerCase().includes(q))
      : list;
    return base.slice(0, 30);
  }, [patients, patientQuery]);

  const totals = useMemo(() => {
    const asInput = items.map((it) => ({ name: it.name, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount }));
    return computeTotals(asInput, {
      discountPct: discountMode === "pct" ? discountValue : null,
      discountAmount: discountMode === "amount" ? discountValue : null,
    });
  }, [items, discountMode, discountValue]);

  // IVA en vivo — CRITERIO DEL SAT, el mismo que el servidor y el timbrado.
  //
  // Aquí había `round2(base × tasa)` sobre la base AGREGADA. El impuesto se
  // redondea **por concepto y se suma**: el CFDI manda `taxes` DENTRO de cada
  // línea y Facturapi redondea línea por línea. Los dos criterios dan números
  // distintos en cuanto hay varios conceptos —hasta 2¢—, así que la pantalla
  // enseñaba $3,093.30 y se guardaba $3,093.28 (medido: el 37,3 % de las
  // facturas con IVA agregado). Lo guardado es lo correcto; el que se había
  // quedado atrás era el modal.
  //
  // `cfdiTotalBreakdown` es la MISMA función que predice lo que va a timbrar
  // Facturapi, y arma la base de cada línea con `spreadInvoiceDiscount` — o sea
  // el mismo descuento por concepto que viaja en el payload. Se le pasan los
  // items YA NORMALIZADOS y el descuento ya resuelto a monto, que es exactamente
  // lo que `save()` manda a POST /api/invoices: la vista previa y lo que se
  // guarda parten del mismo dato.
  //
  // El 16 % fijo de ese helper es exacto aquí: el select solo produce
  // `IVA_RATE_PCT` o 0 (una tasa intermedia rebotaría al timbrar), y el 0 se
  // resuelve por `taxMode === "exento"` antes de mirar el impuesto.
  const { tax, grandTotal } = useMemo(() => {
    // Las MISMAS líneas que va a mandar `save()` (descuento de línea clampeado):
    // si el preview calculara sobre otras, volvería a divergir del servidor.
    const lineas = totals.items.map((it) => ({
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discount: lineDiscount(it),
    }));
    const bd = cfdiTotalBreakdown(lineas, totals.discountAmount, taxMode, taxIncluded);
    // Piso en 0, igual que el total interno del servidor: `cfdiTotalBreakdown`
    // va sin piso a propósito (para que la guarda de integridad pueda VER un
    // descuento que se pasa de largo), pero lo que se enseña como total no.
    const base = round2(Math.max(0, bd.base));
    if (taxMode !== "iva16") return { tax: 0, grandTotal: base };
    if (taxIncluded) {
      // IVA ya contenido en el precio: el total ES la base, no se le suma nada,
      // y por eso este modo NO puede divergir del servidor (allí el impuesto
      // agregado es 0 y el total es la misma base por concepto que la de aquí).
      // El renglón informativo usa `base·r/(1+r)`, la fórmula agregada de
      // `invoiceTaxPortion` — la que ya reparten el corte de Caja y Finanzas
      // sobre lo cobrado—, para que los tres sitios digan el mismo IVA contenido.
      const r = IVA_RATE_PCT / 100;
      return { tax: round2(base - base / (1 + r)), grandTotal: base };
    }
    return { tax: bd.tax, grandTotal: round2(base + bd.tax) };
  }, [totals.items, totals.discountAmount, taxMode, taxIncluded]);

  function addProcedure(p: CatalogProcedure) {
    setItems((prev) => [...prev, {
      key: newKey(), procedureId: p.id, name: p.name, quantity: 1, unitPrice: p.basePrice, discount: 0,
    }]);
    setSearch("");
    setShowSearch(false);
  }
  function addBlank() {
    setItems((prev) => [...prev, {
      key: newKey(), procedureId: null, name: "", quantity: 1, unitPrice: 0, discount: 0,
    }]);
  }
  function patchItem(key: string, patch: Partial<EditorItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  const num = (v: string) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const inputCls = cx("w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm");
  const selectCls = cx("mt-1 w-full bg-background border border-border rounded-lg px-2 py-2 text-sm");

  async function save() {
    if (!effectivePatientId) { toast.error(t("billing.invoiceEditor.errorNoPatient")); return; }
    const clean = items.filter((it) => it.name.trim().length > 0);
    if (clean.length === 0) { toast.error(t("billing.invoiceEditor.errorNoItems")); return; }
    setSaving(true);
    // Reusa la matemática autoritativa: normaliza líneas (lineTotal con descuento
    // de línea) y resuelve el descuento global %→monto. Así el server obtiene
    // subtotal=Σtotal y total=subtotal−discount, coincidiendo con el "Total" en vivo.
    const normalized = computeTotals(
      clean.map((it) => ({ name: it.name.trim(), quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount })),
      {
        discountPct: discountMode === "pct" ? discountValue : null,
        discountAmount: discountMode === "amount" ? discountValue : null,
      },
    );
    const payload: any = {
      patientId: effectivePatientId,
      items: normalized.items.map((it) => ({
        description: String(it.name).trim(),
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        // El descuento POR LÍNEA viaja con el concepto (clamp a importe): el
        // server y la guarda del CFDI calculan qty × unitPrice − discount; sin
        // él, el total interno (neto) no cuadraría con los conceptos (bruto).
        ...(lineDiscount(it) > 0 ? { discount: lineDiscount(it) } : {}),
        total: round2(it.lineTotal),
      })),
      discount: round2(normalized.discountAmount),
      // Exento viaja como tasa 0: es la señal explícita que lee resolveTaxMode al
      // timbrar (la columna nace en 16, así que 0 solo puede venir de esta elección).
      taxRate: Math.min(100, Math.max(0, taxRate)),
      taxIncluded,
    };
    if (doctorId) payload.doctorId = doctorId;
    if (notes.trim()) payload.notes = notes.trim();
    if (dueDate) payload.dueDate = dueDate;
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || t("billing.invoiceEditor.errorCreate"));
      toast.success(t("billing.invoiceEditor.createdToast", { number: out.invoiceNumber ?? "" }));
      // Diseño nuevo: el trato y el envío van DESPUÉS de crear y por rutas
      // aparte — crear la factura no cambia. Si alguno falla se DICE, con el
      // motivo del servidor y dejando claro que la factura sí existe.
      let creada = out;
      if (rediseno && out?.id && (hayCondiciones(cond) || envio)) { ocupado.current = true; setDespuesDeCrear(true); }
      if (rediseno && out?.id && hayCondiciones(cond)) {
        const r = await guardarCondiciones(out.id, cond);
        if (r.ok) creada = { ...out, condicionesPago: r.condiciones };
        else toast.error(r.error ?? t("facturaFicha.errorCondiciones"), { duration: 10000 });
      }
      if (rediseno && out?.id && envio) {
        const r = await enviarFactura(out.id, envio);
        if (r.ok) toast.success(t(envio === "correo" ? "facturaFicha.correoEnviado" : "facturaFicha.whatsAppEnviado"));
        // Sin motivo del servidor no se sabe si salió: no se afirma que no.
        else toast.error(r.error ? `${t("facturaFicha.creadaSinEnviar")} ${r.error}` : t("facturaFicha.creadaEnvioSinConfirmar"), { duration: 10000 });
      }
      ocupado.current = false;
      onCreated(creada);
      // No reseteamos `saving`: el modal se cierra (open=false) y este cuerpo se desmonta.
    } catch (e) {
      ocupado.current = false;
      toast.error((e as Error).message || t("billing.invoiceEditor.errorCreate"));
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader className={rediseno ? c.cabecera : undefined}>
        <DialogTitle className={rediseno ? c.titulo : undefined}>
          {effectivePatientName
            ? t("billing.invoiceEditor.titleWithPatient", { patient: effectivePatientName })
            : t("billing.invoiceEditor.title")}
        </DialogTitle>
      </DialogHeader>

      <div className={cx("flex-1 overflow-y-auto min-h-0 px-6 pb-4 space-y-4", c.cuerpo)}>
        {/* Paciente — solo cuando NO viene fijo desde la ficha */}
        {!fixedPatient && (
          <div className={cx("bg-card border border-border rounded-xl p-4 space-y-3", c.bloque)}>
            <div className={cx("flex items-center justify-between gap-2", c.bloqueCabeza)}>
              <h3 className={cx("text-xs font-bold", c.bloqueTitulo)}>{t("billing.invoiceEditor.patient")}</h3>
              {pickedPatient && (
                <button type="button" onClick={() => { setPickedPatient(null); setPatientQuery(""); }}
                  className={cx("text-[11px] font-semibold text-brand-700 dark:text-brand-300", c.enlace)}>
                  {t("billing.invoiceEditor.changePatient")}
                </button>
              )}
            </div>

            {pickedPatient ? (
              <div className={cx("flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-background", c.elegido)}>
                <User size={14} className="text-muted-foreground flex-shrink-0" />
                <span className={cx("text-sm font-medium truncate")}>{patientLabel(pickedPatient)}</span>
              </div>
            ) : (
              <>
                <input
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder={t("billing.invoiceEditor.patientSearchPlaceholder")}
                  className={cx("w-full bg-background border border-border rounded-lg px-3 py-2 text-sm")}
                />
                <div className={cx("max-h-48 overflow-y-auto divide-y divide-border border border-border rounded-lg", c.opciones)}>
                  {patientMatches.length === 0 ? (
                    <p className={cx("text-xs text-muted-foreground py-3 text-center", c.vacio)}>
                      {(patients ?? []).length === 0
                        ? t("billing.invoiceEditor.noPatients")
                        : t("billing.invoiceEditor.noPatientMatches")}
                    </p>
                  ) : patientMatches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setPickedPatient(p); setPatientQuery(""); }}
                      className={cx("w-full text-left px-3 py-2 hover:bg-muted/50 text-xs font-medium truncate", c.opcion)}
                    >
                      {patientLabel(p)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Conceptos */}
        <div className={cx("bg-card border border-border rounded-xl p-4 space-y-3", c.bloque)}>
          <div className={cx("flex items-center justify-between", c.bloqueCabeza)}>
            <h3 className={cx("text-xs font-bold", c.bloqueTitulo)}>{t("billing.invoiceEditor.items")}</h3>
            <div className={cx("flex items-center gap-2", c.bloqueAcciones)}>
              <button type="button" onClick={() => setShowSearch((s) => !s)}
                className={cx("text-[11px] font-semibold text-brand-700 dark:text-brand-300 inline-flex items-center gap-1", c.enlace)}>
                <Search size={13} aria-hidden /> {t("billing.invoiceEditor.fromCatalog")}
              </button>
              <button type="button" onClick={addBlank}
                className={cx("text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1", `${c.enlace} ${c.enlaceSuave}`)}>
                <Plus size={13} aria-hidden /> {t("billing.invoiceEditor.freeLine")}
              </button>
            </div>
          </div>

          {showSearch && (
            <div className={cx("border border-border rounded-lg p-2 bg-muted/30", c.buscador)}>
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("billing.invoiceEditor.procedureSearchPlaceholder")}
                className={cx("w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm")}
              />
              <div className={cx("mt-2 max-h-56 overflow-y-auto divide-y divide-border", c.opciones)}>
                {filtered.length === 0 ? (
                  <p className={cx("text-xs text-muted-foreground py-3 text-center", c.vacio)}>{t("billing.invoiceEditor.noCatalogMatches")}</p>
                ) : filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProcedure(p)}
                    className={cx("w-full text-left px-2 py-2 hover:bg-muted/50 flex items-center justify-between gap-2", c.opcion)}
                  >
                    <span className={cx("text-xs font-medium truncate")}>{p.name}</span>
                    <span className={cx("text-xs font-bold text-muted-foreground whitespace-nowrap", `${c.cifra} ${c.cifraApagada}`)}>{money(p.basePrice)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.length === 0 ? (
            <p className={cx("text-xs text-muted-foreground py-4 text-center", c.vacio)}>
              {t("billing.invoiceEditor.emptyItems")}
            </p>
          ) : (
            <div className={cx("space-y-2", c.conceptos)}>
              {items.map((it) => {
                const line = computeTotals([{
                  name: it.name, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
                }], {}).items[0];
                return (
                  <div key={it.key} className={cx("border border-border rounded-lg p-2.5 bg-background", c.concepto)}>
                    <div className={cx("flex items-start gap-2", c.conceptoCabeza)}>
                      <input
                        value={it.name}
                        onChange={(e) => patchItem(it.key, { name: e.target.value })}
                        placeholder={t("billing.invoiceEditor.itemPlaceholder")}
                        className={cx("flex-1 min-w-0 bg-transparent border-b border-border px-1 py-1 text-sm font-medium focus:border-brand-500 outline-none", c.conceptoNombre)}
                      />
                      <button type="button" onClick={() => removeItem(it.key)}
                        aria-label={t("billing.invoiceEditor.removeItem")}
                        title={t("billing.invoiceEditor.removeItem")}
                        className={cx("p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex-shrink-0", c.botonIcono)}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                    <div className={cx("grid grid-cols-3 gap-2 mt-2", c.rejilla3)}>
                      <Field label={t("billing.invoiceEditor.qty")} rediseno={rediseno}>
                        <input type="number" min={1} value={it.quantity}
                          onChange={(e) => patchItem(it.key, { quantity: Math.max(1, Math.floor(num(e.target.value))) })}
                          className={inputCls} />
                      </Field>
                      <Field label={t("billing.invoiceEditor.unitPrice")} rediseno={rediseno}>
                        <input type="number" min={0} step="0.01" value={it.unitPrice}
                          onChange={(e) => patchItem(it.key, { unitPrice: num(e.target.value) })}
                          className={inputCls} />
                      </Field>
                      <Field label={t("billing.invoiceEditor.discount")} rediseno={rediseno}>
                        <input type="number" min={0} step="0.01" value={it.discount}
                          onChange={(e) => patchItem(it.key, { discount: num(e.target.value) })}
                          className={inputCls} />
                      </Field>
                    </div>
                    <div className={cx("flex items-center justify-end mt-2", c.conceptoTotal)}>
                      <span className={cx("text-sm font-bold whitespace-nowrap", c.cifra)}>{money(line ? line.lineTotal : 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Doctor + Descuento global + Impuestos + Notas */}
        <div className={cx("bg-card border border-border rounded-xl p-4 space-y-4", c.bloque)}>
          <div className={cx("grid sm:grid-cols-2 gap-4", c.rejilla2)}>
            <div className={rediseno ? c.campo : undefined}>
              <label className={cx("text-[11px] font-bold uppercase tracking-wide text-muted-foreground", c.campoRotulo)}>{t("billing.invoiceEditor.doctor")}</label>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={selectCls}>
                <option value="">{t("billing.invoiceEditor.doctorUnassigned")}</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className={rediseno ? c.campo : undefined}>
              <label className={cx("text-[11px] font-bold uppercase tracking-wide text-muted-foreground", c.campoRotulo)}>{t("billing.invoiceEditor.globalDiscount")}</label>
              <div className={cx("flex items-center gap-1.5 mt-1", c.enLinea)}>
                <select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as "none" | "pct" | "amount")}
                  className={cx("min-w-0 flex-1 bg-background border border-border rounded-lg px-2 py-2 text-sm")}>
                  <option value="none">{t("billing.invoiceEditor.discountNone")}</option>
                  <option value="pct">{t("billing.invoiceEditor.discountPct")}</option>
                  <option value="amount">{t("billing.invoiceEditor.discountAmount")}</option>
                </select>
                {discountMode !== "none" && (
                  <input type="number" min={0} step="0.01" value={discountValue}
                    onChange={(e) => setDiscountValue(num(e.target.value))}
                    className={cx("w-24 flex-shrink-0 bg-background border border-border rounded-lg px-3 py-2 text-sm")} />
                )}
              </div>
            </div>
          </div>

          {/* Impuestos: solo los dos modos que el CFDI sabe timbrar (Facturapi
              desglosa 16% fijo). Una tasa intermedia se vería bien aquí y luego
              rebotaría al timbrar con el 409 de descuadre. */}
          <div className={cx("grid sm:grid-cols-2 gap-4", c.rejilla2)}>
            <div className={rediseno ? c.campo : undefined}>
              <label className={cx("text-[11px] font-bold uppercase tracking-wide text-muted-foreground", c.campoRotulo)}>{t("billing.invoiceEditor.taxes")}</label>
              <select
                value={taxMode}
                onChange={(e) => {
                  const iva = e.target.value === "iva16";
                  setTaxRate(iva ? IVA_RATE_PCT : 0);
                  // Al volver a Exento hay que resetear la modalidad: el select de
                  // abajo se desmonta y dejaría un "IVA agregado" residual, o sea
                  // una factura con tasa 0 que dice desglosar. Cuadra igual, pero
                  // si al timbrar alguien fuerza "IVA 16%" la guarda ve base×1.16
                  // y bloquea con un 409 que culpa a los conceptos.
                  if (!iva) setTaxIncluded(true);
                }}
                className={selectCls}
              >
                <option value="exento">{t("billing.invoiceEditor.taxExempt")}</option>
                <option value="iva16">{t("billing.invoiceEditor.taxIva", { rate: IVA_RATE_PCT })}</option>
              </select>
            </div>
            {taxMode === "iva16" && (
              <div className={rediseno ? c.campo : undefined}>
                <label className={cx("text-[11px] font-bold uppercase tracking-wide text-muted-foreground", c.campoRotulo)}>{t("billing.invoiceEditor.taxMode")}</label>
                <select
                  value={taxIncluded ? "included" : "added"}
                  onChange={(e) => setTaxIncluded(e.target.value === "included")}
                  className={selectCls}
                >
                  <option value="included">{t("billing.invoiceEditor.taxIncludedOption")}</option>
                  <option value="added">{t("billing.invoiceEditor.taxAddedOption")}</option>
                </select>
              </div>
            )}
          </div>

          <div className={cx("grid sm:grid-cols-2 gap-4", c.rejilla2)}>
            <div className={rediseno ? c.campo : undefined}>
              <label className={cx("text-[11px] font-bold uppercase tracking-wide text-muted-foreground", c.campoRotulo)}>{t("billing.invoiceEditor.dueDate")}</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className={cx("mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm")} />
              <p className={cx("mt-1 text-[11px] text-muted-foreground", c.ayuda)}>{t("billing.invoiceEditor.dueDateHint")}</p>
            </div>
            <div className={rediseno ? c.campo : undefined}>
              <label className={cx("text-[11px] font-bold uppercase tracking-wide text-muted-foreground", c.campoRotulo)}>{t("billing.invoiceEditor.notes")}</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder={t("billing.invoiceEditor.notesPlaceholder")}
                className={cx("mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm")} />
            </div>
          </div>
        </div>

        {/* Lo que viene de Presupuestos: forma de pago y envío al paciente. */}
        {rediseno && <FormaDePagoFactura cond={cond} total={grandTotal} onChange={setCond} />}
        {rediseno && (
          <EnvioFactura
            envio={envio}
            contacto={contacto}
            hayPaciente={Boolean(effectivePatientId)}
            onChange={setEnvio}
          />
        )}
      </div>

      {/* Totales + acciones (footer fijo, siempre visible) */}
      <DialogFooter className={cx("flex-col items-stretch gap-3", `${c.pie} ${c.pieApilado}`)}>
        <div className={cx("flex flex-col items-end gap-0.5", c.totales)}>
          <div className={cx("flex justify-between w-full max-w-xs text-xs text-muted-foreground", c.totalFila)}>
            <span>{t("billing.invoiceEditor.subtotal")}</span><span>{money(totals.subtotal)}</span>
          </div>
          {totals.discountAmount > 0 && (
            <div className={cx("flex justify-between w-full max-w-xs text-xs text-muted-foreground", c.totalFila)}>
              <span>{t("billing.invoiceEditor.discount")}</span><span>-{money(totals.discountAmount)}</span>
            </div>
          )}
          <div className={cx("flex justify-between w-full max-w-xs text-xs text-muted-foreground", c.totalFila)}>
            {taxMode === "iva16" ? (
              <>
                <span>{t(taxIncluded ? "billing.invoiceEditor.taxIvaIncluded" : "billing.invoiceEditor.taxIva", { rate: round2(taxRate) })}</span><span>{money(tax)}</span>
              </>
            ) : (
              <>
                <span>{t("billing.invoiceEditor.taxes")}</span><span>{t("billing.invoiceEditor.exempt")}</span>
              </>
            )}
          </div>
          <div className={cx("flex justify-between w-full max-w-xs text-base font-bold text-brand-700 dark:text-brand-300 pt-1", `${c.totalFila} ${c.totalFinal}`)}>
            <span>{t("billing.invoiceEditor.total")}</span><span>{money(grandTotal)}</span>
          </div>
          {/* La frase del trato, en el pie: la misma que saldrá en la ficha. */}
          {rediseno && <FraseDelTrato cond={cond} total={grandTotal} />}
        </div>
        <div className={cx("flex items-center justify-end gap-2", c.pieBotones)}>
          <button type="button" onClick={onClose} disabled={despuesDeCrear} className={cx("text-xs font-semibold px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted/50", c.boton)}>
            {t("billing.invoiceEditor.cancel")}
          </button>
          <button type="button" onClick={save} disabled={saving}
            className={cx("text-xs font-semibold px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5", `${c.boton} ${c.botonPrincipal}`)}>
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {saving ? t("billing.invoiceEditor.creating") : t("billing.invoiceEditor.createInvoice")}
          </button>
        </div>
      </DialogFooter>
    </>
  );
}

function Field({ label, children, rediseno = false }: { label: string; children: React.ReactNode; rediseno?: boolean }) {
  return (
    <label className={rediseno ? c.campo : "block"}>
      <span className={rediseno ? c.campoRotulo : "block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5"}>{label}</span>
      {children}
    </label>
  );
}
