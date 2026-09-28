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

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ArrowLeftRight, Banknote, CreditCard, Info, Loader2, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Diseño (ws1-t5): de la FAMILIA de la factura, igual que «Pedir anticipo».
// Ver la nota en modal-pedir-anticipo.tsx. Solo cambia la ropa.
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import a from "@/components/dashboard/cobros-inventario-rediseno/anticipo.module.css";
import { useRedisenoActivo } from "@/components/dashboard/cobros-inventario-rediseno/rediseno-activo";

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

type MetodoRegistro = "cash" | "transfer" | "debit" | "credit";

const METODOS: { value: MetodoRegistro; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "debit", label: "Terminal · débito" },
  { value: "credit", label: "Terminal · crédito" },
];

/** El ícono de cada método: solo dibujo, no cambia qué se envía. */
const ICONO_METODO: Record<MetodoRegistro, LucideIcon> = {
  cash: Banknote,
  transfer: ArrowLeftRight,
  debit: CreditCard,
  credit: CreditCard,
};

export interface ModalRegistrarAnticipoProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  saldo: number;
  /**
   * ws1-t1 (M3): el anticipo PENDING de esta factura, si lo hay — «Registrar
   * anticipo recibido» sobre esa factura casi siempre es ESE dinero llegando
   * (el que ya se pidió), no el saldo completo. Prellena con su monto y lo
   * menciona; sigue siendo editable si de verdad llegó un monto distinto.
   */
  anticipoPendiente?: { id: string; amount: number; metodo: string } | null;
  /** Avisa al que lo montó (para refrescar la factura). */
  onListo?: () => void;
  /** ¿Diseño nuevo? Solo decide la ropa; si no llega, se detecta. */
  rediseno?: boolean;
}

export function ModalRegistrarAnticipo({ open, onClose, invoiceId, saldo, anticipoPendiente, onListo, rediseno: redisenoProp }: ModalRegistrarAnticipoProps) {
  const redisenoDetectado = useRedisenoActivo();
  const rediseno = redisenoProp ?? redisenoDetectado;
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);
  // Un campo: la maqueta propia y, con el diseño nuevo, el rótulo de la familia.
  const campo = `${a.campo} ${rediseno ? c.campo : ""}`;
  // ws1-t1 (M3): prellena con el anticipo PENDING si lo hay (lo más probable
  // es que sea ESE dinero); sin uno, el saldo completo, como antes.
  const prefill = () => (anticipoPendiente && anticipoPendiente.amount > 0 ? String(anticipoPendiente.amount) : saldo > 0 ? String(saldo) : "");
  const [monto, setMonto] = useState(prefill);
  const [method, setMethod] = useState<MetodoRegistro>("cash");
  const [reference, setReference] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Este modal no se desmonta entre aperturas (vive dentro de
  // invoice-detail-modal.tsx, que sí se remonta, pero no en cada clic de
  // "Registrar anticipo recibido"): sin este efecto, reabrirlo repetía el
  // prellenado de la primera vez en vez del anticipo pendiente ACTUAL.
  useEffect(() => {
    if (!open) return;
    setMonto(prefill());
    setMethod("cash");
    setReference("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anticipoPendiente?.id, anticipoPendiente?.amount, saldo]);

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
      <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)}>
        <DialogHeader className={rediseno ? c.cabecera : undefined}>
          <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>Registrar anticipo recibido</DialogTitle>
        </DialogHeader>

        <div className={`${a.anticipo} ${cx(a.cuerpoClasico, c.cuerpo)}`}>
          <p className={a.texto}>
            Para cuando el dinero YA llegó (efectivo, transferencia o terminal): se registra como pago real de la
            factura y, si la cita seguía apartada, queda confirmada.
          </p>
          {saldo > 0 && (
            <div className={a.resumen}>
              <span className={a.resumenRotulo}>Saldo de la factura</span>
              <span className={a.resumenCifra}>{fmt.format(saldo)}</span>
            </div>
          )}

          {/* ws1-t1 (M3): esta factura YA tiene un anticipo pedido y sin
              cobrar — lo más probable es que este registro sea ESE dinero
              llegando, no un cobro aparte. */}
          {anticipoPendiente && anticipoPendiente.amount > 0 && (
            <p className={`${a.nota} ${a.notaInfo}`}>
              <Info size={16} strokeWidth={1.75} aria-hidden />
              <span>
                Ya hay un anticipo pendiente de <strong>{fmt.format(anticipoPendiente.amount)}</strong>
                {anticipoPendiente.metodo === "transferencia" ? " por transferencia" : ""}: si es este dinero el que llegó, deja el monto como está.
              </span>
            </p>
          )}

          <div className={campo}>
            <Label htmlFor="anticipo-recibido">Monto recibido (MXN)</Label>
            <div className={a.importe}>
              <span className={a.importeSigno} aria-hidden>$</span>
              <Input id="anticipo-recibido" value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="0.00" />
            </div>
          </div>

          <div className={campo} role="radiogroup" aria-labelledby="anticipo-metodo">
            <Label id="anticipo-metodo">Método</Label>
            {/* Las cuatro opciones a la vista en vez de un desplegable: un clic
                menos y se ve cuál está elegida. Mismo estado (`method`). */}
            <div className={a.opciones}>
              {METODOS.map((m) => {
                const Icono = ICONO_METODO[m.value];
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={method === m.value}
                    onClick={() => setMethod(m.value)}
                    className={`${a.opcion} ${method === m.value ? a.opcionActiva : ""}`}
                  >
                    <Icono size={16} strokeWidth={1.75} aria-hidden />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {method === "transfer" && (
            <div className={campo}>
              <Label htmlFor="anticipo-referencia">Referencia de la transferencia</Label>
              <Input id="anticipo-referencia" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Clave de rastreo, folio…" />
            </div>
          )}
        </div>

        <DialogFooter className={`${a.pie} ${rediseno ? c.pie : ""}`}>
          <ButtonNew variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</ButtonNew>
          <ButtonNew variant="primary" icon={enviando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : undefined} onClick={registrar} disabled={enviando}>
            {enviando ? "Registrando…" : "Registrar anticipo"}
          </ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
