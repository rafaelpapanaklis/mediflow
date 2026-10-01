/**
 * Cupo de USUARIOS del plan — núcleo puro y client-safe (sin prisma).
 * La pantalla de Equipo y los endpoints que crean o reactivan miembros leen
 * el cupo con la MISMA regla (`cupoDeUsuarios`), así el aviso de la pantalla
 * y el 402 del servidor nunca discrepan.
 */
export interface CupoUsuarios {
  /** Usuarios ACTIVOS de la clínica (los desactivados no cuentan). */
  usados: number;
  /** Tope efectivo (plan + condiciones conservadas de /admin); null = ilimitado. */
  max: number | null;
  /** true = ya no cabe otro usuario activo. */
  lleno: boolean;
}

export function cupoDeUsuarios(usados: number, max: number | null | undefined): CupoUsuarios {
  const tope = max ?? null;
  return { usados, max: tope, lleno: tope !== null && usados >= tope };
}

/** Un plan al que se puede subir desde el aviso de tope (lo arma el servidor). */
export interface PlanSubida {
  id: string;
  name: string;
  maxUsers: number | null;
  priceMxn: number;
}
