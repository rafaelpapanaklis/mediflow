"use client";
// Ortodoncia — lee el diagnóstico completo (ws1-t8) para el resumen de la pestaña y el paso de edición. Una
// sola petición por diagnóstico mientras nadie guarde: al guardar, `olvidarDiagnosticoCompleto` avisa a los
// que están montados y vuelven a leer.

import { useEffect, useState } from "react";
import { leerDiagnosticoCompleto, type DiagnosticoCompleto } from "@/app/actions/orthodontics/leerDiagnosticoCompleto";
import { isFailure } from "@/app/actions/orthodontics/result";

const cache = new Map<string, Promise<DiagnosticoCompleto | string>>();
const oyentes = new Set<(id: string) => void>();

function pedir(id: string): Promise<DiagnosticoCompleto | string> {
  let p = cache.get(id);
  if (!p) {
    p = leerDiagnosticoCompleto(id)
      .then((r) => (isFailure(r) ? r.error : r.data))
      .catch(() => "No se pudo leer el diagnóstico. Revisa tu conexión.");
    cache.set(id, p);
    // Un error no se queda guardado: la próxima vez se reintenta.
    void p.then((v) => {
      if (typeof v === "string") cache.delete(id);
    });
  }
  return p;
}

export function olvidarDiagnosticoCompleto(id: string): void {
  cache.delete(id);
  for (const o of oyentes) o(id);
}

export function useDiagnosticoCompleto(diagnosisId: string | null | undefined): {
  datos: DiagnosticoCompleto | null;
  error: string | null;
  cargando: boolean;
} {
  const [estado, setEstado] = useState<{ id: string | null; datos: DiagnosticoCompleto | null; error: string | null }>({ id: null, datos: null, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const o = (id: string) => {
      if (id === diagnosisId) setVersion((v) => v + 1);
    };
    oyentes.add(o);
    return () => {
      oyentes.delete(o);
    };
  }, [diagnosisId]);

  useEffect(() => {
    if (!diagnosisId) return;
    let vivo = true;
    void pedir(diagnosisId).then((v) => {
      if (!vivo) return;
      setEstado(typeof v === "string" ? { id: diagnosisId, datos: null, error: v } : { id: diagnosisId, datos: v, error: null });
    });
    return () => {
      vivo = false;
    };
  }, [diagnosisId, version]);

  const actual = estado.id === diagnosisId;
  return {
    datos: actual ? estado.datos : null,
    error: actual ? estado.error : null,
    cargando: Boolean(diagnosisId) && (!actual || (!estado.datos && !estado.error)),
  };
}

// «Completar» un apartado vacío desde el resumen abre el paso en ESE apartado. Quien monta la ventana la
// abre como siempre (`onEdit`); la sección pedida se entrega aquí y se consume una vez.
let seccionPedida: string | null = null;
export function pedirSeccionDelDiagnostico(s: string | null): void {
  seccionPedida = s;
}
export function tomarSeccionPedida(): string | null {
  const s = seccionPedida;
  seccionPedida = null;
  return s;
}
