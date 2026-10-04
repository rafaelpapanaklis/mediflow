"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, Banknote, ArrowLeftRight, Wallet, FileCheck2, MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
// Dinero CON centavos, igual que la lista de facturas y el modal de detalle:
// `formatCurrency` redondea a pesos enteros y aquí se cobra un saldo exacto.
import { fmtMXNdec } from "@/lib/format";
// Fecha del cobro: "hoy" en LOCAL (no en UTC) y el instante que se guarda.
// El porqué —y el desfase de 6 h que arreglan— está en el propio archivo.
import { paidAtInstant } from "@/lib/billing/paid-at";
import { useHoyDeLaClinica } from "@/lib/billing/zona-clinica";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { textosDinero } from "@/lib/dinero/textos";
// Ropa del diseño nuevo (solo con `rediseno`). Ver factura-rediseno/.
// A qué cuota va lo que se cobra (solo informa; el POST no cambia). ws1-t2.
import { DestinoDelAbono } from "@/components/dashboard/plan-de-pagos/destino-abono";
import { CLASES_FACTURA_REDISENO, CLASES_CALENDARIO_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
// Mercado Pago (ws1-t1): un método más, pero NO se teclea: genera el link y el
// pago se registra solo. Sin cuenta conectada, el botón ni sale.
import { BotonMercadoPago, LinkMercadoPago, clasesMetodoClasico, useCobroMercadoPago } from "./link-mercado-pago";
import { montoInicialDeCobro } from "./monto-inicial-cobro";
import { useFrenoCajaCerrada } from "./aviso-caja-cerrada";
// ws1-t4: en un caso de ortodoncia, pagar de más es un adelanto (la MISMA pieza que el cobro en el detalle).
import { useSaldoOrto, registrarCobroConAdelanto, SaldoOrtoEnCobro } from "@/components/dashboard/plan-de-pagos/saldo-orto-cobro";
import { AvisoCajaCerrada, AvisoCajaDeOtraPersona } from "./aviso-caja-cerrada.component";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
// ws1-t6 (F1): el aviso del cobro automático con tarjeta, antes de cobrar.
import { AvisoCobroAutomaticoEnCobro, useAvisoCobroAutomatico } from "@/components/cobro-automatico/aviso-en-cobro";

export type PaymentMethod = "cash" | "debit" | "credit" | "transfer" | "check" | "other";
/**
 * Lo que se puede ELEGIR en la rejilla del cobro: los seis de arriba (se
 * teclean y se registran aquí) + Mercado Pago (ws1-t1), que no se teclea: genera
 * el link y el pago lo registra el webhook. Por eso no entra en `PaymentMethod`.
 */
export type MetodoDelCobro = PaymentMethod | "mercadopago";

// labelKey resolved via t() at render time.
export const METHODS: { value: PaymentMethod; labelKey: string; icon: typeof CreditCard }[] = [
  { value: "cash",     labelKey: "clinical.paymentModal.methodCash",      icon: Banknote },
  { value: "debit",    labelKey: "clinical.paymentModal.methodDebit",     icon: CreditCard },
  { value: "credit",   labelKey: "clinical.paymentModal.methodCredit",    icon: CreditCard },
  { value: "transfer", labelKey: "clinical.paymentModal.methodTransfer",  icon: ArrowLeftRight },
  { value: "check",    labelKey: "clinical.paymentModal.methodCheck",     icon: FileCheck2 },
  { value: "other",    labelKey: "clinical.paymentModal.methodOther",     icon: MoreHorizontal },
];

export interface PaymentInvoice {
  id: string;
  invoiceNumber: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  patientName?: string;
}

interface PaymentModalProps {
  open: boolean;
  invoice: PaymentInvoice | null;
  onClose: () => void;
  onSuccess: () => void;
  /**
   * Interruptor `menu-dos-niveles` (lo pasa quien monta el modal). `true` =
   * vestido con el diseño nuevo, calendario incluido; `false` (por defecto)
   * = las clases de siempre, byte por byte. La lógica del cobro no cambia.
   */
  rediseno?: boolean;
  /**
   * ronda 3 (ws1-t2, H6): el monto con el que arranca el campo «Monto a
   * cobrar». Sin esto (el comportamiento de siempre) arranca con el SALDO
   * COMPLETO de la factura — correcto para "Registrar pago" desde la ficha
   * de una factura suelta, pero un desastre para cobrar UNA mensualidad de
   * un plan a plazos: precargaba los $36,000 del tratamiento entero en vez
   * de los $2,000 de la cuota. Quien cobra una cuota específica (Caja →
   * mensualidades, «Cobrar» de la Sección F) pasa aquí SU monto. Se clampea
   * al saldo (nunca por encima, o el campo nace en «sobrepago»).
   */
  montoSugerido?: number;
  /**
   * ws1-t4 — factura de un caso de ortodoncia: se usó el saldo a favor del
   * paciente desde aquí. Quien monta refresca la factura (o cierra si quedó pagada).
   */
  alUsarSaldo?: (r: { aplicado: number; pagada: boolean }) => void;
}

export function PaymentModal({ open, invoice, onClose, onSuccess, rediseno = false, montoSugerido, alUsarSaldo }: PaymentModalProps) {
  const t = useT();
  const txCobro = textosDinero(useLocale()).cobro;
  const [amount, setAmount]       = useState("");
  const [method, setMethod]       = useState<MetodoDelCobro>("cash");
  // C-33: la fecha por defecto es el «hoy» de la clínica, no el de la computadora.
  const hoy = useHoyDeLaClinica();
  const [paidAt, setPaidAt]       = useState(hoy);
  const [reference, setReference] = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  const mpDisponible = useCobroMercadoPago(open);
  // «La caja está cerrada»: se pregunta antes de confirmar un cobro en efectivo (pieza compartida).
  const freno = useFrenoCajaCerrada(open, method === "cash");
  const esMercadoPago = method === "mercadopago";
  const orto = useSaldoOrto(invoice?.id ?? null, open);
  const cobroAuto = useAvisoCobroAutomatico(invoice?.id ?? null, Number(amount) || 0, open && method !== "mercadopago");
  // `cx(vieja, nueva)`: la clase del diseño nuevo con el interruptor, la de siempre sin él.
  // ELIGE una de las dos, nunca las junta: con el interruptor la cadena vieja
  // (y su `font-mono`) no llega al DOM. Lo vigila factura-rediseno.test.ts.
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);

  // Reset whenever the modal opens for a new invoice.
  useEffect(() => {
    if (!open || !invoice) return;
    setAmount(String(montoInicialDeCobro(montoSugerido, invoice.balance ?? 0)));
    setMethod("cash");
    setPaidAt(hoy);
    setReference("");
    setNotes("");
    freno.ocultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice, hoy]);

  if (!invoice) return null;

  const amountNum = Number(amount);
  const isOverpay = amountNum > invoice.balance + 0.001;
  // ws1-t4: sobre una factura de un caso de ortodoncia, lo de más es un
  // adelanto (siguientes mensualidades, y lo que sobre a favor), no un error.
  // Fuera de ortodoncia (o mientras no se sabe) sigue bloqueado como siempre.
  const adelanto = isOverpay && orto.esOrto;
  const isInvalid = !amountNum || amountNum <= 0 || (isOverpay && !adelanto);

  async function submit(sinAviso = false) {
    if (isInvalid || saving || !invoice) return;
    // Auditoría de uso C-15: transferencia sin referencia no (misma regla que el anticipo).
    if (method === "transfer" && !reference.trim()) { toast.error(txCobro.faltaReferencia); return; }
    // MP ya cobró este ciclo: sin confirmar que es un adelanto, no se cobra.
    if (cobroAuto.bloquea) return;
    if (!sinAviso) {
      setSaving(true);
      const parar = await freno.frenar();
      setSaving(false);
      if (parar) return;
    }
    freno.ocultar();
    setSaving(true);
    try {
      if (adelanto) {
        const r = await registrarCobroConAdelanto({ invoiceId: invoice.id, amount: amountNum, method, paidAt, reference, notes });
        toast.success(r.aFavor > 0
          ? `Pago registrado · ${fmtMXNdec(r.aFavor)} quedan a favor del paciente`
          : t("clinical.paymentModal.registerSuccess"));
        onSuccess();
        return;
      }
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          method,
          paidAt: paidAtInstant(paidAt, undefined, hoy)?.toISOString(),
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          confirmarCobroAutomatico: cobroAuto.confirmado || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("clinical.paymentModal.registerError"));
      }
      toast.success(t("clinical.paymentModal.registerSuccess"));
      onSuccess();
    } catch (err: any) {
      toast.error(mensajeDeError(err, t, { porDefecto: t("clinical.paymentModal.registerErrorGeneric") }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)}>
        <DialogHeader className={rediseno ? c.cabecera : undefined}>
          <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{t("clinical.paymentModal.title")}</DialogTitle>
        </DialogHeader>

        <div className={cx("px-6 py-4 space-y-4 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
          <div className={cx("bg-muted/40 border border-border rounded-lg p-3 text-xs space-y-1", c.resumen)}>
            <div className={cx("flex justify-between", c.resumenFila)}>
              <span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.paymentModal.invoice")}</span>
              <span className={cx("font-mono font-bold", `${c.cifra} ${c.folio}`)}>{invoice.invoiceNumber}</span>
            </div>
            {invoice.patientName && (
              <div className={cx("flex justify-between", c.resumenFila)}>
                <span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.paymentModal.patient")}</span>
                <span className={cx("font-medium", c.valor)}>{invoice.patientName}</span>
              </div>
            )}
            <div className={cx("flex justify-between", c.resumenFila)}>
              <span className={cx("text-muted-foreground", c.rotulo)}>{t("common.total")}</span>
              <span className={cx("font-bold", c.cifra)}>{fmtMXNdec(invoice.total)}</span>
            </div>
            <div className={cx("flex justify-between", c.resumenFila)}>
              <span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.paymentModal.paid")}</span>
              <span className={cx("font-bold", `${c.cifra} ${c.cifraExito}`)} style={rediseno ? undefined : { color: "var(--success)" }}>{fmtMXNdec(invoice.paid)}</span>
            </div>
            <div className={cx("flex justify-between", c.resumenFila)}>
              <span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.paymentModal.pendingBalance")}</span>
              <span className={cx("font-bold", `${c.cifra} ${c.cifraTotal} ${c.cifraPeligro}`)} style={rediseno ? undefined : { color: "var(--danger)" }}>{fmtMXNdec(invoice.balance)}</span>
            </div>
          </div>

          {!esMercadoPago && (
          <div className={cx("space-y-1.5", c.campo)}>
            <Label>{t("clinical.paymentModal.amountToCharge")}</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            {isOverpay && !adelanto && (
              <p className={cx("text-[11px]", `${c.ayuda} ${c.cifraPeligro}`)} style={rediseno ? undefined : { color: "var(--danger)" }}>
                {t("clinical.paymentModal.overpayWarning", { balance: fmtMXNdec(invoice.balance) })}
              </p>
            )}
            {/* Solo con el diseño nuevo: apagado, este modal es el de siempre.
                Siempre montado (un sobrepago le pasa 0): remontarlo volvería a leer. */}
            {rediseno && (
              <DestinoDelAbono invoiceId={invoice.id} total={invoice.total} pagado={invoice.paid} importe={isOverpay ? (adelanto ? invoice.balance : 0) : amountNum || 0} activo={open} />
            )}
            {/* ws1-t4: solo en un caso de ortodoncia (fuera, no pinta nada). */}
            <SaldoOrtoEnCobro
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              info={orto.info}
              importe={amountNum || 0}
              balance={invoice.balance}
              pagado={invoice.paid}
              bloqueado={saving}
              alAplicar={(r) => { orto.recargar(); alUsarSaldo?.(r); }}
            />
            {/* ws1-t6 (F1): qué pasa con el cargo de Mercado Pago si se cobra esto (fuera del cobro automático, nada). */}
            <AvisoCobroAutomaticoEnCobro estado={cobroAuto} />
          </div>
          )}

          <div className={cx("space-y-1.5", c.campo)}>
            <Label>{t("clinical.paymentModal.paymentMethod")}</Label>
            <div className={cx("grid grid-cols-3 gap-1.5", c.metodos)}>
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = m.value === method;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={rediseno
                      ? `${c.metodo} ${active ? c.metodoActivo : ""}`
                      : `flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-[11px] font-semibold transition-colors ${
                      active
                        ? ""
                        : "bg-[var(--bg-elev)] text-[var(--text-1)] border-[var(--border-soft)] hover:bg-muted/50"
                    }`}
                    style={active && !rediseno ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" } : undefined}
                  >
                    <Icon size={14} aria-hidden />
                    {t(m.labelKey)}
                  </button>
                );
              })}
              {mpDisponible && (
                <BotonMercadoPago
                  activo={esMercadoPago}
                  alElegir={() => setMethod("mercadopago")}
                  className={rediseno ? `${c.metodo} ${esMercadoPago ? c.metodoActivo : ""}` : clasesMetodoClasico(esMercadoPago)}
                />
              )}
            </div>
          </div>

          {esMercadoPago ? (
            <LinkMercadoPago invoiceId={invoice.id} modo="cobro" />
          ) : (
          <>
          <div className={cx("grid grid-cols-2 gap-3", c.rejilla2)}>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("common.date")}</Label>
              {/* max = hoy: el pago se registra cuando OCURRE. Sin este tope se
                  podía capturar una fecha futura, que el servidor ahora rechaza
                  con 400. Misma expresión que el valor por defecto de arriba
                  para que el valor inicial nunca quede por encima del tope. */}
              <DateField max={hoy} className={cx("flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 disabled:opacity-50 transition-colors", c.campoFecha)} popoverClassName={rediseno ? CLASES_CALENDARIO_REDISENO : undefined} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.paymentModal.reference")}</Label>
              <Input
                placeholder={method === "transfer" ? t("clinical.paymentModal.refTransfer") : method === "check" ? t("clinical.paymentModal.refCheck") : t("clinical.paymentModal.refAuthorization")}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          <div className={cx("space-y-1.5", c.campo)}>
            <Label>{t("common.notes")}</Label>
            <textarea
              className="input-new"
              style={{ resize: "none", minHeight: 60 }}
              placeholder={t("common.optional")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          </>
          )}
        </div>

        {freno.visible && <AvisoCajaCerrada onCobrarDeTodosModos={() => submit(true)} ocupado={saving} />}
        {/* Decisión 16 (auditoría de uso): la caja la abrió otra persona; solo se avisa. */}
        <AvisoCajaDeOtraPersona nombre={freno.cajaDe} />

        <DialogFooter className={rediseno ? c.pie : undefined}>
          <ButtonNew variant="ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</ButtonNew>
          {/* Con Mercado Pago no se registra nada aquí: el webhook lo registra al acreditarse. */}
          {!esMercadoPago && (
          <ButtonNew variant="primary" onClick={() => submit()} disabled={isInvalid || saving || cobroAuto.bloquea}>
            {saving ? t("clinical.paymentModal.registering") : t("clinical.paymentModal.registerPaymentBtn", { amount: amountNum ? " · " + fmtMXNdec(amountNum) : "" })}
          </ButtonNew>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
