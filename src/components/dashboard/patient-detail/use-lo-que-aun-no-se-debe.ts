"use client";

// De las facturas del paciente, cuánto de su saldo aún no se debe (decisiones de Rafael, 26-oct-2026):
// lo aceptado sin hacer de sus notas de plan y lo que no vence de su ortodoncia «Precio total a
// plazos». Lo lee GET /api/patients/[id]/lo-que-aun-no-se-debe (la regla de Caja y Finanzas). La
// cabecera de la ficha lo resta de la suma de saldos; «Estado de cuenta» lo dice aparte. Sin permiso
// de ver dinero, mientras carga o si falla: 0, y todo se ve como siempre.

import { useEffect, useState } from "react";

/** `clave` cambia cuando cambian las facturas (un cobro, una nota nueva): se relee. */
export function useLoQueAunNoSeDebe(patientId: string, activo: boolean, clave: unknown): number {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!activo || !patientId) {
      setTotal(0);
      return;
    }
    let vivo = true;
    fetch(`/api/patients/${encodeURIComponent(patientId)}/lo-que-aun-no-se-debe`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { total?: unknown } | null) => {
        if (!vivo) return;
        const n = Number(d?.total);
        setTotal(Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0);
      })
      .catch(() => { if (vivo) setTotal(0); });
    return () => { vivo = false; };
  }, [patientId, activo, clave]);
  return total;
}
