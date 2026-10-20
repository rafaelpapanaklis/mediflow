/**
 * WS1-T9 · el «¿Seguro?» de sobreagendar en las dos puertas de Google de la
 * agenda: «Convertir en cita» (revisión t8, C2) y «Mover la cita» del aviso
 * «El evento de Google cambió…» (segunda vuelta, C5).
 *
 * Con la agenda flexible (ws1-t5) la API de citas contesta 409 con
 * `sobreagendable` cuando la hora cae sobre otra cita del doctor o en su
 * comida; quien lo confirma reenvía con `sobreagendar`, `sobreagendarCita` y
 * `sobreagendarOtras` (el contrato de ws1-t5). Sin esa bandera nunca llega.
 *
 * Sin React: se prueba con un `fetch` falso
 * (src/lib/google/__tests__/sobreagendar-aviso.test.ts).
 */

export interface ConfirmacionSobreagenda {
  tipo: "cita" | "comida";
  citaId: string | null;
  paciente: string | null;
  hora: string | null;
  comidaDesde: string | null;
  comidaHasta: string | null;
  otras: number;
}

export function confirmacionDesde409(raw: unknown, zona: string, locale: string): ConfirmacionSobreagenda | null {
  const b = raw as {
    error?: unknown;
    sobreagendable?: unknown;
    conflictingAppointment?: { id?: unknown; patientName?: unknown; startsAt?: unknown; endsAt?: unknown; otras?: unknown } | null;
    comida?: { lunchStart?: unknown; lunchEnd?: unknown } | null;
  } | null;
  if (!b || b.sobreagendable !== true || (b.error !== "appointment_overlap" && b.error !== "lunch_overlap")) return null;
  const c = b.conflictingAppointment && typeof b.conflictingAppointment.id === "string" && b.conflictingAppointment.id !== "unknown"
    ? b.conflictingAppointment
    : null;
  const fmt = new Intl.DateTimeFormat(locale, { timeZone: zona, hour: "2-digit", minute: "2-digit", hour12: false });
  const hora = (iso: unknown) => (typeof iso === "string" && !Number.isNaN(Date.parse(iso)) ? fmt.format(new Date(iso)) : "");
  return {
    // Sin la otra cita (id «unknown») solo es «comida» si el servidor lo dijo.
    tipo: c || b.error !== "lunch_overlap" ? "cita" : "comida",
    citaId: c ? (c.id as string) : null,
    paciente: c && typeof c.patientName === "string" ? c.patientName.trim() || null : null,
    hora: c ? [hora(c.startsAt), hora(c.endsAt)].filter(Boolean).join("–") : null,
    comidaDesde: typeof b.comida?.lunchStart === "string" ? b.comida.lunchStart : null,
    comidaHasta: typeof b.comida?.lunchEnd === "string" ? b.comida.lunchEnd : null,
    otras: c && typeof c.otras === "number" && c.otras > 0 ? c.otras : 0,
  };
}

/** Lo que se añade al cuerpo tras «Sí, sobreagendar». */
export function camposSobreagendar(c: ConfirmacionSobreagenda | null): Record<string, unknown> {
  return c ? { sobreagendar: true, sobreagendarCita: c.citaId, sobreagendarOtras: c.otras } : {};
}

/**
 * ¿Hay que volver a preguntar? Solo si el 409 trae OTRA cita (o más) que la
 * ya confirmada; si es la misma, el «Sí» ya se dio y lo que falle es otra cosa.
 */
export function preguntarOtraVez(
  nueva: ConfirmacionSobreagenda | null,
  yaConfirmada: ConfirmacionSobreagenda | null,
): nueva is ConfirmacionSobreagenda {
  if (!nueva) return false;
  return !(yaConfirmada && nueva.citaId === yaConfirmada.citaId && nueva.otras <= yaConfirmada.otras);
}

export type ResultadoMover =
  | { estado: "ok"; body: { appointment?: unknown; scheduleWarning?: { message?: string } | null; whatsapp?: unknown } }
  | { estado: "confirmar"; confirmacion: ConfirmacionSobreagenda }
  | { estado: "error"; status: number; codigo: string; body?: unknown };

/**
 * «Mover la cita» a la hora nueva del evento (el aviso de la cita convertida).
 * Es el mismo PATCH que arrastrar la cita (`rescheduleAppointment`), pero lee
 * el 409 entero para ofrecer el «¿Seguro?» (C5): `rescheduleAppointment` no
 * es de esta rama y, sin la agenda flexible, descarta `sobreagendable`.
 */
export async function moverCitaAlEvento(d: {
  citaId: string;
  inicio: string;
  fin: string;
  confirmada: ConfirmacionSobreagenda | null;
  zona: string;
  locale: string;
  fetch?: typeof fetch;
}): Promise<ResultadoMover> {
  const f = d.fetch ?? fetch;
  const res = await f(`/api/appointments/${encodeURIComponent(d.citaId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startsAt: d.inicio,
      endsAt: d.fin,
      // Sin `bloqueoConfirmado`: el bloqueo del propio evento ya está retirado,
      // y cualquier otro en esa hora (vacaciones, personal) nadie lo ha visto.
      ...camposSobreagendar(d.confirmada),
    }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) return { estado: "ok", body: (body ?? {}) as Extract<ResultadoMover, { estado: "ok" }>["body"] };
  if (res.status === 409) {
    const aviso = confirmacionDesde409(body, d.zona, d.locale);
    if (preguntarOtraVez(aviso, d.confirmada)) return { estado: "confirmar", confirmacion: aviso };
  }
  return { estado: "error", status: res.status, codigo: typeof body?.error === "string" ? body.error : "", body };
}
