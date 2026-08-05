"use client";

/**
 * Panel de afiliado — TOAST de confirmación (el `toastIn` del diseño).
 *
 * Píldora oscura abajo al centro que confirma un copiado. Es la pieza que el
 * diseño resolvió para eso, así que se porta tal cual en vez de reutilizar
 * el react-hot-toast global (blanco, arriba): en esta pantalla el usuario
 * copia enlaces todo el tiempo y la confirmación tiene que caer donde el
 * diseño la puso.
 *
 * UNA sola instancia, montada en el shell, alimentada por un bus de módulo.
 * Si cada botón montara su propio toast, copiar dos enlaces seguidos
 * apilaría dos píldoras en el mismo punto.
 */
import { useEffect, useState } from "react";

type Listener = (msg: string) => void;

const listeners = new Set<Listener>();

/** Muestra la confirmación. Seguro de llamar aunque el toast no esté montado. */
export function showPanelToast(message: string) {
  listeners.forEach((fn) => fn(message));
}

export function PanelToast() {
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener: Listener = (next) => {
      // `key` cambia con cada mensaje para reiniciar la animación de entrada
      // aunque el texto sea el mismo dos veces seguidas.
      setMsg(next);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMsg(""), 1900);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!msg) return null;

  return (
    <div key={msg} className="dcafp-toast" role="status" aria-live="polite">
      {msg}
    </div>
  );
}
