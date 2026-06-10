"use client";

// Página de éxito tras el Checkout de Stripe (WS1-T4). El webhook confirma el
// pago de forma asíncrona: avisamos que puede tardar unos segundos y el SWR
// de /paciente/pagos (revalidateOnFocus + refresh 20s) lo refleja solo.
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PacienteCard } from "@/components/paciente/ui";

const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";

export default function PagoExitoPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT }}>Tus pagos</h1>
      <PacienteCard>
        <div style={{ textAlign: "center", padding: "28px 12px" }}>
          <CheckCircle2 size={48} color="#34d399" aria-hidden style={{ marginBottom: 12 }} />
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: TEXT }}>
            ¡Pago recibido!
          </h2>
          <p style={{ margin: "0 auto 18px", maxWidth: 420, color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
            Estamos confirmando tu pago con el banco. En unos segundos lo verás
            reflejado en tus pagos y podrás descargar tu recibo.
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
            Ver mis pagos
          </Link>
        </div>
      </PacienteCard>
    </div>
  );
}
