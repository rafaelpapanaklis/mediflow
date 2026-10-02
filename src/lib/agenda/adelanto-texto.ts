// ws1-t8 (decisión 6): el aviso que ve el equipo cuando la cita futura de un paciente que llegó hoy se trae
// a hoy. Puro, para el navegador (la regla y la escritura están en adelantar-cita-a-hoy.ts).

export interface AdelantoVisto {
  /** Inicio que tenía la cita (ISO). */
  de: string;
  /** Inicio nuevo, hoy (ISO). */
  a: string;
  sinSillon: boolean;
  seCruzaCon: { paciente: string; startsAt: string } | null;
}

function fecha(iso: string, zona?: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: zona,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(",", "");
}

function hora(iso: string, zona?: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: zona, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function textoDelAdelanto(a: AdelantoVisto, zona?: string): string {
  const partes = [`La cita era del ${fecha(a.de, zona)}: se pasó a hoy a las ${hora(a.a, zona)}. Al paciente no se le manda aviso.`];
  if (a.sinSillon) partes.push("Quedó sin sillón: el suyo está ocupado a esta hora.");
  if (a.seCruzaCon) partes.push(`Se cruza con la cita de ${a.seCruzaCon.paciente} de las ${hora(a.seCruzaCon.startsAt, zona)} (queda como sobreturno).`);
  return partes.join(" ");
}

/** Lee el adelanto de la respuesta de /status o /check-in sin fiarse de su forma. */
export function adelantoDeLaRespuesta(cuerpo: unknown): AdelantoVisto | null {
  const a = (cuerpo as { adelantada?: unknown } | null)?.adelantada as Partial<AdelantoVisto> | null | undefined;
  if (!a || typeof a.de !== "string" || typeof a.a !== "string") return null;
  return { de: a.de, a: a.a, sinSillon: a.sinSillon === true, seCruzaCon: a.seCruzaCon ?? null };
}
