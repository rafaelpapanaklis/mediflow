"use client";
// ¿Pantalla de celular? (tercera auditoría, F-4: el caso de ortodoncia medía ~10,500 px de alto a 390 px). En el
// servidor y antes de montar responde `false` (escritorio): nada cambia hasta saber el ancho.

import { useEffect, useState } from "react";

export const ANCHO_CELULAR = "(max-width: 640px)";

export function useEsCelular(): boolean {
  const [celular, setCelular] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(ANCHO_CELULAR);
    const cambiar = () => setCelular(mq.matches);
    cambiar();
    mq.addEventListener?.("change", cambiar);
    return () => mq.removeEventListener?.("change", cambiar);
  }, []);
  return celular;
}
