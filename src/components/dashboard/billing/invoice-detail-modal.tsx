"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Printer, FileText, CreditCard, CheckCircle2, Pencil, Tag, XCircle, Undo2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import { PaymentModal, type PaymentInvoice } from "./payment-modal";

// labelKey -> translation key resolved via t() at render time.
const INV_STATUS: Record<string, { labelKey: string; cls: string }> = {
  PENDING: { labelKey: "clinical.invoiceDetail.statusPending", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800" },
  PARTIAL: { labelKey: "clinical.invoiceDetail.statusPartial",   cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800" },
  PAID:    { labelKey: "clinical.invoiceDetail.statusPaid",    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" },
  OVERDUE: { labelKey: "clinical.invoiceDetail.statusOverdue",   cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800" },
  CANCELLED: { labelKey: "clinical.invoiceDetail.statusCancelled", cls: "bg-muted text-muted-foreground border border-border" },
  DRAFT:   { labelKey: "clinical.invoiceDetail.statusDraft",  cls: "bg-muted text-muted-foreground border border-border" },
};

const METHOD_LABEL_KEYS: Record<string, string> = {
  cash: "clinical.invoiceDetail.methodCash", debit: "clinical.invoiceDetail.methodDebit", credit: "clinical.invoiceDetail.methodCredit",
  transfer: "clinical.invoiceDetail.methodTransfer", check: "clinical.invoiceDetail.methodCheck", refund: "clinical.invoiceDetail.methodRefund", other: "clinical.invoiceDetail.methodOther",
};

interface Invoice {
  id: string;
  invoiceNumber: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  discount?: number;
  subtotal?: number;
  paymentMethod?: string | null;
  cfdiUuid?: string | null;
  notes?: string | null;
  items?: any[];
  payments?: any[];
  createdAt: string | Date;
}

interface InvoiceDetailModalProps {
  open: boolean;
  invoice: Invoice | null;
  patientName: string;
  onClose: () => void;
  // Re-fetch invoices in parent. Llamado tras cualquier acción exitosa.
  onMutated: () => Promise<void> | void;
}

type SubAction = null | "refund" | "edit-price" | "discount" | "cancel";

export function InvoiceDetailModal({ open, invoice, patientName, onClose, onMutated }: InvoiceDetailModalProps) {
  const t = useT();
  const router = useRouter();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [sub, setSub] = useState<SubAction>(null);
  const [busy, setBusy] = useState(false);

  // Sub-form state — se resetea al abrir cada sub-modal.
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [editTotal,    setEditTotal]    = useState("");
  const [discountAmt,  setDiscountAmt]  = useState("");
  const [cancelReason, setCancelReason] = useState("");

  if (!invoice) return null;

  const status = invoice.status;
  const isPending  = status === "PENDING" || status === "PARTIAL" || status === "OVERDUE";
  const isPaid     = status === "PAID";
  const isCancelled = status === "CANCELLED";
  // DRAFT: factura recién creada (vía autoInvoice / from-appointment). Antes
  // de cobrar requiere "Confirmar" para pasar a PENDING. El usuario puede
  // editar precio/descuento o eliminar el borrador completo desde aquí.
  const isDraft    = status === "DRAFT";
  const canEditPrice = (isPending || isDraft) && invoice.paid === 0;
  const s = INV_STATUS[status] ?? INV_STATUS.PENDING;

  function openSub(which: Exclude<SubAction, null>) {
    setRefundAmount(String(invoice?.paid ?? 0));
    setRefundReason("");
    setEditTotal(String(invoice?.total ?? 0));
    setDiscountAmt(String(invoice?.discount ?? 0));
    setCancelReason("");
    setSub(which);
  }

  async function callApi(path: string, method: "POST" | "PATCH" | "DELETE", body?: any, successMsg?: string) {
    if (!invoice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? t("clinical.invoiceDetail.operationError"));
      }
      toast.success(successMsg ?? t("clinical.invoiceDetail.operationSuccess"));
      setSub(null);
      await onMutated();
      onClose();
      // Forzamos refresh del segmento server-rendered actual además de la
      // revalidatePath del endpoint. Así la página que monta el modal
      // (patient-detail, billing, home) refleja la mutación sin que el
      // parent tenga que cablear router.refresh() en onMutated.
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkPaid() {
    if (!confirm(t("clinical.invoiceDetail.markPaidConfirm", { balance: formatCurrency(invoice!.balance) }))) return;
    await callApi("/mark-paid", "POST", {}, t("clinical.invoiceDetail.markPaidSuccess"));
  }

  async function handleCancel() {
    await callApi("/cancel", "POST", { reason: cancelReason.trim() || undefined }, t("clinical.invoiceDetail.cancelSuccess"));
  }

  async function handleRefund() {
    const amount = Number(refundAmount);
    if (!amount || amount <= 0) { toast.error(t("clinical.invoiceDetail.invalidAmount")); return; }
    if (amount > invoice!.paid) { toast.error(t("clinical.invoiceDetail.exceedsPaid")); return; }
    await callApi("/refund", "POST", { amount, reason: refundReason.trim() || undefined }, t("clinical.invoiceDetail.refundSuccess"));
  }

  async function handleEditPrice() {
    const total = Number(editTotal);
    if (!isFinite(total) || total < 0) { toast.error(t("clinical.invoiceDetail.invalidTotal")); return; }
    await callApi("/edit-price", "POST", { total }, t("clinical.invoiceDetail.priceUpdated"));
  }

  async function handleDiscount() {
    const discount = Number(discountAmt);
    if (!isFinite(discount) || discount < 0) { toast.error(t("clinical.invoiceDetail.invalidDiscount")); return; }
    await callApi("/edit-price", "POST", { discount }, t("clinical.invoiceDetail.discountApplied"));
  }

  // "Cobrar ahora" sobre un DRAFT: confirma el borrador (DRAFT → PENDING) y
  // abre el PaymentModal inmediatamente. El snapshot local del invoice
  // queda DRAFT pero el server ya está PENDING, así que el POST de payment
  // lo acepta. router.refresh() actualiza la lista del parent al cerrar.
  async function handleConfirmAndPay() {
    if (!invoice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/confirm`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? t("clinical.invoiceDetail.confirmError"));
      }
      // router.refresh() removido: causaba race con el refresh post-payment
      // de handlePaymentSuccess. El refresh ocurre al cerrar el PaymentModal.
      setPaymentOpen(true);
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteDraft() {
    if (!invoice) return;
    if (!confirm(t("clinical.invoiceDetail.deleteDraftConfirm", { number: invoice.invoiceNumber }))) return;
    await callApi("", "DELETE", undefined, t("clinical.invoiceDetail.draftDeleted"));
  }

  function handlePaymentSuccess() {
    setPaymentOpen(false);
    onMutated();
    onClose();
    router.refresh();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-lg bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold flex items-center gap-3 flex-wrap">
              <span className="font-mono">{invoice.invoiceNumber}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{t(s.labelKey)}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4 flex-1 overflow-y-auto min-h-0">
            {/* Resumen — usa tokens de tema (bg-muted/40, border-border, text-muted-foreground) */}
            <div className="bg-muted/40 border border-border rounded-lg p-3 text-xs space-y-1.5 text-foreground">
              <div className="flex justify-between"><span className="text-muted-foreground">{t("clinical.invoiceDetail.patient")}</span><span className="font-medium">{patientName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("common.date")}</span><span>{formatDate(invoice.createdAt)}</span></div>
              {(invoice.discount ?? 0) > 0 && (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t("clinical.invoiceDetail.subtotal")}</span><span>{formatCurrency(invoice.subtotal ?? invoice.total + (invoice.discount ?? 0))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t("clinical.invoiceDetail.discount")}</span><span className="text-amber-600 dark:text-amber-400">−{formatCurrency(invoice.discount ?? 0)}</span></div>
                </>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">{t("common.total")}</span><span className="font-bold">{formatCurrency(invoice.total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("clinical.invoiceDetail.paid")}</span><span className="text-emerald-600 dark:text-emerald-400 font-bold">{formatCurrency(invoice.paid)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("clinical.invoiceDetail.balance")}</span><span className="text-rose-600 dark:text-rose-400 font-bold">{formatCurrency(invoice.balance)}</span></div>
              {invoice.paymentMethod && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t("clinical.invoiceDetail.method")}</span><span className="capitalize">{METHOD_LABEL_KEYS[invoice.paymentMethod] ? t(METHOD_LABEL_KEYS[invoice.paymentMethod]) : invoice.paymentMethod}</span></div>
              )}
              {invoice.cfdiUuid && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">CFDI UUID</span>
                  <span className="font-mono text-[10px] truncate">{invoice.cfdiUuid}</span>
                </div>
              )}
              {isCancelled && invoice.notes && (
                <div className="pt-2 border-t border-border mt-2">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wide">{t("common.notes")}</span>
                  <p className="text-[11px] mt-1 whitespace-pre-line">{invoice.notes}</p>
                </div>
              )}
            </div>

            {/* Conceptos */}
            {Array.isArray(invoice.items) && invoice.items.length > 0 && (
              <div>
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">{t("clinical.invoiceDetail.lineItems")}</h3>
                <div className="bg-card border border-border rounded-lg divide-y divide-border">
                  {invoice.items.map((it: any, i: number) => (
                    <div key={i} className="px-3 py-2 flex items-center justify-between text-xs">
                      <div className="min-w-0">
                        <div className="font-medium truncate text-foreground">{it.description ?? it.name ?? t("clinical.invoiceDetail.lineItemFallback", { n: i + 1 })}</div>
                        {(it.quantity ?? 1) !== 1 && (
                          <div className="text-[10px] text-muted-foreground">{it.quantity} × {formatCurrency(it.unitPrice ?? 0)}</div>
                        )}
                      </div>
                      <div className="font-mono font-bold text-foreground">{formatCurrency(it.total ?? 0)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pagos registrados — refunds aparecen con method="refund" en rojo */}
            {Array.isArray(invoice.payments) && invoice.payments.length > 0 && (
              <div>
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">{t("clinical.invoiceDetail.movements")}</h3>
                <div className="bg-card border border-border rounded-lg divide-y divide-border">
                  {invoice.payments.map((p: any) => {
                    const isRefund = p.method === "refund";
                    return (
                      <div key={p.id} className="px-3 py-2 flex items-center justify-between text-xs">
                        <div className="min-w-0">
                          <div className={`font-medium ${isRefund ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
                            {METHOD_LABEL_KEYS[p.method] ? t(METHOD_LABEL_KEYS[p.method]) : (p.method ?? "—")}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {formatDate(p.paidAt)}
                            {p.reference ? ` · ${p.reference}` : ""}
                            {p.notes ? ` · ${p.notes}` : ""}
                          </div>
                        </div>
                        <div className={`font-mono font-bold ${isRefund ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {isRefund ? "−" : ""}{formatCurrency(p.amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-wrap gap-2">
            {/* BORRADOR — antes de cobrar requiere "Confirmar". Cobrar ahora
                hace ambos pasos (confirm + payment) en un click. */}
            {isDraft && (
              <>
                <Button onClick={handleConfirmAndPay} disabled={busy}>
                  <CreditCard size={14} aria-hidden /> {t("clinical.invoiceDetail.chargeNow", { amount: formatCurrency(invoice.total) })}
                </Button>
                <Button variant="outline" onClick={() => openSub("edit-price")} disabled={busy}>
                  <Pencil size={14} aria-hidden /> {t("clinical.invoiceDetail.editPrice")}
                </Button>
                <Button variant="outline" onClick={() => openSub("discount")} disabled={busy}>
                  <Tag size={14} aria-hidden /> {t("clinical.invoiceDetail.applyDiscount")}
                </Button>
                <Button variant="outline" onClick={handleDeleteDraft} disabled={busy}
                  className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                  <Trash2 size={14} aria-hidden /> {t("clinical.invoiceDetail.deleteDraft")}
                </Button>
              </>
            )}

            {/* PENDIENTE / PARCIAL */}
            {isPending && (
              <>
                <Button onClick={() => setPaymentOpen(true)} disabled={busy}>
                  <CreditCard size={14} aria-hidden /> {t("clinical.invoiceDetail.collectPayment", { amount: formatCurrency(invoice.balance) })}
                </Button>
                <Button variant="outline" onClick={handleMarkPaid} disabled={busy} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                  <CheckCircle2 size={14} aria-hidden /> {t("clinical.invoiceDetail.markPaid")}
                </Button>
                {canEditPrice && (
                  <>
                    <Button variant="outline" onClick={() => openSub("edit-price")} disabled={busy}>
                      <Pencil size={14} aria-hidden /> {t("clinical.invoiceDetail.editPrice")}
                    </Button>
                    <Button variant="outline" onClick={() => openSub("discount")} disabled={busy}>
                      <Tag size={14} aria-hidden /> {t("clinical.invoiceDetail.applyDiscount")}
                    </Button>
                  </>
                )}
                {invoice.paid === 0 && (
                  <Button variant="outline" onClick={() => openSub("cancel")} disabled={busy}
                    className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                    <XCircle size={14} aria-hidden /> {t("clinical.invoiceDetail.cancelInvoice")}
                  </Button>
                )}
              </>
            )}

            {/* PAGADA */}
            {isPaid && (
              <>
                <Button variant="outline" onClick={() => openSub("refund")} disabled={busy}
                  className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                  <Undo2 size={14} aria-hidden /> {t("clinical.invoiceDetail.refund")}
                </Button>
                {invoice.cfdiUuid && (
                  <Button variant="outline" onClick={() => {
                    navigator.clipboard.writeText(invoice.cfdiUuid!).catch(() => {});
                    toast.success(t("clinical.invoiceDetail.cfdiUuidCopied"));
                  }}>
                    <FileText size={14} aria-hidden /> {t("clinical.invoiceDetail.copyCfdiUuid")}
                  </Button>
                )}
              </>
            )}

            {/* Imprimir disponible siempre */}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer size={14} aria-hidden /> {t("common.print")}
            </Button>

            <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Reembolsar */}
      <Dialog open={sub === "refund"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">{t("clinical.invoiceDetail.refundInvoiceTitle", { number: invoice.invoiceNumber })}</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0">
            <p className="text-xs text-muted-foreground">{t("clinical.invoiceDetail.totalPaidLabel")} <span className="font-mono font-bold text-foreground">{formatCurrency(invoice.paid)}</span></p>
            <div className="space-y-1.5">
              <Label>{t("clinical.invoiceDetail.refundAmountLabel")}</Label>
              <Input type="number" step="0.01" min={0} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>{t("clinical.invoiceDetail.reason")}</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
                placeholder={t("clinical.invoiceDetail.refundReasonPlaceholder")}
                value={refundReason} onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.cancel")}</Button>
            <Button onClick={handleRefund} disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white">
              {busy ? t("clinical.invoiceDetail.processing") : t("clinical.invoiceDetail.refundAmountBtn", { amount: formatCurrency(Number(refundAmount) || 0) })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Editar precio */}
      <Dialog open={sub === "edit-price"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">{t("clinical.invoiceDetail.editPrice")}</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0">
            <p className="text-xs text-muted-foreground">{t("clinical.invoiceDetail.currentTotalLabel")} <span className="font-mono font-bold text-foreground">{formatCurrency(invoice.total)}</span></p>
            <div className="space-y-1.5">
              <Label>{t("clinical.invoiceDetail.newTotalLabel")}</Label>
              <Input type="number" step="0.01" min={0} value={editTotal} onChange={(e) => setEditTotal(e.target.value)} autoFocus />
            </div>
            <p className="text-[11px] text-muted-foreground">{t("clinical.invoiceDetail.editPriceHelper")}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.cancel")}</Button>
            <Button onClick={handleEditPrice} disabled={busy}>{busy ? t("common.saving") : t("clinical.invoiceDetail.savePrice")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Aplicar descuento */}
      <Dialog open={sub === "discount"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">{t("clinical.invoiceDetail.applyDiscount")}</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0">
            <p className="text-xs text-muted-foreground">{t("clinical.invoiceDetail.currentSubtotalLabel")} <span className="font-mono font-bold text-foreground">{formatCurrency(invoice.subtotal ?? invoice.total + (invoice.discount ?? 0))}</span></p>
            <div className="space-y-1.5">
              <Label>{t("clinical.invoiceDetail.discountMxnLabel")}</Label>
              <Input type="number" step="0.01" min={0} value={discountAmt} onChange={(e) => setDiscountAmt(e.target.value)} autoFocus />
            </div>
            <p className="text-[11px] text-muted-foreground">{t("clinical.invoiceDetail.discountHelper")}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.cancel")}</Button>
            <Button onClick={handleDiscount} disabled={busy}>{busy ? t("clinical.invoiceDetail.applying") : t("clinical.invoiceDetail.applyDiscount")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Cancelar factura */}
      <Dialog open={sub === "cancel"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">{t("clinical.invoiceDetail.cancelInvoiceTitle", { number: invoice.invoiceNumber })}</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0">
            <p className="text-xs text-muted-foreground">{t("clinical.invoiceDetail.cancelWarning")}</p>
            <div className="space-y-1.5">
              <Label>{t("clinical.invoiceDetail.reasonOptional")}</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
                placeholder={t("clinical.invoiceDetail.cancelReasonPlaceholder")}
                value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.back")}</Button>
            <Button onClick={handleCancel} disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white">
              {busy ? t("clinical.invoiceDetail.cancelling") : t("clinical.invoiceDetail.confirmCancellation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PaymentModal compartido — el de Commit 1 */}
      <PaymentModal
        open={paymentOpen}
        invoice={paymentOpen ? {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
          paid: invoice.paid,
          balance: invoice.balance,
          status: invoice.status,
          patientName,
        } : null}
        onClose={() => setPaymentOpen(false)}
        onSuccess={handlePaymentSuccess}
      />
    </>
  );
}
