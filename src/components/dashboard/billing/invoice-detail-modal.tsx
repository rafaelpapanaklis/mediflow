"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Printer, FileText, CreditCard, CheckCircle2, Pencil, Tag, XCircle, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PaymentModal, type PaymentInvoice } from "./payment-modal";

const INV_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pendiente", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800" },
  PARTIAL: { label: "Parcial",   cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800" },
  PAID:    { label: "Pagada",    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" },
  OVERDUE: { label: "Vencida",   cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800" },
  CANCELLED: { label: "Cancelada", cls: "bg-muted text-muted-foreground border border-border" },
  DRAFT:   { label: "Borrador",  cls: "bg-muted text-muted-foreground border border-border" },
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", debit: "Tarjeta débito", credit: "Tarjeta crédito",
  transfer: "Transferencia", check: "Cheque", refund: "Reembolso", other: "Otro",
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
  const canEditPrice = isPending && invoice.paid === 0;
  const s = INV_STATUS[status] ?? INV_STATUS.PENDING;

  function openSub(which: Exclude<SubAction, null>) {
    setRefundAmount(String(invoice?.paid ?? 0));
    setRefundReason("");
    setEditTotal(String(invoice?.total ?? 0));
    setDiscountAmt(String(invoice?.discount ?? 0));
    setCancelReason("");
    setSub(which);
  }

  async function callApi(path: string, method: "POST" | "PATCH", body?: any, successMsg?: string) {
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
        throw new Error(err.error ?? "Error en la operación");
      }
      toast.success(successMsg ?? "Operación exitosa");
      setSub(null);
      await onMutated();
      onClose();
      // Forzamos refresh del segmento server-rendered actual además de la
      // revalidatePath del endpoint. Así la página que monta el modal
      // (patient-detail, billing, home) refleja la mutación sin que el
      // parent tenga que cablear router.refresh() en onMutated.
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkPaid() {
    if (!confirm(`¿Marcar como pagada en efectivo? Se cobrará el saldo de ${formatCurrency(invoice!.balance)}.`)) return;
    await callApi("/mark-paid", "POST", {}, "Factura cobrada en efectivo");
  }

  async function handleCancel() {
    await callApi("/cancel", "POST", { reason: cancelReason.trim() || undefined }, "Factura cancelada");
  }

  async function handleRefund() {
    const amount = Number(refundAmount);
    if (!amount || amount <= 0) { toast.error("Monto inválido"); return; }
    if (amount > invoice!.paid) { toast.error("Excede lo pagado"); return; }
    await callApi("/refund", "POST", { amount, reason: refundReason.trim() || undefined }, "Reembolso registrado");
  }

  async function handleEditPrice() {
    const total = Number(editTotal);
    if (!isFinite(total) || total < 0) { toast.error("Total inválido"); return; }
    await callApi("/edit-price", "POST", { total }, "Precio actualizado");
  }

  async function handleDiscount() {
    const discount = Number(discountAmt);
    if (!isFinite(discount) || discount < 0) { toast.error("Descuento inválido"); return; }
    await callApi("/edit-price", "POST", { discount }, "Descuento aplicado");
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
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            {/* Resumen — usa tokens de tema (bg-muted/40, border-border, text-muted-foreground) */}
            <div className="bg-muted/40 border border-border rounded-lg p-3 text-xs space-y-1.5 text-foreground">
              <div className="flex justify-between"><span className="text-muted-foreground">Paciente</span><span className="font-medium">{patientName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Fecha</span><span>{formatDate(invoice.createdAt)}</span></div>
              {(invoice.discount ?? 0) > 0 && (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(invoice.subtotal ?? invoice.total + (invoice.discount ?? 0))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Descuento</span><span className="text-amber-600 dark:text-amber-400">−{formatCurrency(invoice.discount ?? 0)}</span></div>
                </>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-bold">{formatCurrency(invoice.total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pagado</span><span className="text-emerald-600 dark:text-emerald-400 font-bold">{formatCurrency(invoice.paid)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Saldo</span><span className="text-rose-600 dark:text-rose-400 font-bold">{formatCurrency(invoice.balance)}</span></div>
              {invoice.paymentMethod && (
                <div className="flex justify-between"><span className="text-muted-foreground">Método</span><span className="capitalize">{METHOD_LABELS[invoice.paymentMethod] ?? invoice.paymentMethod}</span></div>
              )}
              {invoice.cfdiUuid && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">CFDI UUID</span>
                  <span className="font-mono text-[10px] truncate">{invoice.cfdiUuid}</span>
                </div>
              )}
              {isCancelled && invoice.notes && (
                <div className="pt-2 border-t border-border mt-2">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wide">Notas</span>
                  <p className="text-[11px] mt-1 whitespace-pre-line">{invoice.notes}</p>
                </div>
              )}
            </div>

            {/* Conceptos */}
            {Array.isArray(invoice.items) && invoice.items.length > 0 && (
              <div>
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Conceptos</h3>
                <div className="bg-card border border-border rounded-lg divide-y divide-border">
                  {invoice.items.map((it: any, i: number) => (
                    <div key={i} className="px-3 py-2 flex items-center justify-between text-xs">
                      <div className="min-w-0">
                        <div className="font-medium truncate text-foreground">{it.description ?? it.name ?? `Concepto ${i + 1}`}</div>
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
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Movimientos</h3>
                <div className="bg-card border border-border rounded-lg divide-y divide-border">
                  {invoice.payments.map((p: any) => {
                    const isRefund = p.method === "refund";
                    return (
                      <div key={p.id} className="px-3 py-2 flex items-center justify-between text-xs">
                        <div className="min-w-0">
                          <div className={`font-medium ${isRefund ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
                            {METHOD_LABELS[p.method] ?? p.method ?? "—"}
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
            {/* PENDIENTE / PARCIAL */}
            {isPending && (
              <>
                <Button onClick={() => setPaymentOpen(true)} disabled={busy}>
                  <CreditCard size={14} aria-hidden /> Cobrar pago · {formatCurrency(invoice.balance)}
                </Button>
                <Button variant="outline" onClick={handleMarkPaid} disabled={busy} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                  <CheckCircle2 size={14} aria-hidden /> Marcar pagada
                </Button>
                {canEditPrice && (
                  <>
                    <Button variant="outline" onClick={() => openSub("edit-price")} disabled={busy}>
                      <Pencil size={14} aria-hidden /> Editar precio
                    </Button>
                    <Button variant="outline" onClick={() => openSub("discount")} disabled={busy}>
                      <Tag size={14} aria-hidden /> Aplicar descuento
                    </Button>
                  </>
                )}
                {invoice.paid === 0 && (
                  <Button variant="outline" onClick={() => openSub("cancel")} disabled={busy}
                    className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                    <XCircle size={14} aria-hidden /> Cancelar factura
                  </Button>
                )}
              </>
            )}

            {/* PAGADA */}
            {isPaid && (
              <>
                <Button variant="outline" onClick={() => openSub("refund")} disabled={busy}
                  className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                  <Undo2 size={14} aria-hidden /> Reembolsar
                </Button>
                {invoice.cfdiUuid && (
                  <Button variant="outline" onClick={() => {
                    navigator.clipboard.writeText(invoice.cfdiUuid!).catch(() => {});
                    toast.success("UUID CFDI copiado");
                  }}>
                    <FileText size={14} aria-hidden /> Copiar UUID CFDI
                  </Button>
                )}
              </>
            )}

            {/* Imprimir disponible siempre */}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer size={14} aria-hidden /> Imprimir
            </Button>

            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Reembolsar */}
      <Dialog open={sub === "refund"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">Reembolsar factura {invoice.invoiceNumber}</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">Pagado total: <span className="font-mono font-bold text-foreground">{formatCurrency(invoice.paid)}</span></p>
            <div className="space-y-1.5">
              <Label>Monto a reembolsar *</Label>
              <Input type="number" step="0.01" min={0} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Razón</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
                placeholder="Tratamiento no realizado, error de cobro, etc."
                value={refundReason} onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSub(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={handleRefund} disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white">
              {busy ? "Procesando…" : `Reembolsar ${formatCurrency(Number(refundAmount) || 0)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Editar precio */}
      <Dialog open={sub === "edit-price"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">Editar precio</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">Total actual: <span className="font-mono font-bold text-foreground">{formatCurrency(invoice.total)}</span></p>
            <div className="space-y-1.5">
              <Label>Nuevo total *</Label>
              <Input type="number" step="0.01" min={0} value={editTotal} onChange={(e) => setEditTotal(e.target.value)} autoFocus />
            </div>
            <p className="text-[11px] text-muted-foreground">Solo disponible mientras la factura no tenga pagos registrados.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSub(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={handleEditPrice} disabled={busy}>{busy ? "Guardando…" : "Guardar precio"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Aplicar descuento */}
      <Dialog open={sub === "discount"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">Aplicar descuento</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">Subtotal actual: <span className="font-mono font-bold text-foreground">{formatCurrency(invoice.subtotal ?? invoice.total + (invoice.discount ?? 0))}</span></p>
            <div className="space-y-1.5">
              <Label>Descuento (MXN) *</Label>
              <Input type="number" step="0.01" min={0} value={discountAmt} onChange={(e) => setDiscountAmt(e.target.value)} autoFocus />
            </div>
            <p className="text-[11px] text-muted-foreground">El total se recalcula como subtotal − descuento.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSub(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={handleDiscount} disabled={busy}>{busy ? "Aplicando…" : "Aplicar descuento"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Cancelar factura */}
      <Dialog open={sub === "cancel"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">Cancelar factura {invoice.invoiceNumber}</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">No podrá registrar pagos después. La razón quedará en el audit log y en las notas de la factura.</p>
            <div className="space-y-1.5">
              <Label>Razón (opcional)</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
                placeholder="Cita cancelada, paciente no se presentó, error en cobro…"
                value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSub(null)} disabled={busy}>Volver</Button>
            <Button onClick={handleCancel} disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white">
              {busy ? "Cancelando…" : "Confirmar cancelación"}
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
