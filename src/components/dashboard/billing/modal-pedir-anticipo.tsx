"use client";

// «Pedir anticipo» (ws1-t3 fase 1) — desde la cita o desde la factura.
//
// El monto SUGERIDO lo trae el servidor (Configuración → Anticipos → panel);
// es editable, pero lo que de verdad se cobra lo valida SIEMPRE el servidor
// (10 ≤ monto ≤ total − pagado). Si la cita todavía no tiene factura, pide
// además el concepto (nombre + precio) con el que se crea.
//
// Al pedirlo: siempre "Copiar texto" (paciente, monto, fecha/hora, plazo,
// link); "Enviar por WhatsApp" solo si el paciente escribió en las últimas
// 24 h (si no, el botón se apaga y dice por qué — nunca intenta una plantilla
// que no existe: esa es fase 3).

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Copy, ExternalLink, Link2, Loader2, MessageCircle, X } from "lucide-react";

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const fmtFecha = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

interface PendienteDTO {
  id: string;
  amount: number;
  expiresAt: string;
  checkoutUrl: string | null;
  apartada: boolean;
}

interface EstadoGET {
  disponible: boolean;
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
  checkoutUrl: string;
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
  const [estado, setEstado] = useState<EstadoGET | null>(null);
  const [monto, setMonto] = useState("");
  const [horas, setHoras] = useState("24");
  const [descripcion, setDescripcion] = useState("");
  const [precio, setPrecio] = useState("");
  const [enviando, setEnviando] = useState<"solo" | "wa" | null>(null);
  const [resultado, setResultado] = useState<ResultadoPOST | null>(null);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setCargando(true);
    setResultado(null);
    fetch(base)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EstadoGET | null) => {
        if (!vivo || !d) return;
        setEstado(d);
        setMonto(d.sugerido != null ? String(d.sugerido) : "");
        setHoras(String(d.horasSugeridas ?? 24));
      })
      .catch(() => {
        if (vivo) setEstado({ disponible: false, sugerido: null, horasSugeridas: 24, pendiente: null });
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [open, base]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
        const body: Record<string, unknown> = { monto: montoNum };
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
        setResultado({ checkoutUrl: out.deposit.checkoutUrl, texto: out.texto, whatsapp: out.whatsapp });
        if (out.reutilizado) toast("Ya había un anticipo pendiente para esta factura: es el mismo link.");
        else toast.success("Anticipo pedido.");
        if (enviarWhatsapp && out.whatsapp?.enviado) toast.success("Enviado por WhatsApp.");
        else if (enviarWhatsapp && out.whatsapp?.motivo) toast(out.whatsapp.motivo);
        onListo?.();
      } finally {
        setEnviando(null);
      }
    },
    [monto, horas, origen, estado, descripcion, precio, base, onListo],
  );

  const copiarTexto = useCallback(async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Texto copiado.");
    } catch {
      toast.error("No se pudo copiar.");
    }
  }, []);

  if (!open) return null;

  const sinFactura = origen === "cita" && estado?.tieneFactura === false;
  const pendiente = estado?.pendiente ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pedir-anticipo-title"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl"
        style={{ width: "100%", maxWidth: 440, maxHeight: "90vh", overflow: "auto", color: "var(--text-1)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-1, #e5e7eb)" }}>
          <h2 id="pedir-anticipo-title" style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            Pedir anticipo
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {cargando ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)" }}>
              <Loader2 size={16} className="animate-spin" /> Cargando…
            </div>
          ) : !estado?.disponible ? (
            <p style={{ fontSize: 14, color: "var(--text-2)" }}>
              Esta clínica no tiene Mercado Pago conectado. Conéctalo en Configuración → Anticipos.
            </p>
          ) : resultado ? (
            <>
              <p style={{ fontSize: 14 }}>El link de pago está listo.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: "var(--bg-2, #f7f7f8)", fontSize: 13, whiteSpace: "pre-wrap" }}>
                {resultado.texto}
              </div>
              {resultado.whatsapp?.motivo && !resultado.whatsapp.enviado && (
                <p style={{ fontSize: 12, color: "var(--warning-strong, #b45309)" }}>{resultado.whatsapp.motivo}</p>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <BotonSecundario icon={<Copy size={14} />} onClick={() => copiarTexto(resultado.texto)}>
                  Copiar texto
                </BotonSecundario>
                <BotonSecundario icon={<ExternalLink size={14} />} onClick={() => window.open(resultado.checkoutUrl, "_blank", "noopener,noreferrer")}>
                  Abrir link
                </BotonSecundario>
              </div>
              <BotonPrimario onClick={onClose}>Listo</BotonPrimario>
            </>
          ) : pendiente ? (
            <>
              <p style={{ fontSize: 14 }}>
                Ya hay un anticipo pendiente: <strong>{fmt.format(pendiente.amount)}</strong>, vence el {fmtFecha(pendiente.expiresAt)}.
                {pendiente.apartada ? " La cita sigue apartada mientras tanto." : ""}
              </p>
              {pendiente.checkoutUrl && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <BotonSecundario icon={<Copy size={14} />} onClick={() => copiarTexto(pendiente.checkoutUrl!)}>
                    Copiar link
                  </BotonSecundario>
                  <BotonSecundario icon={<ExternalLink size={14} />} onClick={() => window.open(pendiente.checkoutUrl!, "_blank", "noopener,noreferrer")}>
                    Abrir link
                  </BotonSecundario>
                </div>
              )}
            </>
          ) : estado?.citaElegible === false ? (
            <p style={{ fontSize: 14, color: "var(--text-2)" }}>{estado.motivoCitaNoElegible}</p>
          ) : (
            <>
              {sinFactura && (
                <>
                  <p style={{ fontSize: 13, color: "var(--text-2)" }}>Esta cita todavía no tiene factura: se crea con este concepto.</p>
                  <Campo etiqueta="Concepto">
                    <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Consulta + limpieza" style={inputStyle} />
                  </Campo>
                  <Campo etiqueta="Precio del concepto (MXN)">
                    <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0.00" style={inputStyle} />
                  </Campo>
                </>
              )}
              {typeof estado?.saldo === "number" && (
                <p style={{ fontSize: 13, color: "var(--text-2)" }}>Saldo de la factura: {fmt.format(estado.saldo)}</p>
              )}
              <Campo etiqueta="Monto del anticipo (MXN)">
                <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="0.00" style={inputStyle} />
              </Campo>
              <Campo etiqueta="Plazo para pagar (horas)">
                <input value={horas} onChange={(e) => setHoras(e.target.value)} inputMode="numeric" style={inputStyle} />
              </Campo>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <BotonPrimario icon={enviando === "solo" ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} onClick={() => pedir(false)} disabled={enviando !== null}>
                  {enviando === "solo" ? "Pidiendo…" : "Pedir anticipo"}
                </BotonPrimario>
                <BotonSecundario icon={enviando === "wa" ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} onClick={() => pedir(true)} disabled={enviando !== null}>
                  {enviando === "wa" ? "Enviando…" : "Pedir y enviar por WhatsApp"}
                </BotonSecundario>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-1, #d1d5db)",
  fontSize: 14,
  background: "var(--bg-1, #fff)",
  color: "inherit",
};

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>
      {etiqueta}
      {children}
    </label>
  );
}

function BotonPrimario({ children, onClick, disabled, icon }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8,
        border: "none", background: "var(--accent, #2563eb)", color: "#fff", fontSize: 13, fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function BotonSecundario({ children, onClick, disabled, icon }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8,
        border: "1px solid var(--border-1, #d1d5db)", background: "transparent", color: "inherit", fontSize: 13, fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon}
      {children}
    </button>
  );
}
