"use client";

// «Pedir anticipo» (ws1-t3 fase 1-2) — desde la cita o desde la factura.
//
// El monto SUGERIDO lo trae el servidor (Configuración → Anticipos → panel);
// es editable, pero lo que de verdad se cobra lo valida SIEMPRE el servidor
// (10 ≤ monto ≤ total − pagado). Si la cita todavía no tiene factura, pide
// además el concepto (nombre + precio) con el que se crea.
//
// Dos CANALES independientes (fase 2): Mercado Pago (link) o transferencia
// (datos bancarios de la sede, texto + PDF). Si solo hay uno disponible, se
// usa directo sin preguntar; con los dos, un selector.
//
// Al pedirlo: siempre "Copiar texto" (paciente, monto, fecha/hora, plazo,
// link o datos bancarios); "Enviar por WhatsApp" solo si el paciente escribió
// en las últimas 24 h (si no, el botón se apaga y dice por qué — nunca
// intenta una plantilla sin encender: eso lo decide Configuración → Anticipos).
//
// Ajuste 3 (QA t2, hallazgo B1): este modal se abre DESDE el detalle de la
// factura, que YA es un <Dialog> de Radix (invoice-detail-modal.tsx). Un
// <div role="dialog"> a mano, por mucho z-index y position:fixed que lleve,
// hereda el `pointer-events: none` que Radix pone en todo lo que no sea SU
// PROPIO Content mientras un Dialog está abierto — el clic (y el teclado)
// atraviesan al de abajo. La única forma correcta de anidar es un <Dialog>
// de Radix de verdad: por eso este componente usa Dialog/DialogContent, no
// una capa propia.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Copy, Download, ExternalLink, Link2, Loader2, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const fmtFecha = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

type MetodoAnticipo = "mercadopago" | "transferencia";

interface PendienteDTO {
  id: string;
  invoiceId: string;
  amount: number;
  expiresAt: string;
  checkoutUrl: string | null;
  apartada: boolean;
  metodo?: MetodoAnticipo;
}

interface CanalesDTO {
  mercadopago: boolean;
  transferencia: boolean;
}

interface EstadoGET {
  disponible: boolean;
  canales?: CanalesDTO;
  tieneFactura?: boolean; // solo en el endpoint de cita
  saldo?: number;
  sugerido: number | null;
  horasSugeridas: number;
  pendiente: PendienteDTO | null;
  /** Ajuste 2: SOLO citas futuras. false = ni se ofrece el formulario. */
  citaElegible?: boolean;
  motivoCitaNoElegible?: string | null;
}

interface ResultadoPOST {
  deposit: { invoiceId: string; checkoutUrl: string | null; metodo: MetodoAnticipo };
  texto: string;
  whatsapp: { enviado: boolean; motivo?: string };
}

export interface ModalPedirAnticipoProps {
  open: boolean;
  onClose: () => void;
  /** "cita" pide a /api/appointments/{id}/anticipo; "factura" a /api/invoices/{id}/anticipo. */
  origen: "cita" | "factura";
  id: string;
  /** Avisa al que lo montó (para refrescar la factura o la agenda). */
  onListo?: () => void;
}

export function ModalPedirAnticipo({ open, onClose, origen, id, onListo }: ModalPedirAnticipoProps) {
  const base = origen === "cita" ? `/api/appointments/${id}/anticipo` : `/api/invoices/${id}/anticipo`;

  const [cargando, setCargando] = useState(true);
  // QA t2: el GET puede fallar por algo que NO es "sin canales" (403, 500,
  // 502, red caída). Antes cualquier fallo se pintaba como "esta clínica no
  // tiene Mercado Pago conectado", que es falso y confunde a recepción.
  const [cargaError, setCargaError] = useState(false);
  const [estado, setEstado] = useState<EstadoGET | null>(null);
  const [metodo, setMetodo] = useState<MetodoAnticipo>("mercadopago");
  const [monto, setMonto] = useState("");
  const [horas, setHoras] = useState("24");
  const [descripcion, setDescripcion] = useState("");
  const [precio, setPrecio] = useState("");
  const [enviando, setEnviando] = useState<"solo" | "wa" | null>(null);
  const [resultado, setResultado] = useState<ResultadoPOST | null>(null);
  const [recargarTick, setRecargarTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setCargando(true);
    setCargaError(false);
    setResultado(null);
    fetch(base)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GET ${base} → ${r.status}`))))
      .then((d: EstadoGET) => {
        if (!vivo) return;
        setEstado(d);
        setMonto(d.sugerido != null ? String(d.sugerido) : "");
        setHoras(String(d.horasSugeridas ?? 24));
        // Con los dos canales disponibles, arranca en Mercado Pago (el de
        // siempre); con uno solo, ESE, aunque no sea mercadopago.
        if (d.canales?.mercadopago) setMetodo("mercadopago");
        else if (d.canales?.transferencia) setMetodo("transferencia");
      })
      .catch(() => {
        if (vivo) { setCargaError(true); setEstado(null); }
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [open, base, recargarTick]);

  const pedir = useCallback(
    async (enviarWhatsapp: boolean) => {
      const montoNum = Number(monto);
      if (!Number.isFinite(montoNum) || montoNum <= 0) {
        toast.error("Escribe un monto válido.");
        return;
      }
      const sinFactura = origen === "cita" && estado?.tieneFactura === false;
      if (sinFactura && (!descripcion.trim() || !Number.isFinite(Number(precio)))) {
        toast.error("Esta cita no tiene factura: escribe el concepto y el precio para crearla.");
        return;
      }
      setEnviando(enviarWhatsapp ? "wa" : "solo");
      try {
        const body: Record<string, unknown> = { monto: montoNum, metodo };
        const horasNum = Number(horas);
        if (Number.isFinite(horasNum) && horasNum > 0) body.horas = Math.round(horasNum);
        if (enviarWhatsapp) body.enviarWhatsapp = true;
        if (sinFactura) body.concepto = { description: descripcion.trim(), unitPrice: Number(precio) };

        const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(out?.error ?? "No se pudo pedir el anticipo.");
          return;
        }
        setResultado({ deposit: out.deposit, texto: out.texto, whatsapp: out.whatsapp });
        if (out.reutilizado) toast("Ya había un anticipo pendiente para esta factura: es el mismo.");
        else toast.success("Anticipo pedido.");
        if (enviarWhatsapp && out.whatsapp?.enviado) toast.success("Enviado por WhatsApp.");
        else if (enviarWhatsapp && out.whatsapp?.motivo) toast(out.whatsapp.motivo);
        onListo?.();
      } finally {
        setEnviando(null);
      }
    },
    [monto, horas, origen, estado, descripcion, precio, base, metodo, onListo],
  );

  const copiarTexto = useCallback(async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Texto copiado.");
    } catch {
      toast.error("No se pudo copiar.");
    }
  }, []);

  const sinFactura = origen === "cita" && estado?.tieneFactura === false;
  const pendiente = estado?.pendiente ?? null;
  const canales = estado?.canales;
  const dosCanal = !!canales?.mercadopago && !!canales?.transferencia;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pedir anticipo</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3.5 flex-1 overflow-y-auto min-h-0 text-sm">
          {cargando ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Cargando…
            </div>
          ) : cargaError ? (
            <>
              <p className="text-[color:var(--warning)]">
                No se pudo cargar la información del anticipo. Inténtalo de nuevo.
              </p>
              <ButtonNew variant="secondary" onClick={() => setRecargarTick((n) => n + 1)}>
                Reintentar
              </ButtonNew>
            </>
          ) : !estado?.disponible ? (
            <p className="text-muted-foreground">
              Esta clínica no tiene Mercado Pago conectado ni datos bancarios cargados. Actívalos en
              Configuración → Anticipos.
            </p>
          ) : resultado ? (
            <>
              <p>{resultado.deposit.metodo === "transferencia" ? "La solicitud de transferencia está lista." : "El link de pago está listo."}</p>
              <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/40 text-xs whitespace-pre-wrap">
                {resultado.texto}
              </div>
              {resultado.whatsapp?.motivo && !resultado.whatsapp.enviado && (
                <p className="text-xs text-[color:var(--warning)]">{resultado.whatsapp.motivo}</p>
              )}
              <div className="flex gap-2 flex-wrap">
                <ButtonNew variant="secondary" icon={<Copy size={14} />} onClick={() => copiarTexto(resultado.texto)}>
                  Copiar texto
                </ButtonNew>
                {resultado.deposit.metodo === "mercadopago" && resultado.deposit.checkoutUrl ? (
                  <ButtonNew
                    variant="secondary"
                    icon={<ExternalLink size={14} />}
                    onClick={() => window.open(resultado.deposit.checkoutUrl!, "_blank", "noopener,noreferrer")}
                  >
                    Abrir link
                  </ButtonNew>
                ) : (
                  <ButtonNew
                    variant="secondary"
                    icon={<Download size={14} />}
                    onClick={() => window.open(`/api/invoices/${resultado.deposit.invoiceId}/anticipo/solicitud-pdf`, "_blank", "noopener,noreferrer")}
                  >
                    Descargar PDF
                  </ButtonNew>
                )}
              </div>
              <ButtonNew variant="primary" onClick={onClose}>Listo</ButtonNew>
            </>
          ) : pendiente ? (
            <>
              <p>
                Ya hay un anticipo pendiente: <strong>{fmt.format(pendiente.amount)}</strong>, vence el {fmtFecha(pendiente.expiresAt)}.
                {pendiente.apartada ? " La cita sigue apartada mientras tanto." : ""}
              </p>
              <div className="flex gap-2 flex-wrap">
                {pendiente.metodo === "transferencia" ? (
                  <ButtonNew
                    variant="secondary"
                    icon={<Download size={14} />}
                    onClick={() => window.open(`/api/invoices/${pendiente.invoiceId}/anticipo/solicitud-pdf`, "_blank", "noopener,noreferrer")}
                  >
                    Descargar PDF con los datos bancarios
                  </ButtonNew>
                ) : (
                  pendiente.checkoutUrl && (
                    <>
                      <ButtonNew variant="secondary" icon={<Copy size={14} />} onClick={() => copiarTexto(pendiente.checkoutUrl!)}>
                        Copiar link
                      </ButtonNew>
                      <ButtonNew variant="secondary" icon={<ExternalLink size={14} />} onClick={() => window.open(pendiente.checkoutUrl!, "_blank", "noopener,noreferrer")}>
                        Abrir link
                      </ButtonNew>
                    </>
                  )
                )}
              </div>
            </>
          ) : estado?.citaElegible === false ? (
            <p className="text-muted-foreground">{estado.motivoCitaNoElegible}</p>
          ) : (
            <>
              {sinFactura && (
                <>
                  <p className="text-xs text-muted-foreground">Esta cita todavía no tiene factura: se crea con este concepto.</p>
                  <div className="space-y-1.5">
                    <Label>Concepto</Label>
                    <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Consulta + limpieza" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Precio del concepto (MXN)</Label>
                    <Input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0.00" />
                  </div>
                </>
              )}
              {typeof estado?.saldo === "number" && (
                <p className="text-xs text-muted-foreground">Saldo de la factura: {fmt.format(estado.saldo)}</p>
              )}
              {dosCanal && (
                <div className="space-y-1.5">
                  <Label>Cómo se cobra</Label>
                  <select
                    value={metodo}
                    onChange={(e) => setMetodo(e.target.value as MetodoAnticipo)}
                    className="flex h-10 w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600"
                  >
                    <option value="mercadopago">Mercado Pago (link)</option>
                    <option value="transferencia">Transferencia (datos bancarios)</option>
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Monto del anticipo (MXN)</Label>
                <Input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Plazo para pagar (horas)</Label>
                <Input value={horas} onChange={(e) => setHoras(e.target.value)} inputMode="numeric" />
              </div>
              <div className="flex gap-2 flex-wrap pt-1">
                <ButtonNew variant="primary" icon={enviando === "solo" ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} onClick={() => pedir(false)} disabled={enviando !== null}>
                  {enviando === "solo" ? "Pidiendo…" : "Pedir anticipo"}
                </ButtonNew>
                <ButtonNew variant="secondary" icon={enviando === "wa" ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} onClick={() => pedir(true)} disabled={enviando !== null}>
                  {enviando === "wa" ? "Enviando…" : "Pedir y enviar por WhatsApp"}
                </ButtonNew>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
