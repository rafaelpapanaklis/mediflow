/**
 * TrialBanner — banner persistente arriba del contenido del dashboard
 * que comunica el estado del trial y empuja al marketplace.
 *
 * Tres estados de urgencia según `daysLeft`:
 *   - morado (>7 días)   — promocional, "Prueba activa"
 *   - amarillo (4–7 días) — recordatorio, "X días restantes"
 *   - rojo (1–3 días)    — urgente, "Tu prueba termina en X días"
 *
 * NO se renderiza si el trial ya expiró — eso lo maneja el bloqueo
 * post-trial (Sprint 4). Sin trialEndsAt válido tampoco renderiza.
 *
 * Server Component: lee solo props, sin estado. La pill compacta del
 * topbar (TrialPill) sigue funcionando en paralelo.
 *
 * Polish dark-mode (post-Sprint 2):
 *   - Saturación reducida en dark mode (--600 → --700 en gradients).
 *   - role="alert" en estado urgente, role="status" en warning.
 *   - AlertTriangle pulsa con motion-safe en estado urgente.
 *   - focus-visible rings en todos los Links.
 *
 * Props:
 *   - trialEndsAt: fecha de fin del trial (Date | null)
 *   - isInTrial: si la clínica está actualmente en trial (false oculta)
 */
import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock, PartyPopper } from "lucide-react";

interface TrialBannerProps {
  trialEndsAt: Date | string | null | undefined;
  isInTrial: boolean;
}

export function TrialBanner({ trialEndsAt, isInTrial }: TrialBannerProps) {
  if (!isInTrial || !trialEndsAt) return null;

  const end = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return null;

  const now    = new Date();
  const msLeft = end.getTime() - now.getTime();
  if (msLeft <= 0) return null; // expirado — sprint 4

  const daysLeft = Math.max(1, Math.ceil(msLeft / 86_400_000));

  const isUrgent  = daysLeft <= 3;
  const isWarning = daysLeft > 3 && daysLeft <= 7;

  if (isUrgent) {
    return (
      <div
        role="alert"
        className="flex-shrink-0 bg-gradient-to-r from-red-600 via-rose-600 to-red-600 dark:from-red-700 dark:via-rose-700 dark:to-red-700 text-white px-6 py-3 flex items-center justify-between gap-4 flex-wrap"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 motion-safe:animate-pulse" strokeWidth={2.5} aria-hidden />
          </div>
          <div>
            <div className="text-sm font-semibold">
              ¡Tu prueba termina en {daysLeft} día{daysLeft !== 1 ? "s" : ""}!
            </div>
            <div className="text-xs text-white/85">
              Compra los módulos que necesitas antes de perder el acceso · Tus datos se mantendrán
            </div>
          </div>
        </div>
        <Link
          href="/dashboard/marketplace"
          className="bg-white text-red-700 hover:bg-red-50 font-semibold px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-red-600"
        >
          Elegir módulos ahora
          <ArrowRight className="w-4 h-4" aria-hidden />
        </Link>
      </div>
    );
  }

  if (isWarning) {
    return (
      <div
        role="status"
        className="flex-shrink-0 bg-gradient-to-r from-amber-500 to-orange-500 dark:from-amber-600 dark:to-orange-600 text-white px-6 py-3 flex items-center justify-between gap-4 flex-wrap"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
            <Clock className="w-4 h-4" strokeWidth={2.5} aria-hidden />
          </div>
          <div className="text-sm font-medium">
            <strong>{daysLeft} días</strong> restantes en tu prueba gratuita · No olvides activar los módulos que más uses
          </div>
        </div>
        <Link
          href="/dashboard/marketplace"
          className="bg-white/15 backdrop-blur hover:bg-white/25 font-medium px-3 py-1.5 rounded-md text-sm transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Elegir mis módulos
        </Link>
      </div>
    );
  }

  // >7 días — estado promocional (morado)
  return (
    <div className="flex-shrink-0 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 dark:from-violet-700 dark:via-purple-700 dark:to-indigo-700 text-white px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center flex-shrink-0">
          <PartyPopper className="w-4 h-4 text-amber-200" strokeWidth={2.5} aria-hidden />
        </div>
        <div>
          <div className="text-sm font-semibold">Prueba gratis · Acceso completo a todos los módulos</div>
          <div className="text-xs text-white/85">
            Te quedan <strong className="text-white">{daysLeft} días</strong> · Sin tarjeta · Sin compromiso
          </div>
        </div>
      </div>
      <Link
        href="/dashboard/marketplace"
        className="bg-white/15 backdrop-blur hover:bg-white/25 font-medium px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-1.5 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        Elegir mis módulos
        <ArrowRight className="w-3.5 h-3.5" aria-hidden />
      </Link>
    </div>
  );
}
