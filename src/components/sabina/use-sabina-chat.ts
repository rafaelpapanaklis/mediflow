"use client";

/**
 * El puente entre el almacén de Sabina (`./almacen`, sin React) y las dos
 * puertas que lo pintan: la pantalla `/dashboard/sabina` y el cajón lateral.
 *
 * `useSyncExternalStore` es lo que hace que las dos vean LO MISMO: el estado no
 * está en ningún componente, así que no hay dos copias que sincronizar.
 */

import { useCallback, useSyncExternalStore } from "react";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { leerEstado, suscribir, type ContextoPantalla, type EstadoSabina } from "./almacen";
import { contextoDePantalla } from "./contexto-pantalla";

/** El estado vivo del chat. Igual para el cajón y para la pantalla. */
export function useSabinaEstado(): EstadoSabina {
  // El tercer argumento es el snapshot del servidor: `leerEstado` devuelve el
  // mismo objeto mientras nadie escriba, así que sirve para los dos lados y no
  // provoca el bucle de "getSnapshot should be cached".
  return useSyncExternalStore(suscribir, leerEstado, leerEstado);
}

/**
 * Devuelve una función que arma la pista de «dónde estoy» EN EL MOMENTO de
 * preguntar.
 *
 * Se lee `window.location` al llamar, no en el render, por dos motivos: no
 * hace falta re-renderizar el chat entero cada vez que cambia un parámetro de
 * la URL, y así este hook no arrastra `useSearchParams` —que obliga a envolver
 * en `<Suspense>` a quien lo monte— hasta el layout del panel.
 */
export function useContextoSabina(): () => ContextoPantalla {
  // El paciente que está en el sillón. El provider vive en el layout del panel,
  // así que lo tienen tanto la pantalla de Sabina como el cajón.
  const { consult } = useActiveConsult();
  const patientId = consult?.patientId ?? null;

  return useCallback(() => {
    if (typeof window === "undefined") return {};
    return contextoDePantalla(
      window.location.pathname,
      new URLSearchParams(window.location.search),
      { patientId },
    );
  }, [patientId]);
}
