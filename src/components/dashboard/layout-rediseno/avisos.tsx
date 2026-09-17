"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Toaster } from "react-hot-toast";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./avisos.module.css";

/**
 * LOS AVISOS (toasts) con la ropa del rediseño (ws1-t2, hallazgo 20).
 *
 * El <Toaster> de react-hot-toast vive en el layout RAÍZ (`src/app/layout.tsx`),
 * por encima de /dashboard y sin saber de clínicas: ahí no hay interruptor
 * que leer. El layout de /dashboard sí lo sabe, y lo dice por un ENVOLTORIO
 * de hijo único (`<VestirAvisos activo={menuDosNiveles}>`), igual que
 * `VestirDialogos` viste las confirmaciones del ConfirmProvider. El aviso
 * viaja por un almacén de módulo (fuera de React) y lo lee
 * `<AvisosVestibles>`, que en el layout raíz envuelve al <Toaster> de
 * siempre:
 *
 *   · apagado (o fuera de /dashboard), devuelve ese <Toaster> TAL CUAL, con
 *     sus props de siempre: el HTML no cambia ni un byte;
 *   · encendido, pinta en su lugar un <Toaster> con la ropa del menú: mismas
 *     duraciones (3 s éxito/info, 5 s error, ∞ cargando), misma esquina,
 *     mismos textos; solo cambia con qué se pinta.
 *
 * Los dos son envoltorios de hijo único a propósito: un hijo más entre los
 * del layout le cambia a React el número de ranuras de ese nivel y con él
 * los `useId` de todo lo que cuelga (medido en `tipografia-panel.tsx`); un
 * envoltorio de hijo único no abre ranura ninguna.
 *
 * En el servidor y en el primer render del cliente el almacén dice «apagado»
 * (`leerServidor`), así que la hidratación casa con el HTML y el cambio de
 * ropa llega en un efecto, cuando aún no hay ningún aviso en pantalla.
 *
 * ⛔ Esto no toca ni un texto ni una duración. Es ropa.
 */

let encendido = false;
const oyentes = new Set<() => void>();

function leer(): boolean {
  return encendido;
}
function leerServidor(): boolean {
  return false;
}
function suscribir(fn: () => void): () => void {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

/** Enciende o apaga la ropa nueva de los avisos. Lo llama <VestirAvisos>. */
export function vestirAvisos(activo: boolean): void {
  if (encendido === activo) return;
  encendido = activo;
  oyentes.forEach((fn) => fn());
}

/**
 * Viste los avisos mientras `activo` sea cierto. El layout de /dashboard lo
 * pone con el interruptor `menu-dos-niveles`. Apagado no hace nada y
 * devuelve el hijo tal cual.
 */
export function VestirAvisos({ activo, children }: { activo: boolean; children: ReactNode }) {
  useEffect(() => {
    if (!activo) return;
    vestirAvisos(true);
    return () => vestirAvisos(false);
  }, [activo]);
  return <>{children}</>;
}

/**
 * Envuelve al <Toaster> de siempre en el layout raíz. Con la ropa apagada
 * devuelve ese hijo tal cual; encendida, un <Toaster> con la ropa del menú.
 *
 * El contenedor de react-hot-toast cuelga del <body>, fuera de la raíz de
 * cualquier pantalla: por eso monta `CLASES_MENU` él mismo (los `--m2-*` con
 * su versión oscura y la letra del diseño), y cada aviso los lee.
 */
export function AvisosVestibles({ children }: { children: ReactNode }) {
  const nueva = useSyncExternalStore(suscribir, leer, leerServidor);
  if (!nueva) return <>{children}</>;
  return (
    <Toaster
      position="top-right"
      gutter={8}
      containerClassName={`${CLASES_MENU} ${s.contenedor}`}
      toastOptions={{
        className: s.aviso,
        duration: 3000,
        success: { duration: 3000, iconTheme: { primary: "var(--success)", secondary: "var(--m2-tarjeta)" } },
        error: { duration: 5000, iconTheme: { primary: "var(--danger)", secondary: "var(--m2-tarjeta)" } },
        loading: { duration: Infinity, iconTheme: { primary: "var(--m2-borde)", secondary: "var(--m2-activo)" } },
        // En línea a propósito: react-hot-toast pinta la caja con `style`, y
        // una clase no le ganaría. Todo se LEE de los tokens del menú.
        style: {
          borderRadius: "12px",
          background: "var(--m2-tarjeta)",
          color: "var(--m2-texto)",
          border: "1px solid var(--m2-tarjeta-borde)",
          boxShadow: "0 12px 32px -12px color-mix(in srgb, var(--m2-texto) 28%, transparent)",
          fontFamily: "inherit",
          padding: "10px 14px",
          fontSize: 13,
          maxWidth: 420,
        },
      }}
    />
  );
}
