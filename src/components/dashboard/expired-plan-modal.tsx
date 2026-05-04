"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";

const SUSPENDED_PATH = "/dashboard/suspended";

interface Props {
  isExpired: boolean;
  /**
   * Pathname al momento del SSR. En client navigations, `usePathname()`
   * provee el valor reactive — el prop es el fallback para el primer
   * render mientras el hook se hidrata.
   */
  currentPathname: string;
}

/**
 * Modal full-screen bloqueante que se monta cuando la clínica del
 * usuario tiene plan/trial expirado. Cubre cualquier ruta de
 * /dashboard/* excepto /dashboard/suspended (esa ya es la pantalla de
 * pago, ahí no agregamos el bloqueo encima).
 *
 * Diseño deliberado:
 *  - Sin botón X de cerrar.
 *  - No se cierra con Escape ni click en backdrop.
 *  - El backdrop captura todos los clicks y bloquea interacción con el
 *    dashboard de fondo (z-index 100, pointer-events activos).
 *  - Renderizado vía portal a document.body para garantizar el z-index
 *    correcto y evitar overflow clipping de los contenedores padres.
 *
 * Reactivity: el cliente navega entre rutas vía Next.js routing sin
 * recargar el layout — usamos `usePathname()` para detectar la ruta y
 * mostrar/ocultar el modal sin necesidad de re-renderizar el server
 * component.
 */
export function ExpiredPlanModal({ isExpired, currentPathname }: Props) {
  const livePathname = usePathname();
  const pathname = livePathname ?? currentPathname;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isExpired) return null;
  if (pathname === SUSPENDED_PATH) return null;
  if (!mounted) return null;

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="expired-plan-title"
      aria-describedby="expired-plan-desc"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(15, 10, 30, 0.7)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div
        className="rounded-2xl border bg-card p-8 shadow-2xl"
        style={{
          maxWidth: 460,
          width: "100%",
          color: "hsl(var(--card-foreground))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{
            background: "rgba(245, 158, 11, 0.15)",
            border: "1px solid rgba(245, 158, 11, 0.4)",
            color: "rgb(245, 158, 11)",
          }}
        >
          <AlertTriangle size={32} aria-hidden />
        </div>
        <h2
          id="expired-plan-title"
          className="mb-3 text-center text-2xl font-extrabold tracking-tight md:text-3xl"
        >
          Tu plan expiró
        </h2>
        <p
          id="expired-plan-desc"
          className="mb-6 text-center text-base"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Tu acceso al panel está bloqueado. Para seguir usando MediFlow
          renueva tu plan.
        </p>
        <Link
          href={SUSPENDED_PATH}
          className="block w-full rounded-xl px-6 py-4 text-center text-base font-bold text-white shadow-lg transition hover:opacity-90"
          style={{
            background: "var(--brand)",
            boxShadow: "0 10px 30px -8px rgba(124, 58, 237, 0.4)",
          }}
        >
          Renovar plan →
        </Link>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
