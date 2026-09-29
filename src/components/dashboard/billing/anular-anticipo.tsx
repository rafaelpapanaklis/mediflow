"use client";

// «Anular anticipo» (H7 de la revisión final, ws1-t4) — para un anticipo
// registrado por error. Se pinta solo si la factura tiene alguno que se pueda
// anular Y la sesión tiene permiso de cobro (lo decide el GET). Pide el
// motivo, que queda en el historial con quién y cuándo. Las reglas, en
// src/lib/anticipos/anular-core.ts.
//
// Mismo patrón de diálogo que modal-registrar-anticipo.tsx: Dialog de Radix
// de verdad, porque se abre desde el <Dialog> del detalle de la factura.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Label } from "@/components/ui/label";
import { MOTIVO_MINIMO, textoMetodo } from "@/lib/anticipos/anular-core";

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

interface Anulable {
  depositId: string;
  monto: number;
  method: string;
  paidAt: string | null;
  porMercadoPago: boolean;
}

export function AnularAnticipo({
  invoiceId,
  abierta,
  recarga,
  onListo,
  className,
}: {
  invoiceId: string;
  /** El detalle de la factura está abierto: solo entonces se pregunta. */
  abierta: boolean;
  /** Cambia cuando la factura se recarga (otro anticipo, un cobro…). */
  recarga?: number;
  onListo?: () => void;
  className?: string;
}) {
  const [anulables, setAnulables] = useState<Anulable[]>([]);
  const [dialogo, setDialogo] = useState(false);
  const [elegido, setElegido] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setAnulables([]);
    if (!abierta || !invoiceId) return;
    let vivo = true;
    fetch(`/api/invoices/${invoiceId}/anticipo/anular`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setAnulables(Array.isArray(d?.anulables) ? d.anulables : []); })
      .catch(() => { if (vivo) setAnulables([]); });
    return () => { vivo = false; };
  }, [abierta, invoiceId, recarga]);

  useEffect(() => {
    if (!dialogo) return;
    setElegido(anulables.length === 1 ? anulables[0].depositId : "");
    setMotivo("");
  }, [dialogo, anulables]);

  if (anulables.length === 0) return null;
  const actual = anulables.find((a) => a.depositId === elegido) ?? null;
  const motivoValido = motivo.trim().length >= MOTIVO_MINIMO;

  async function anular() {
    if (!actual || !motivoValido || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/anticipo/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositId: actual.depositId, motivo: motivo.trim() }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(out?.error ?? "No se pudo anular el anticipo.");
        return;
      }
      if (out?.aviso) toast(out.aviso, { duration: 10000 });
      else toast.success("Anticipo anulado. La factura volvió a como estaba.");
      setDialogo(false);
      onListo?.();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogo(true)}
        className={className ?? "inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/40"}
      >
        <Undo2 size={14} aria-hidden /> Anular anticipo
      </button>

      <Dialog open={dialogo} onOpenChange={(o) => { if (!o && !enviando) setDialogo(false); }}>
        <DialogContent className="max-w-md bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">Anular anticipo registrado por error</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              El pago deja de contar (también en la Caja) y la factura vuelve a como estaba. No se borra nada: queda
              anotado quién lo anuló, cuándo y por qué.
            </p>

            <div role="radiogroup" aria-label="Anticipo a anular" className="space-y-1.5">
              {anulables.map((a) => (
                <label key={a.depositId} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer">
                  <input
                    type="radio"
                    name="anticipo-a-anular"
                    checked={elegido === a.depositId}
                    onChange={() => setElegido(a.depositId)}
                  />
                  <span className="font-semibold">{fmt.format(a.monto)}</span>
                  <span className="text-muted-foreground">
                    · {textoMetodo(a.method)}
                    {a.paidAt ? ` · ${new Date(a.paidAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}` : ""}
                  </span>
                </label>
              ))}
            </div>

            {actual?.porMercadoPago && (
              <p role="note" className="rounded-md border border-[color:var(--warning-strong,#b45309)] px-3 py-2 text-xs">
                Este anticipo llegó por Mercado Pago: el dinero sí está en tu cuenta. Aquí solo se anula en el panel;
                el reembolso al paciente se hace en Mercado Pago.
              </p>
            )}

            <div className="space-y-1">
              <Label htmlFor="anular-anticipo-motivo">Motivo</Label>
              <textarea
                id="anular-anticipo-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Ej. se registró dos veces; el monto era $200, no $600…"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <ButtonNew variant="ghost" onClick={() => setDialogo(false)} disabled={enviando}>Cancelar</ButtonNew>
            <ButtonNew
              variant="primary"
              icon={enviando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : undefined}
              onClick={anular}
              disabled={!actual || !motivoValido || enviando}
            >
              {enviando ? "Anulando…" : actual ? `Anular ${fmt.format(actual.monto)}` : "Anular"}
            </ButtonNew>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
