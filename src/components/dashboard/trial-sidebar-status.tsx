"use client";
/**
 * Mini-status del trial en el sidebar — barra compacta debajo del switcher
 * de clínica. Tres estados según urgencia (>7d morado, 4-7d amarillo,
 * 1-3d rojo). Si no hay trial o ya expiró, muestra estado bloqueado.
 *
 * Polish dark-mode (post-Sprint 2):
 *   - Fix CRÍTICO: bg-violet-50 / amber-50 / red-50 desaparecían en dark
 *     mode. Cambiados a bg-{color}-500/10 (alpha) que funciona en ambos.
 *   - Texto e ícono con dark: variants para mantener contraste.
 *   - Focus-visible ring para keyboard nav.
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

  // bg-{color}-500/10 (10% alpha) funciona en ambos modos:
  //   - Light: el alpha sobre fondo blanco produce un tinte ~50 (claro).
  //   - Dark:  el alpha sobre fondo oscuro produce un tinte oscuro perfecto.
  const palette = {
    brand: {
      bg: "bg-violet-500/10",
      border: "border-violet-500/20",
      iconColor: "text-violet-600 dark:text-violet-300",
      title: "text-violet-700 dark:text-violet-200",
      body: "text-violet-700/80 dark:text-violet-200/70",
    },
    warning: {
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
      iconColor: "text-amber-600 dark:text-amber-300",
      title: "text-amber-700 dark:text-amber-200",
      body: "text-amber-700/80 dark:text-amber-200/70",
    },
    danger: {
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      iconColor: "text-red-600 dark:text-red-300",
      title: "text-red-700 dark:text-red-200",
      body: "text-red-600/80 dark:text-red-200/70",
    },
  }[tone];

  if (collapsed) {
    return (
      <Link
        href="/dashboard/marketplace"
        aria-label={expired ? "Prueba expirada — ir al marketplace" : `Prueba: ${days} días restantes — ir al marketplace`}
        className={`mx-auto mt-2 mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${palette.bg} ${palette.border} border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]`}
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
      className={`mx-2 mt-2 mb-2 block rounded-lg p-3 border transition-colors hover:opacity-90 ${palette.bg} ${palette.border} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]`}
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
