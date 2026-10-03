// Ortodoncia — cómo se CUENTAN las alertas (ws1-t8, auditoría de BEVADENT, F16). Puro: sin base ni React.
//
//  · «77 casos que revisar» con 45 casos activos: el subtítulo sumaba AVISOS (un paciente con mensualidad vencida,
//    sin próximo control y el plan incompleto contaba tres veces). Ahora cuenta PACIENTES distintos y, si no
//    coinciden, dice también cuántos avisos son.
//  · «Sin próximo control» 20 en Controles y 18 en Alertas: es la MISMA lista (`casosSinControl` /
//    `listMissingNextControl`, mismo criterio), pero Alertas no muestra a quien vino HOY (se le agenda el siguiente
//    al despedirlo) ni a quien alguien pospuso 7 días. La diferencia se dice en las dos pantallas.

/** Pacientes distintos entre todas las listas de alertas (un paciente en tres listas cuenta una vez). */
export function pacientesConAlerta(listas: ReadonlyArray<ReadonlyArray<{ patientId: string }>>): number {
  const vistos = new Set<string>();
  for (const l of listas) for (const f of l) vistos.add(f.patientId);
  return vistos.size;
}

/** Cuántos avisos hay en total (la suma de las listas). */
export function avisosEnTotal(listas: ReadonlyArray<ReadonlyArray<unknown>>): number {
  return listas.reduce((n, l) => n + l.length, 0);
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** El subtítulo de Alertas: «12 pacientes que revisar (20 avisos: …)». */
export function textoDeCuentaDeAlertas(pacientes: number, avisos: number): string {
  if (avisos === 0 || pacientes === 0) return "Sin alertas pendientes.";
  const base = `${plural(pacientes, "paciente", "pacientes")} que revisar`;
  if (avisos === pacientes) return `${base}.`;
  return `${base} (${plural(avisos, "aviso", "avisos")}: un paciente puede salir en más de una lista).`;
}

/** Los de «Sin próximo control» que Alertas no muestra, y por qué. */
export interface SinControlFuera {
  /** Vinieron hoy: Controles los lista («Vino hoy · falta agendar el siguiente»), Alertas no. */
  vinieronHoy: number;
  /** Alguien los pospuso 7 días desde Alertas. */
  pospuestos: number;
}

/**
 * Debajo de «Sin próximo control» en ALERTAS: por qué Controles / agenda da otra cifra. `null` si son iguales.
 * `enAlertas` = los que sí salen aquí.
 */
export function textoSinControlEnAlertas(enAlertas: number, fuera: SinControlFuera | null | undefined): string | null {
  if (!fuera) return null;
  const partes: string[] = [];
  if (fuera.vinieronHoy > 0) {
    partes.push(`${plural(fuera.vinieronHoy, "que vino hoy", "que vinieron hoy")} (falta ${fuera.vinieronHoy === 1 ? "agendarle" : "agendarles"} el siguiente)`);
  }
  if (fuera.pospuestos > 0) partes.push(`${plural(fuera.pospuestos, "pospuesto", "pospuestos")} 7 días`);
  if (partes.length === 0) return null;
  const total = enAlertas + fuera.vinieronHoy + fuera.pospuestos;
  return `Controles / agenda cuenta ${total}: aquí no salen ${partes.join(" ni ")}.`;
}

/** Debajo de «Sin próximo control» en CONTROLES: por qué Alertas da otra cifra. `null` si son iguales. */
export function textoSinControlEnControles(total: number, fuera: SinControlFuera | null | undefined): string | null {
  if (!fuera) return null;
  const partes: string[] = [];
  if (fuera.vinieronHoy > 0) partes.push(`${plural(fuera.vinieronHoy, "que vino hoy", "que vinieron hoy")}`);
  if (fuera.pospuestos > 0) partes.push(`${plural(fuera.pospuestos, "pospuesto", "pospuestos")} 7 días desde Alertas`);
  if (partes.length === 0) return null;
  const enAlertas = Math.max(0, total - fuera.vinieronHoy - fuera.pospuestos);
  return `Alertas muestra ${enAlertas}: no lista ${partes.join(" ni ")}.`;
}

/**
 * La lista de «Sin próximo control» de Controles, con lo que Alertas no muestra: quien vino hoy (`vinoHoyElPaciente`:
 * pásale la MISMA regla que usa Alertas, `vinoHoy` de controles-modulo; `diasSinControl` 0 no sirve, porque también
 * sale 0 con un control de un día futuro firmado por adelantado) y lo pospuesto 7 días (la posposición vigente de
 * «sin-proximo-control»). Mismo orden que Alertas: primero se aparta quien vino hoy, luego lo pospuesto. Devuelve las
 * filas (las pospuestas, con su `pospuestoHasta`) y las cuentas.
 */
export function marcarPospuestosSinControl<T extends { patientId: string; pospuestoHasta?: Date | null }>(
  filas: readonly T[],
  pospuestas: ReadonlyArray<{ patientId: string; tipo: string; hasta: Date }>,
  ahora: Date,
  vinoHoyElPaciente: (patientId: string) => boolean,
): { filas: T[]; fuera: SinControlFuera } {
  const hasta = new Map<string, Date>();
  for (const p of pospuestas) {
    if (p.tipo !== "sin-proximo-control" || p.hasta.getTime() <= ahora.getTime()) continue;
    const previa = hasta.get(p.patientId);
    if (!previa || p.hasta > previa) hasta.set(p.patientId, p.hasta);
  }
  let vinieronHoy = 0;
  let pospuestos = 0;
  const salida = filas.map((f) => {
    if (vinoHoyElPaciente(f.patientId)) {
      vinieronHoy += 1;
      return f;
    }
    const h = hasta.get(f.patientId);
    if (!h) return f;
    pospuestos += 1;
    return { ...f, pospuestoHasta: h };
  });
  return { filas: salida, fuera: { vinieronHoy, pospuestos } };
}
