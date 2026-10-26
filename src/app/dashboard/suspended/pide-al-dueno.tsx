import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Lo que ve en /dashboard/suspended quien NO es el dueño (ADMIN incluido; decisión de Rafael, 26-oct-2026):
 * pagar o reactivar el plan es solo del SUPER_ADMIN (isClinicBillingAdmin), así que en vez de las tarjetas
 * de pago se le dice a quién pedírselo. Nunca se queda sin salida: «Ya pagó» lleva al panel (si el pago ya
 * entró, entra; si no, el layout lo devuelve aquí, sin bucle porque es un clic suyo) y abajo siguen el
 * ticket de soporte, el manager y la vuelta al login.
 */
export function PideAlDueno({ titulo, texto, yaPago }: { titulo: string; texto: string; yaPago: string }) {
  return (
    <section
      data-suspendida="pide-al-dueno"
      className="mx-auto mb-6 flex max-w-[560px] flex-col items-center gap-3 rounded-2xl bg-card px-6 py-7 text-center ring-1 ring-border"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-background text-muted-foreground ring-1 ring-border">
        <Lock size={20} aria-hidden />
      </span>
      <h2 className="text-xl font-bold tracking-tight">{titulo}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">{texto}</p>
      <Link
        href="/dashboard"
        prefetch={false}
        className="mt-1 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-border transition hover:bg-background"
      >
        {yaPago}
      </Link>
    </section>
  );
}
