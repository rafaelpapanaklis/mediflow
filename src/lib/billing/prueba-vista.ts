/**
 * QUÉ SE ENSEÑA de la prueba (trial) en Configuración → Suscripción — núcleo PURO (sin React ni i18n).
 *
 * Una prueba normal dura 14 días: «9 días restantes de 14», con su barra. Pero una clínica puede tener un
 * `trialEndsAt` muy lejano (una cuenta de prueba de Rafael, una prórroga larga…): «3633 días restantes de 14»
 * y «Termina el 6 de septiembre de 2036» no significan nada. Aquí se decide qué mostrar:
 *   · `hoy` / `uno`        → «Termina hoy» / «1 día restante» (como siempre);
 *   · `normal`             → «N días restantes de 14», barra de uso (dentro de la duración normal);
 *   · `prorrogada`         → «N días restantes» (más de 14, hasta un año): sin «de 14» ni barra;
 *   · `sinVencimiento`     → más de un año: «Prueba sin vencimiento cercano»; sin fecha ni barra.
 */
export type PruebaVista =
  | { tipo: "hoy"; barra: boolean; fecha: boolean }
  | { tipo: "uno"; barra: boolean; fecha: boolean }
  | { tipo: "normal"; barra: boolean; fecha: boolean }
  | { tipo: "prorrogada"; barra: boolean; fecha: boolean }
  | { tipo: "sinVencimiento"; barra: boolean; fecha: boolean };

/** Más allá de esto la fecha de fin ya no es un vencimiento real que valga la pena enseñar. */
export const DIAS_PRUEBA_SIN_VENCIMIENTO = 365;

export function pruebaVista(diasRestantes: number, totalDias: number): PruebaVista {
  const d = Math.max(0, Math.floor(diasRestantes));
  if (d > DIAS_PRUEBA_SIN_VENCIMIENTO) return { tipo: "sinVencimiento", barra: false, fecha: false };
  if (d > totalDias) return { tipo: "prorrogada", barra: false, fecha: true };
  if (d === 0) return { tipo: "hoy", barra: true, fecha: true };
  if (d === 1) return { tipo: "uno", barra: true, fecha: true };
  return { tipo: "normal", barra: true, fecha: true };
}

/** Miles con coma y sin decimales: 1719 → «1,719». */
export function miles(n: number): string {
  return Math.round(n).toLocaleString("es-MX");
}
