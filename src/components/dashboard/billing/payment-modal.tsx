"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, Banknote, ArrowLeftRight, Wallet, FileCheck2, MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";

export type PaymentMethod = "cash" | "debit" | "credit" | "transfer" | "check" | "other";

const METHODS: { value: PaymentMethod; label: string; icon: typeof CreditCard }[] = [
  { value: "cash",     label: "Efectivo",          icon: Banknote },
  { value: "debit",    label: "Tarjeta débito",    icon: CreditCard },
  { value: "credit",   label: "Tarjeta crédito",   icon: CreditCard },
  { value: "transfer", label: "Transferencia",     icon: ArrowLeftRight },
  { value: "check",    label: "Cheque",            icon: FileCheck2 },
  { value: "other",    label: "Otro",              icon: MoreHorizontal },
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
}

export function PaymentModal({ open, invoice, onClose, onSuccess }: PaymentModalProps) {
  const [amount, setAmount]       = useState("");
  const [method, setMethod]       = useState<PaymentMethod>("cash");
  const [paidAt, setPaidAt]       = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);

  // Reset whenever the modal opens for a new invoice.
  useEffect(() => {
    if (!open || !invoice) return;
    setAmount(String(invoice.balance ?? 0));
    setMethod("cash");
    setPaidAt(new Date().toISOString().slice(0, 10));
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
          paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo registrar el pago");
      }
      toast.success("Pago registrado correctamente");
      onSuccess();
    } catch (err: any) {
      toast.error(err.message ?? "Error al registrar el pago");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground font-bold">Registrar pago</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          <div className="bg-muted/40 border border-border rounded-lg p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Factura</span>
              <span className="font-mono font-bold">{invoice.invoiceNumber}</span>
            </div>
            {invoice.patientName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paciente</span>
                <span className="font-medium">{invoice.patientName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold">{formatCurrency(invoice.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pagado</span>
              <span className="text-emerald-600 font-bold">{formatCurrency(invoice.paid)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Saldo pendiente</span>
              <span className="text-rose-600 font-bold">{formatCurrency(invoice.balance)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Monto a cobrar *</Label>
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
              <p className="text-[11px] text-rose-600">
                El monto excede el saldo pendiente ({formatCurrency(invoice.balance)}).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Método de pago *</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = m.value === method;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-[11px] font-semibold transition-colors ${
                      active
                        ? "bg-brand-600 text-white border-brand-600"
                        : "bg-card text-foreground border-border hover:bg-muted/50"
                    }`}
                  >
                    <Icon size={14} aria-hidden />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Referencia</Label>
              <Input
                placeholder={method === "transfer" ? "# transferencia" : method === "check" ? "# cheque" : "# autorización"}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
              placeholder="Opcional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={isInvalid || saving}>
            {saving ? "Registrando…" : `Registrar pago${amountNum ? " · " + formatCurrency(amountNum) : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
