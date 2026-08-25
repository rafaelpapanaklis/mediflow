// ═══════════════════════════════════════════════════════════════════════
// Pantalla de "no puedes entrar aquí" del área de rentas y cobranza.
//
// Dos motivos, dos textos distintos y ninguna pantalla en blanco:
//   · plan       → tu plan no incluye esto, y se dice cuál sí.
//   · permission → tu usuario no tiene el permiso, y se dice a quién pedirlo.
// Un 403 mudo es indistinguible de una pantalla rota; el usuario se queda
// creyendo que el producto falla.
//
// Server component: sin estado ni eventos, así que no lleva "use client".
// ═══════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { CreditCard, Lock } from "lucide-react";

export function RealtyAreaDenied({
  kind,
  title,
}: {
  kind: "plan" | "permission";
  title: string;
}) {
  const isPlan = kind === "plan";
  const Icon = isPlan ? CreditCard : Lock;

  return (
    <div style={{ minHeight: "58vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(22px, 4vw, 36px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 14,
          boxShadow: "var(--shadow-2)",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 15,
            display: "grid",
            placeItems: "center",
            background: "var(--brand-soft)",
            border: "1px solid var(--border-brand)",
            color: "var(--brand)",
          }}
        >
          <Icon size={23} />
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>
          {isPlan
            ? "Los contratos de renta y la cobranza vienen incluidos desde el plan Propietario. Tu cuenta no los tiene habilitados ahora mismo."
            : "Tu usuario no tiene permiso para esta sección. Pídeselo a quien administra la cuenta: es el permiso de contratos de arrendamiento y el de cobros."}
        </p>
        {isPlan ? (
          <Link href="/inmobiliaria/suscripcion" className="realty-btn-primary" style={{ padding: "10px 18px", textDecoration: "none", fontSize: 14 }}>
            Ver mi suscripción
          </Link>
        ) : null}
      </div>
    </div>
  );
}
