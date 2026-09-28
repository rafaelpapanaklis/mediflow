"use client";

// «Registrar anticipo recibido» (ws1-t3 fase 2) — recepción YA TIENE el
// dinero (efectivo, transferencia o terminal) y lo registra a mano, sin
// esperar ningún link ni webhook. Crea el Payment con su MÉTODO REAL
// (alimenta arqueo y CFDI) y, si hay cita ligada y sigue SCHEDULED, la
// confirma y le quita el apartado.
//
// Ajuste 3 (QA t2, hallazgo B1): igual que modal-pedir-anticipo.tsx, este
// modal se abre DESDE el <Dialog> de Radix del detalle de la factura. Un
// <div role="dialog"> a mano hereda el `pointer-events: none` que Radix pone
// en todo lo que no sea su propio Content mientras un Dialog está abierto
// (el clic atravesaba a "Registrar pago" de debajo). Por eso usa Dialog/
// DialogContent de verdad, no una capa propia.

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

type MetodoRegistro = "cash" | "transfer" | "debit" | "credit";

const METODOS: { value: MetodoRegistro; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "debit", label: "Terminal · débito" },
  { value: "credit", label: "Terminal · crédito" },
];

export interface ModalRegistrarAnticipoProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  saldo: number;
  /** Avisa al que lo montó (para refrescar la factura). */
  onListo?: () => void;
}

export function ModalRegistrarAnticipo({ open, onClose, invoiceId, saldo, onListo }: ModalRegistrarAnticipoProps) {
  const [monto, setMonto] = useState(() => (saldo > 0 ? String(saldo) : ""));
  const [method, setMethod] = useState<MetodoRegistro>("cash");
  const [reference, setReference] = useState("");
  const [enviando, setEnviando] = useState(false);

  const registrar = useCallback(async () => {
    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      toast.error("Escribe un monto válido.");
      return;
    }
    if (method === "transfer" && !reference.trim()) {
      toast.error("Para transferencia, escribe la referencia del depósito.");
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/anticipo/registrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: montoNum, method, reference: reference.trim() || undefined }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(out?.error ?? "No se pudo registrar el anticipo.");
        return;
      }
      if (out.registrado?.anomalia) {
        toast(out.registrado.anomalia, { duration: 8000 });
      } else if (out.registrado?.citaConfirmada) {
        toast.success("Anticipo registrado. La cita quedó confirmada.");
      } else {
        toast.success("Anticipo registrado.");
      }
      onListo?.();
      onClose();
    } finally {
      setEnviando(false);
    }
  }, [monto, method, reference, invoiceId, onListo, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar anticipo recibido</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3.5 flex-1 overflow-y-auto min-h-0 text-sm">
          <p className="text-xs text-muted-foreground">
            Para cuando el dinero YA llegó (efectivo, transferencia o terminal): se registra como pago real de la
            factura y, si la cita seguía apartada, queda confirmada.
          </p>
          {saldo > 0 && <p className="text-xs text-muted-foreground">Saldo de la factura: {fmt.format(saldo)}</p>}

          <div className="space-y-1.5">
            <Label>Monto recibido (MXN)</Label>
            <Input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="0.00" />
          </div>

          <div className="space-y-1.5">
            <Label>Método</Label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as MetodoRegistro)}
              className="flex h-10 w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600"
            >
              {METODOS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {method === "transfer" && (
            <div className="space-y-1.5">
              <Label>Referencia de la transferencia</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Clave de rastreo, folio…" />
            </div>
          )}

          <div className="flex gap-2 flex-wrap pt-1">
            <ButtonNew variant="primary" icon={enviando ? <Loader2 size={14} className="animate-spin" /> : undefined} onClick={registrar} disabled={enviando}>
              {enviando ? "Registrando…" : "Registrar anticipo"}
            </ButtonNew>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
