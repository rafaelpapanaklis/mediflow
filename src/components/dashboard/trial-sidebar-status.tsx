"use client";
/**
 * Mini-status del trial en el sidebar — barra compacta debajo del switcher
 * de clínica. Tres estados según urgencia (>7d morado, 4-7d amarillo,
 * 1-3d rojo). Si no hay trial o ya expiró, muestra estado bloqueado.
 *
 * Visualmente sigue el patrón Tailwind del prototipo
 * (mediflow_marketplace.jsx Sidebar) para alinear con el resto de la UI
 * del marketplace. La pill rica del trial vive en la topbar (TrialPill).
 */
import Link from "next/link";
import { Clock, Lock } from "lucide-react";
import { useTrialDaysLeft } from "@/lib/trial";

interface TrialSidebarStatusProps {
  trialEndsAt: Date | string | null;
  /** Si el trial está vigente — si false, muestra estado bloqueado. */
  isInTrial: boolean;
  /** Si está colapsado, mostramos solo el ícono. */
  collapsed?: boolean;
}

export function TrialSidebarStatus({
  trialEndsAt,
  isInTrial,
  collapsed = false,
}: TrialSidebarStatusProps) {
  const trial = useTrialDaysLeft(trialEndsAt);

  if (trial.absent) return null;

  const expired = !isInTrial || trial.expired;
  const days    = trial.days;

  // Colores según urgencia (3 estados). Critical = rojo (≤3d), warning =
  // amarillo (4-7d), calm = morado (>7d).
  const tone = expired
    ? "danger"
    : days <= 3 ? "danger"
    : days <= 7 ? "warning"
    : "brand";

  const palette = {
    brand:   { bg: "bg-violet-50", border: "border-violet-100", iconColor: "text-violet-600", title: "text-violet-700", body: "text-violet-700/80" },
    warning: { bg: "bg-amber-50",  border: "border-amber-100",  iconColor: "text-amber-600",  title: "text-amber-700",  body: "text-amber-700/80" },
    danger:  { bg: "bg-red-50",    border: "border-red-100",    iconColor: "text-red-600",    title: "text-red-700",    body: "text-red-600/80" },
  }[tone];

  if (collapsed) {
    return (
      <Link
        href="/dashboard/marketplace"
        aria-label={expired ? "Prueba expirada — ir al marketplace" : `Prueba: ${days} días restantes — ir al marketplace`}
        className={`mx-auto mt-2 mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${palette.bg} ${palette.border} border`}
      >
        {expired ? (
          <Lock className={`w-3.5 h-3.5 ${palette.iconColor}`} aria-hidden />
        ) : (
          <Clock className={`w-3.5 h-3.5 ${palette.iconColor}`} aria-hidden />
        )}
      </Link>
    );
  }

  return (
    <Link
      href="/dashboard/marketplace"
      className={`mx-2 mt-2 mb-2 block rounded-lg p-3 border transition-colors hover:opacity-90 ${palette.bg} ${palette.border}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {expired ? (
          <Lock className={`w-3.5 h-3.5 ${palette.iconColor}`} aria-hidden />
        ) : (
          <Clock className={`w-3.5 h-3.5 ${palette.iconColor}`} aria-hidden />
        )}
        <div className={`text-xs font-semibold ${palette.title}`}>
          {expired
            ? "Prueba expirada"
            : `Trial · ${days}d ${days === 1 ? "restante" : "restantes"}`}
        </div>
      </div>
      <div className={`text-xs ${palette.body}`}>
        {expired ? "Compra módulos para continuar" : "Acceso completo a todo"}
      </div>
    </Link>
  );
}
