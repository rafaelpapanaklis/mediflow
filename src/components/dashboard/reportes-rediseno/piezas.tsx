import type { LucideIcon } from "lucide-react";
import s from "./rediseno.module.css";

/**
 * Estado vacío de una gráfica o lista de Reportes, con el rediseño
 * encendido. Mismo patrón que `Vacio` en `hoy-rediseno/piezas.tsx` (ícono en
 * chip violeta suave + título + pista corta): no se inventa, se copia.
 */
export function Vacio({ icono: Icono, titulo, pista }: { icono: LucideIcon; titulo: string; pista?: string }) {
  return (
    <div role="status" aria-live="polite" className={s.vacio}>
      <span className={s.vacioIcono}>
        <Icono size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={s.vacioTitulo}>{titulo}</span>
      {pista && <span className={s.vacioPista}>{pista}</span>}
    </div>
  );
}
