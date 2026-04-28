/**
 * @deprecated Desde Fase 2.5 (2026-04). Reemplazado por <TrialPill />
 * integrado en <Topbar />. Este componente NO se renderiza en
 * `src/app/dashboard/layout.tsx` actual.
 *
 * Conservado temporalmente por si algún consumer lo importa. En Fase 2.7
 * se puede eliminar tras verificar con `git grep TrialBanner`.
 */
import Link from "next/link";

interface TrialBannerProps {
  trialEndsAt: Date;
}

function formatFecha(d: Date) {
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function TrialBanner({ trialEndsAt }: TrialBannerProps) {
  const now = new Date();
  const end = new Date(trialEndsAt);
  const msLeft = end.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000));
  const warning = daysLeft <= 3;

  const bg = warning
    ? "linear-gradient(90deg, rgba(245,158,11,0.2), rgba(251,191,36,0.2))"
    : "linear-gradient(90deg, rgba(124,58,237,0.2), rgba(168,85,247,0.2))";
  const borderColor = warning ? "rgba(245,158,11,0.35)" : "rgba(124,58,237,0.3)";
  const linkColor   = warning ? "#fbbf24" : "var(--brand, #7c3aed)";

  const icon = warning ? "⏰" : "🎉";
  const label = warning ? "Tu prueba termina pronto" : "Prueba gratis activa";

  return (
    <div
      className="flex-shrink-0"
      style={{
        background: bg,
        borderBottom: `1px solid ${borderColor}`,
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        fontSize: 13,
        color: "var(--text-1, #e8e8ec)",
        flexWrap: "wrap",
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span>
        {label} —{" "}
        <strong>
          {daysLeft === 0
            ? "termina hoy"
            : daysLeft === 1
              ? "1 día restante"
              : `${daysLeft} días restantes`}
        </strong>{" "}
        <span style={{ opacity: 0.7 }}>(termina el {formatFecha(end)})</span>
      </span>
      <Link
        href="/dashboard/settings?tab=subscription"
        style={{ color: linkColor, fontWeight: 600, textDecoration: "none" }}
      >
        Ver detalles →
      </Link>
    </div>
  );
}
