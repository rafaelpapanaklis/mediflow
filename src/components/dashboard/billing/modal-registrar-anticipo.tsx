"use client";

// «Registrar anticipo recibido» (ws1-t3 fase 2) — recepción YA TIENE el
// dinero (efectivo, transferencia o terminal) y lo registra a mano, sin
// esperar ningún link ni webhook. Crea el Payment con su MÉTODO REAL
// (alimenta arqueo y CFDI) y, si hay cita ligada y sigue SCHEDULED, la
// confirma y le quita el apartado.

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, X } from "lucide-react";

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

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="registrar-anticipo-title"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl"
        style={{ width: "100%", maxWidth: 420, maxHeight: "90vh", overflow: "auto", color: "var(--text-1)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-1, #e5e7eb)" }}>
          <h2 id="registrar-anticipo-title" style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            Registrar anticipo recibido
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--text-2)" }}>
            Para cuando el dinero YA llegó (efectivo, transferencia o terminal): se registra como pago real de la
            factura y, si la cita seguía apartada, queda confirmada.
          </p>
          {saldo > 0 && <p style={{ fontSize: 13, color: "var(--text-2)" }}>Saldo de la factura: {fmt.format(saldo)}</p>}

          <Campo etiqueta="Monto recibido (MXN)">
            <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="0.00" style={inputStyle} />
          </Campo>

          <Campo etiqueta="Método">
            <select value={method} onChange={(e) => setMethod(e.target.value as MetodoRegistro)} style={inputStyle}>
              {METODOS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Campo>

          {method === "transfer" && (
            <Campo etiqueta="Referencia de la transferencia">
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Clave de rastreo, folio…" style={inputStyle} />
            </Campo>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button
              type="button"
              onClick={registrar}
              disabled={enviando}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8,
                border: "none", background: "var(--accent, #2563eb)", color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: enviando ? "not-allowed" : "pointer", opacity: enviando ? 0.6 : 1,
              }}
            >
              {enviando ? <Loader2 size={14} className="animate-spin" /> : null}
              {enviando ? "Registrando…" : "Registrar anticipo"}
            </button>
          </div>
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
