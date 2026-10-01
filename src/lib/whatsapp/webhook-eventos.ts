// Desarmado PURO del cuerpo que Meta manda al webhook de WhatsApp.
//
// ws1-t3 (auditoría del bot, #10): el webhook leía solo
// `entry[0].changes[0].messages[0]`. Meta puede agrupar en una sola llamada
// varias entradas, varios cambios y varios mensajes; todo lo que no fuera el
// primero se perdía sin llegar ni al Inbox. Aquí se recorre TODO, en el orden
// en que viene, y el webhook procesa cada evento por separado.
//
// Sin Prisma ni Next: lo prueban los tests con payloads a mano.

export type EventoWebhook =
  /** La clínica respondió desde la app del celular (coexistence). */
  | { tipo: "ecos"; value: any }
  /** Meta aprobó/rechazó una plantilla. `entryId` es el WABA id. */
  | { tipo: "plantilla"; entryId: string | null; value: any }
  /** Estados de entrega (sent/delivered/read/failed) de lo que mandamos. */
  | { tipo: "estados"; value: any }
  /** Un mensaje entrante del paciente. */
  | { tipo: "mensaje"; value: any; msg: any };

const lista = (x: unknown): any[] => (Array.isArray(x) ? x : []);

export function extraerEventosDelWebhook(body: unknown): EventoWebhook[] {
  const eventos: EventoWebhook[] = [];
  for (const entry of lista((body as any)?.entry)) {
    for (const change of lista(entry?.changes)) {
      const value = change?.value;
      if (!value || typeof value !== "object") continue;
      if (change?.field === "smb_message_echoes") {
        eventos.push({ tipo: "ecos", value });
        continue;
      }
      if (change?.field === "message_template_status_update") {
        eventos.push({ tipo: "plantilla", entryId: typeof entry?.id === "string" ? entry.id : null, value });
        continue;
      }
      // Estados ANTES que mensajes, como antes: si vinieran juntos, el estado
      // de lo que ya mandamos no depende de lo que conteste el bot ahora.
      if (lista(value.statuses).length > 0) eventos.push({ tipo: "estados", value });
      for (const msg of lista(value.messages)) {
        if (msg && typeof msg === "object") eventos.push({ tipo: "mensaje", value, msg });
      }
    }
  }
  return eventos;
}

/**
 * ws1-t3 #19 — el phone_number_id del cambio, o null si falta o viene vacío.
 * Con `undefined` en el `where`, Prisma descarta la clave y la consulta
 * devolvía la PRIMERA clínica de la tabla: un mensaje sin metadata no puede
 * resolverse a ninguna clínica.
 */
export function phoneNumberIdDe(value: unknown): string | null {
  const id = (value as any)?.metadata?.phone_number_id;
  if (typeof id === "string" && id.trim().length > 0) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}
