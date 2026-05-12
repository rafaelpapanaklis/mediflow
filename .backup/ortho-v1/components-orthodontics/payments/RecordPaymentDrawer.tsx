"use client";
// Orthodontics — drawer 480px para registrar pago de mensualidad. SPEC §6.9.

import { useState } from "react";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import type { OrthoInstallmentRow } from "@/lib/types/orthodontics";
import type { OrthoPaymentMethod } from "@prisma/client";
import { recordInstallmentPayment } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { BackdateJustificationModal } from "./BackdateJustificationModal";

const METHODS: OrthoPaymentMethod[] = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "BANK_TRANSFER",
  "CHECK",
  "WALLET",
];

const SIXTY_DAYS_MS = 60 * 86_400_000;

export interface RecordPaymentDrawerProps {
  installment: OrthoInstallmentRow;
  onClose: () => void;
  onPaid?: (installmentId: string) => void;
}

export function RecordPaymentDrawer(props: RecordPaymentDrawerProps) {
  const i = props.installment;
  const today = new Date().toISOString().slice(0, 10);
  const [paidAt, setPaidAt] = useState(today);
  const [amountPaid, setAmountPaid] = useState(Number(i.amount));
  const [method, setMethod] = useState<OrthoPaymentMethod>("DEBIT_CARD");
  const [pending, setPending] = useState(false);
  const [justifyOpen, setJustifyOpen] = useState(false);
  const [pendingJustification, setPendingJustification] = useState<string | null>(null);

  const isOutOfRange = (() => {
    const paidDate = new Date(paidAt);
    const minPaid = new Date(i.dueDate.getTime() - SIXTY_DAYS_MS);
    const max = new Date();
    return paidDate < minPaid || paidDate > max;
  })();

  const submit = async (justification?: string) => {
    setPending(true);
    try {
      const result = await recordInstallmentPayment({
        installmentId: i.id,
        paidAt: new Date(paidAt).toISOString(),
        amountPaid,
        paymentMethod: method,
        backdatingJustification: justification ?? null,
      });
      if (isFailure(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Pago registrado");
      props.onPaid?.(result.data.id);
      props.onClose();
    } finally {
      setPending(false);
    }
  };

  const handleConfirm = () => {
    if (isOutOfRange) {
      setJustifyOpen(true);
      return;
    }
    void submit();
  };

  const handleJustificationConfirm = (text: string) => {
    setPendingJustification(text);
    setJustifyOpen(false);
    void submit(text);
  };

  void pendingJustification;

  return (
    <>
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 1400,
        }}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: "var(--bg)",
          borderLeft: "1px solid var(--border)",
          zIndex: 1401,
          padding: 20,
          overflowY: "auto",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>
            Registrar pago · #{i.installmentNumber}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-2)",
              cursor: "pointer",
            }}
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-3)" }}>
          Vence: {new Date(i.dueDate).toLocaleDateString("es-MX")} · Monto esperado:
          ${Number(i.amount).toLocaleString("es-MX")} MXN
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Row label="Fecha de pago">
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              style={inputStyle}
            />
            {isOutOfRange ? (
              <span style={{ fontSize: 11, color: "#F59E0B", marginTop: 4 }}>
                ⚠ Fuera del rango ±60 días — exigirá justificación.
              </span>
            ) : null}
          </Row>
          <Row label="Monto pagado (MXN)">
            <input
              type="number"
              value={amountPaid}
              onChange={(e) => setAmountPaid(Number(e.target.value))}
              min={1}
              step={1}
              style={inputStyle}
            />
            <span style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
              Tolerancia ±5% del monto esperado.
            </span>
          </Row>
          <Row label="Método de pago">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as OrthoPaymentMethod)}
              style={inputStyle}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </Row>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
          <button
            type="button"
            onClick={props.onClose}
            disabled={pending}
            style={{
              flex: 1,
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            style={{
              flex: 1,
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--brand, #6366f1)",
              background: "var(--brand, #6366f1)",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "Guardando..." : "Confirmar pago"}
          </button>
        </div>
      </aside>

      <BackdateJustificationModal
        open={justifyOpen}
        onCancel={() => setJustifyOpen(false)}
        onConfirm={handleJustificationConfirm}
        pending={pending}
      />
    </>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--text-2)" }}>{props.label}</span>
      {props.children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--bg-elev)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 12,
};
