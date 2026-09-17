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
import { todayLocalISO, paidAtInstant } from "@/lib/billing/paid-at";
import { useT } from "@/i18n/i18n-provider";
// Ropa del diseño nuevo (solo con `rediseno`). Ver factura-rediseno/.
import { CLASES_FACTURA_REDISENO, CLASES_CALENDARIO_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";

export type PaymentMethod = "cash" | "debit" | "credit" | "transfer" | "check" | "other";

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
}

export function PaymentModal({ open, invoice, onClose, onSuccess, rediseno = false }: PaymentModalProps) {
  const t = useT();
  const [amount, setAmount]       = useState("");
  const [method, setMethod]       = useState<PaymentMethod>("cash");
  const [paidAt, setPaidAt]       = useState(() => todayLocalISO());
  const [reference, setReference] = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  // `cx(vieja, nueva)`: la clase del diseño nuevo con el interruptor, la de siempre sin él.
  // ELIGE una de las dos, nunca las junta: con el interruptor la cadena vieja
  // (y su `font-mono`) no llega al DOM. Lo vigila factura-rediseno.test.ts.
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);

  // Reset whenever the modal opens for a new invoice.
  useEffect(() => {
    if (!open || !invoice) return;
    setAmount(String(invoice.balance ?? 0));
    setMethod("cash");
    setPaidAt(todayLocalISO());
    setReference("");
    setNotes("");
  }, [open, invoice]);

  if (!invoice) return null;

  const amountNum = Number(amount);
  const isOverpay = amountNum > invoice.balance + 0.001;
  const isInvalid = !amountNum || amountNum <= 0 || isOverpay;

  async function submit() {
    if (isInvalid || saving || !invoice) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          method,
          paidAt: paidAtInstant(paidAt)?.toISOString(),
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("clinical.paymentModal.registerError"));
      }
      toast.success(t("clinical.paymentModal.registerSuccess"));
      onSuccess();
    } catch (err: any) {
      toast.error(err.message ?? t("clinical.paymentModal.registerErrorGeneric"));
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
            {isOverpay && (
              <p className={cx("text-[11px]", `${c.ayuda} ${c.cifraPeligro}`)} style={rediseno ? undefined : { color: "var(--danger)" }}>
                {t("clinical.paymentModal.overpayWarning", { balance: fmtMXNdec(invoice.balance) })}
              </p>
            )}
          </div>

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
            </div>
          </div>

          <div className={cx("grid grid-cols-2 gap-3", c.rejilla2)}>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("common.date")}</Label>
              {/* max = hoy: el pago se registra cuando OCURRE. Sin este tope se
                  podía capturar una fecha futura, que el servidor ahora rechaza
                  con 400. Misma expresión que el valor por defecto de arriba
                  para que el valor inicial nunca quede por encima del tope. */}
              <DateField max={todayLocalISO()} className={cx("flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 disabled:opacity-50 transition-colors", c.campoFecha)} popoverClassName={rediseno ? CLASES_CALENDARIO_REDISENO : undefined} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
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
        </div>

        <DialogFooter className={rediseno ? c.pie : undefined}>
          <ButtonNew variant="ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</ButtonNew>
          <ButtonNew variant="primary" onClick={submit} disabled={isInvalid || saving}>
            {saving ? t("clinical.paymentModal.registering") : t("clinical.paymentModal.registerPaymentBtn", { amount: amountNum ? " · " + fmtMXNdec(amountNum) : "" })}
          </ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
