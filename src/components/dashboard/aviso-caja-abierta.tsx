// Aviso en «Hoy» (ws1-t5, F7): la caja lleva más de un día abierta sin corte.
// Componente de SERVIDOR: una sola lectura (la caja abierta de la clínica de
// la sesión). Solo a quien puede operar Caja (canUseCaja); en silencio si la
// caja se abrió hace menos de 24 h, si no hay caja abierta o si algo falla.
// La pantalla de Caja ya avisaba desde las 18 h; faltaba que se viera en Hoy.
//
// Login rápido (28-oct): la lectura la EMPIEZA la página con `leerDiasCajaAbierta`
// antes de su Promise.all y aquí solo se espera; antes corría después de que la
// página devolvía su árbol y alargaba el esqueleto de «Hoy» una ida a la base.

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { diasDeCajaAbierta } from "@/lib/caja";
import { canUseCaja } from "@/lib/caja-pin";
import { textosDinero } from "@/lib/dinero/textos";

type QuienMira = { role?: string | null; canAccessCaja?: boolean | null };

/**
 * Días que lleva abierta la caja de la clínica de la sesión, para el aviso. Sin permiso de
 * Caja no consulta nada; si algo falla, 0 (el aviso se calla). Nunca rechaza: la página la
 * empieza antes de sus propias lecturas y puede no llegar a esperarla.
 */
export function leerDiasCajaAbierta(clinicId: string, user: QuienMira): Promise<number> {
  if (!clinicId || !canUseCaja(user)) return Promise.resolve(0);
  return diasDeCajaAbierta(clinicId).catch(() => 0);
}

export async function AvisoCajaAbierta({
  clinicId,
  locale,
  user,
  dias: diasYaPedidos,
}: {
  clinicId: string;
  locale: string;
  user: QuienMira;
  /** La lectura ya empezada por la página (`leerDiasCajaAbierta`). Sin ella, se lee aquí. */
  dias?: Promise<number>;
}) {
  if (!clinicId || !canUseCaja(user)) return null;
  const dias = await (diasYaPedidos ?? leerDiasCajaAbierta(clinicId, user));
  if (dias < 1) return null;
  const tx = textosDinero(locale).caja;
  return (
    <div
      role="alert"
      data-aviso-caja-abierta
      className="flex flex-wrap items-start gap-3 mb-4"
      style={{
        background: "var(--warning-soft)",
        border: "1px solid var(--warning-border-strong)",
        borderRadius: "var(--radius)",
        padding: 14,
      }}
    >
      <AlertTriangle size={18} strokeWidth={2} aria-hidden style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
      <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
        <div className="text-sm font-semibold" style={{ color: "var(--warning-strong)" }}>{tx.abiertaTitulo(dias)}</div>
        <div className="text-xs" style={{ color: "var(--text-2)", marginTop: 2 }}>{tx.abiertaTexto}</div>
      </div>
      <Link href="/dashboard/caja" className="text-sm font-semibold" style={{ color: "var(--warning-strong)", alignSelf: "center" }}>
        {tx.abiertaIr} →
      </Link>
    </div>
  );
}
