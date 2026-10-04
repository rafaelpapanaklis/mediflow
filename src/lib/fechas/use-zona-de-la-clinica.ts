// La zona horaria de la clínica en el cliente (auditoría de uso C-64, vuelta 2). Se pide UNA vez a
// GET /api/clinic/zona (la misma ruta que usan cobros y facturas) y se recuerda; mientras no llega, o si falla,
// `null` = la zona del navegador, como antes.

import { useEffect, useState } from "react";

let zonaRecordada: string | null | undefined;
let enCamino: Promise<string | null> | null = null;

function pedirZona(): Promise<string | null> {
  if (zonaRecordada !== undefined) return Promise.resolve(zonaRecordada);
  if (!enCamino) {
    enCamino = fetch("/api/clinic/zona")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timezone?: unknown } | null) => (zonaRecordada = typeof d?.timezone === "string" && d.timezone ? d.timezone : null))
      .catch(() => null)
      .finally(() => {
        enCamino = null;
      });
  }
  return enCamino;
}

export function useZonaDeLaClinica(): string | null {
  const [zona, setZona] = useState<string | null>(zonaRecordada ?? null);
  useEffect(() => {
    let vivo = true;
    void pedirZona().then((z) => {
      if (vivo) setZona(z);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return zona;
}
