"use client";

import { useEffect, useState } from "react";

/** La hora en la zona del navegador del admin (el servidor no la conoce). */
export function HoraLocal({ fecha }: { fecha: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  useEffect(() => {
    setTexto(new Date(fecha).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }, [fecha]);
  return <>{texto ?? "…"}</>;
}
