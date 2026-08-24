// ═══════════════════════════════════════════════════════════════════════
// Pantalla de "esta área no es para ti (todavía)". Dos motivos distintos y
// dos mensajes distintos, porque no es lo mismo "tu plan no lo incluye"
// (se arregla con dinero) que "no tienes el permiso" (se arregla con el
// dueño). Un mensaje genérico manda al usuario a adivinar.
//
// Es un componente de SERVIDOR: lo pinta la página después de que el gate
// del servidor ya dijo que no. La UI nunca es el candado, solo la cara del
// candado.
// ═══════════════════════════════════════════════════════════════════════
import { Lock, Sparkles } from "lucide-react";

export function BarberAreaLocked({
  reason,
  areaKey,
  planName,
}: {
  reason: "plan" | "permission";
  areaKey: "agenda" | "fila";
  planName?: string;
}) {
  const isPlan = reason === "plan";
  const Icon = isPlan ? Sparkles : Lock;

  const title = isPlan
    ? areaKey === "fila"
      ? "La fila virtual viene en Avanzado"
      : "Tu plan no incluye la agenda"
    : areaKey === "fila"
      ? "No tienes acceso a la fila virtual"
      : "No tienes acceso a la agenda";

  const body = isPlan
    ? areaKey === "fila"
      ? `Con tu plan ${planName ?? ""} no está disponible la fila virtual. Súbete a Avanzado y quien llegue sin cita se anota solo con un QR, ve su lugar y deja de preguntar cuánto falta.`.trim()
      : "Escríbenos y lo activamos para tu barbería."
    : "Pídele al dueño de la barbería que te dé el permiso desde el equipo.";

  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(24px, 4vw, 36px)",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
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
            background: isPlan
              ? "var(--brand-grad, linear-gradient(135deg, #A2612F, #BE7A3C))"
              : "var(--bg-elev-2)",
            color: isPlan ? "#fff" : "var(--text-3)",
          }}
        >
          <Icon size={24} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", margin: 0 }}>{body}</p>
        {isPlan ? (
          <a
            href="/barber/suscripcion"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 38,
              padding: "0 16px",
              borderRadius: 10,
              background: "var(--caramel-600)",
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Ver planes
          </a>
        ) : null}
      </div>
    </div>
  );
}
