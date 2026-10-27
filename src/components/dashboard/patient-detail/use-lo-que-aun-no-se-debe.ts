"use client";

// De las facturas del paciente, cuánto de su saldo aún no se debe (decisiones de Rafael, 26-oct-2026):
// lo aceptado sin hacer de sus notas de plan y lo que no vence de su ortodoncia «Precio total a
// plazos». Lo lee GET /api/patients/[id]/lo-que-aun-no-se-debe (la regla de Caja y Finanzas). La
// cabecera y «Estado de cuenta» lo restan de la suma de saldos (v7). `adelanto`: de lo por hacer de sus
// notas de plan, lo ya pagado; «Estado de cuenta» lo dice como «De lo por hacer, $X ya están pagados»,
// no como saldo a favor (v8). `cuotas`: de `total`, las cuotas de planes con cuotas acordadas que aún no
// vencen; la ficha las dice aparte y sin «ya pagados» (v12, t5 m1). Sin permiso de ver dinero, mientras
// carga o si falla: 0, y todo se ve como siempre.

import { useEffect, useState } from "react";

export interface LoQueAunNoSeDebeDelPaciente {
  total: number;
  adelanto: number;
  /** De `total`, cuotas acordadas de notas de plan que aún no vencen (v12). */
  cuotas: number;
  /** `invoiceId` → lo que aún no se debe de su saldo (solo las que tienen algo). */
  porFactura: Record<string, number>;
}

const CERO: LoQueAunNoSeDebeDelPaciente = { total: 0, adelanto: 0, cuotas: 0, porFactura: {} };
const pesos = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

/** `clave` cambia cuando cambian las facturas (un cobro, una nota nueva): se relee. */
export function useLoQueAunNoSeDebe(patientId: string, activo: boolean, clave: unknown): LoQueAunNoSeDebeDelPaciente {
  const [valor, setValor] = useState<LoQueAunNoSeDebeDelPaciente>(CERO);
  useEffect(() => {
    if (!activo || !patientId) {
      setValor(CERO);
      return;
    }
    let vivo = true;
    fetch(`/api/patients/${encodeURIComponent(patientId)}/lo-que-aun-no-se-debe`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { total?: unknown; adelanto?: unknown; porVencerCuotas?: unknown; porFactura?: unknown } | null) => {
        if (!vivo) return;
        const porFactura: Record<string, number> = {};
        if (d?.porFactura && typeof d.porFactura === "object") {
          for (const [id, monto] of Object.entries(d.porFactura as Record<string, unknown>)) if (pesos(monto) > 0) porFactura[id] = pesos(monto);
        }
        const total = pesos(d?.total);
        setValor({ total, adelanto: pesos(d?.adelanto), cuotas: Math.min(total, pesos(d?.porVencerCuotas)), porFactura });
      })
      .catch(() => { if (vivo) setValor(CERO); });
    return () => { vivo = false; };
  }, [patientId, activo, clave]);
  return valor;
}
