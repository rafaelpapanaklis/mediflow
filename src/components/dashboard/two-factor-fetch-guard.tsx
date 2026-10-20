"use client";

import { useEffect } from "react";
import {
  TWO_FACTOR_REQUIRED_CODE,
} from "@/lib/auth/two-factor-gate";
import { TWO_FA_CHALLENGE_PATH, TWO_FA_ROUTE_PREFIX } from "@/lib/auth/two-factor-constants";
import { hayPendienteOdontograma } from "@/components/dashboard/odontogram-v2/autosave";

/**
 * EQ-01 · Guard de cliente del gate de 2FA en /api.
 *
 * EL PROBLEMA QUE RESUELVE: al exigir 2FA en /api, cualquier pantalla del panel
 * abierta con el segundo factor pendiente empieza a recibir 403 en sus fetch. Sin
 * este guard, cada pantalla muestra su propio toast rojo genérico ("Error al
 * cargar") y el usuario no tiene ni idea de que lo que le falta es teclear su
 * código — y peor, un manejador que trate el fallo como sesión caducada lo
 * mandaría al login, obligándolo a poner otra vez la contraseña sin necesidad.
 *
 * POR QUÉ SE PARCHEA window.fetch, QUE NO ES BONITO: hay unos 200 call sites de
 * fetch repartidos por el panel, cada uno con su propio manejo de errores. Ir uno
 * por uno sería un cambio enorme, imposible de revisar y fácil de dejar a medias
 * — y bastaría con olvidar uno para que ese formulario siguiera fallando en
 * silencio. Un único punto de intercepción cubre los 200 y es lo que se puede
 * quitar de un tirón el día que exista un cliente HTTP central.
 *
 * El código del 403 (`two_factor_required`) es LO ÚNICO que se mira, y viene de
 * la misma constante que emite el middleware, así que no hay dos literales que
 * puedan desincronizarse. Un 401 normal NO lo toca: eso sí es sesión caducada y
 * su destino sigue siendo el login.
 *
 * Navegación DURA (location.assign) a propósito: el reto lo decide el layout
 * server de /dashboard, y con router.replace la navegación soft no vuelve a
 * ejecutarlo — se quedaría en una pantalla en blanco.
 *
 * EXCEPCIÓN (ws1-t11, revisión t8, N3-O1): si en esta pestaña queda algo del
 * odontograma sin guardar, NO se navega. Lo pendiente del autoguardado vive
 * solo en memoria de la pestaña: llevársela al reto lo perdería en cuanto se
 * acepte el «¿Salir del sitio?». La cola ya aparta ese 403 con «Falta la
 * verificación en dos pasos. Complétala en otra pestaña…», y lo manda al
 * volver el mismo usuario. Sin nada pendiente, todo sigue como siempre.
 *
 * No renderiza nada.
 */
export function TwoFactorFetchGuard() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    instalarGuardia2FA(window);
  }, []);

  return null;
}

/** Lo que usa el guardia de la ventana (para poder ejecutarlo en las pruebas). */
export interface VentanaGuardia2FA {
  fetch: typeof fetch;
  location: { pathname: string; search: string; assign(url: string): void };
}

/** Parchea `fetch` de la ventana una sola vez. Separado del componente para ejecutarlo en pruebas. */
export function instalarGuardia2FA(win: VentanaGuardia2FA, hayPendiente: () => boolean = hayPendienteOdontograma) {
  // Idempotente: en dev, con Fast Refresh, el efecto se vuelve a montar y sin
  // esta marca se apilarían wrappers sobre wrappers.
  const w = win as VentanaGuardia2FA & { __df2faFetchPatched?: boolean };
  if (w.__df2faFetchPatched) return;
  w.__df2faFetchPatched = true;

  const originalFetch = win.fetch.bind(win);
  let redirecting = false;

  win.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args);

    // Solo un 403 puede ser esto, y los 403 son raros: así el clone + json()
    // no se paga en el camino normal.
    if (res.status !== 403 || redirecting) return res;

    // Ya estamos en el reto (o en el enrolamiento): no redirigir sobre uno
    // mismo, sería un loop.
    if (win.location.pathname.startsWith(TWO_FA_ROUTE_PREFIX)) return res;

    let code: unknown;
    try {
      // clone() es obligatorio: leer el body original lo consumiría y el
      // llamador recibiría un stream ya agotado.
      const body = await res.clone().json();
      code = (body as { code?: unknown } | null)?.code;
    } catch {
      // 403 sin cuerpo JSON (por ejemplo el CSRF de /api/admin). No es lo
      // nuestro: se devuelve tal cual.
      return res;
    }

    if (code !== TWO_FACTOR_REQUIRED_CODE) return res;

    // N3-O1: con el odontograma sin guardar no se navega (se perdería); el
    // siguiente 403 sin nada pendiente sí lleva al reto
    if (hayPendiente()) return res;

    redirecting = true;
    const next = win.location.pathname + win.location.search;
    win.location.assign(`${TWO_FA_CHALLENGE_PATH}?next=${encodeURIComponent(next)}`);
    return res;
  };

  // A propósito NO se restaura el fetch original al desmontar: el guard vive en
  // el layout del panel, así que su desmontaje es una navegación fuera del
  // panel, y restaurar en medio de peticiones en vuelo dejaría a algunas sin
  // cubrir. La marca de arriba evita el doble parcheo, que es el riesgo real.
}
