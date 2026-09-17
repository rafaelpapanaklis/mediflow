"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { RETRASO_FOTO_MS, debeRevalidar, fotoVigente, reglaDe } from "./politica";

/**
 * Que volver a Hoy o a Analítica siga siendo instantáneo pasados los 30 s de
 * Next, SIN tocar `next.config.mjs` ni el plazo de la Agenda o de Caja.
 * La política (qué rutas, y por qué solo ésas) está en `./politica.ts`.
 *
 * - Al SALIR de una ruta tolerante se pide su «foto» completa
 *   (`router.prefetch` con kind FULL): Next la reutiliza entera hasta 5 min.
 * - Al VOLVER, Next pinta la foto al instante. Si la ruta lo pide (Hoy) y la
 *   foto pasa de 30 s, se lanza `router.refresh()` por detrás.
 *
 * No pinta nada. Solo se monta con el interruptor `menu-dos-niveles` encendido.
 * En `next dev` no hace nada: ahí `router.prefetch` es un no-op.
 */
export function CacheNavegacion() {
  const pathname = usePathname();
  const router = useRouter();
  const anterior = useRef<string | null>(null);
  const fotos = useRef(new Map<string, number>());
  const pendientes = useRef(new Map<string, number>());

  useEffect(() => {
    const vengoDe = anterior.current;
    anterior.current = pathname;
    if (!pathname || vengoDe === pathname) return;

    // Volví antes de que saliera la foto: ya no hace falta pedirla.
    const pendiente = pendientes.current.get(pathname);
    if (pendiente !== undefined) {
      window.clearTimeout(pendiente);
      pendientes.current.delete(pathname);
    }

    if (debeRevalidar(pathname, window.location.search, fotos.current.get(pathname), Date.now())) {
      // refresh() vacía TODA la caché de prefetch de Next: las fotos ya no existen.
      fotos.current.clear();
      router.refresh();
    }

    if (vengoDe && reglaDe(vengoDe) && !pendientes.current.has(vengoDe)) {
      const id = window.setTimeout(() => {
        pendientes.current.delete(vengoDe);
        router.prefetch(vengoDe, { kind: PrefetchKind.FULL });
        // Si la foto anterior sigue viva, Next la reutiliza y NO pide otra:
        // se conserva su hora real para no darla por más nueva de lo que es.
        if (!fotoVigente(fotos.current.get(vengoDe), Date.now())) {
          fotos.current.set(vengoDe, Date.now());
        }
      }, RETRASO_FOTO_MS);
      pendientes.current.set(vengoDe, id);
    }
  }, [pathname, router]);

  useEffect(() => {
    const mapa = pendientes.current;
    return () => {
      mapa.forEach((id) => window.clearTimeout(id));
      mapa.clear();
    };
  }, []);

  return null;
}
