"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAllowedWhileSuspended } from "@/lib/plan-status";

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
 * Guard de cliente para cuentas sin plan activo (nueva pending_payment o
 * suspendida por impago).
 *
 * Ya NO pinta el modal bloqueante de "acceso bloqueado": en su lugar
 * redirige (replace) a la pantalla de pago /dashboard/suspended, que es
 * donde el usuario completa su compra o reactiva su plan — sin tono de
 * castigo.
 *
 * El redirect PRINCIPAL es server-side en el layout (`redirect()`), sin
 * parpadeo del dashboard. Este guard cubre las navegaciones soft de Next.js
 * (entre rutas /dashboard/* vía router) donde el layout no se vuelve a
 * ejecutar y por tanto no dispara el redirect del servidor.
 *
 * Excepciones: en /dashboard/suspended NO redirige (esa página YA es la
 * pantalla de pago) ni en /dashboard/soporte(/*) (la clínica suspendida debe
 * poder pedir ayuda) — evita el loop y deja Soporte navegable. El criterio
 * vive en isAllowedWhileSuspended, la MISMA fuente que usa el redirect
 * server-side del layout, para que ambas superficies no se desincronicen.
 * No renderiza nada.
 */
export function ExpiredPlanModal({ isExpired, currentPathname }: Props) {
  const router = useRouter();
  const livePathname = usePathname();
  const pathname = livePathname ?? currentPathname;

  useEffect(() => {
    if (isExpired && !isAllowedWhileSuspended(pathname)) {
      router.replace(SUSPENDED_PATH);
    }
  }, [isExpired, pathname, router]);

  return null;
}
