"use client";

import { useEffect } from "react";

/** Cada 5 min: suficiente para renovar la cookie, nulo en carga (1 POST/5 min). */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Mantiene viva la sesión del panel: pega a /api/admin/session/touch al montar,
 * cada 5 minutos y al volver a la pestaña. La extensión real de expiresAt sólo
 * ocurre cuando la sesión cruza la mitad del TTL (el endpoint decide); esto
 * únicamente garantiza que la COOKIE se re-emita con el maxAge actualizado,
 * cosa que el layout (Server Component) no puede hacer.
 *
 * Silencioso a propósito: si falla no pasa nada visible — la sesión sigue en BD
 * y el guard del layout es el que manda.
 */
export function AdminSessionKeepalive() {
  useEffect(() => {
    let cancelled = false;

    const touch = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      fetch("/api/admin/session/touch", { method: "POST", cache: "no-store" }).catch(() => {});
    };

    touch();
    const timer = setInterval(touch, TOUCH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") touch();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
