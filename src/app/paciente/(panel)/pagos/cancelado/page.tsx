"use client";

// Página de cancelación del Checkout de Stripe (WS1-T4): el paciente cerró o
// canceló el pago — no se hizo ningún cargo.
import Link from "next/link";
import { XCircle } from "lucide-react";
import { PacienteCard } from "@/components/paciente/ui";

const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";

export default function PagoCanceladoPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT }}>Tus pagos</h1>
      <PacienteCard>
        <div style={{ textAlign: "center", padding: "28px 12px" }}>
          <XCircle size={48} color="#fbbf24" aria-hidden style={{ marginBottom: 12 }} />
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: TEXT }}>
            Pago cancelado
          </h2>
          <p style={{ margin: "0 auto 18px", maxWidth: 420, color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
            No se realizó ningún cargo a tu tarjeta. Puedes intentarlo de nuevo
            cuando quieras desde tus pagos pendientes.
          </p>
          <Link
            href="/paciente/pagos"
            style={{
              display: "inline-block",
              background: "#7c3aed",
              color: "#fff",
              borderRadius: 10,
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Volver a mis pagos
          </Link>
        </div>
      </PacienteCard>
    </div>
  );
}
