// Una «Google Calendar» falsa para las pruebas de la sincronización.
//
// Imita lo que importa de la API real (no el transporte):
//   · events.insert con `id` propio: si ese id ya existe —aunque el evento esté
//     borrado/cancelado— contesta 409, como Google.
//   · events.patch MEZCLA: solo cambia lo que va en el cuerpo; un evento
//     inexistente da 404. (Por eso mover una cita con patch conserva invitados
//     y recordatorios.)
//   · events.update REEMPLAZA el evento entero (lo que hacía el código viejo):
//     existe aquí para poder demostrar que ya nadie lo llama (contador).
//   · events.delete no quita el evento, lo deja `status: cancelled`; borrar dos
//     veces da 410; uno que no existe, 404.
//   · calendarList / calendars con marca de descripción.
//
// Además registra cada llamada y deja programar fallos por operación.

import type { ClienteCalendar, EntradaCalendario } from "@/lib/google-calendar";

export function errorGoogle(status: number, razon?: string, mensaje = `Google ${status}`) {
  return Object.assign(new Error(mensaje), {
    code: String(status),
    response: { status, data: { error: { code: status, message: mensaje, errors: razon ? [{ reason: razon }] : [] } } },
  });
}

export function errorInvalidGrant() {
  return Object.assign(new Error("invalid_grant"), {
    code: "400",
    response: { status: 400, data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
  });
}

export interface EventoFalso {
  id: string;
  status: "confirmed" | "cancelled";
  [k: string]: any;
}

export class GoogleFalsa implements ClienteCalendar {
  calendarios = new Map<string, { id: string; summary: string; description: string; colorId?: string; timeZone?: string }>();
  eventos = new Map<string, EventoFalso>();
  llamadas: { op: string; args: any }[] = [];
  updates = 0;
  private fallos: { op: string; quedan: number; error: Error }[] = [];
  private seq = 0;
  /** Se ejecuta antes de cada operación (para simular lentitud o un token renovado). */
  antes: ((op: string) => Promise<void> | void) | null = null;

  /** Falla `veces` veces la operación `op` (p. ej. "events.insert") con `error`. */
  fallar(op: string, error: Error, veces = 1) {
    this.fallos.push({ op, quedan: veces, error });
  }

  private async paso(op: string, args: any) {
    this.llamadas.push({ op, args });
    if (this.antes) await this.antes(op);
    const f = this.fallos.find((x) => x.op === op && x.quedan > 0);
    if (f) {
      f.quedan--;
      throw f.error;
    }
  }

  cuantas(op: string) {
    return this.llamadas.filter((l) => l.op === op).length;
  }

  eventoEn(calendarId: string, eventId: string) {
    return this.eventos.get(`${calendarId}/${eventId}`);
  }

  activos(calendarId?: string) {
    return [...this.eventos.entries()]
      .filter(([k, e]) => e.status !== "cancelled" && (!calendarId || k.startsWith(`${calendarId}/`)))
      .map(([, e]) => e);
  }

  /** Siembra un calendario ya existente en la cuenta (p. ej. el de otra clínica). */
  sembrarCalendario(id: string, summary: string, description: string) {
    this.calendarios.set(id, { id, summary, description });
  }

  events = {
    insert: async (p: { calendarId: string; sendUpdates?: string; requestBody: Record<string, any> }) => {
      await this.paso("events.insert", p);
      if (!this.calendarios.has(p.calendarId) && p.calendarId !== "primary") throw errorGoogle(404, "notFound", "Not Found");
      const id = p.requestBody.id ?? `g${++this.seq}`;
      const k = `${p.calendarId}/${id}`;
      if (this.eventos.has(k)) throw errorGoogle(409, "duplicate", "The requested identifier already exists.");
      this.eventos.set(k, { ...structuredClone(p.requestBody), id, status: "confirmed" });
      return { data: { id } };
    },
    patch: async (p: { calendarId: string; eventId: string; sendUpdates?: string; requestBody: Record<string, any> }) => {
      await this.paso("events.patch", p);
      const k = `${p.calendarId}/${p.eventId}`;
      const e = this.eventos.get(k);
      if (!e) throw errorGoogle(404, "notFound", "Not Found");
      Object.assign(e, structuredClone(p.requestBody)); // mezcla: lo que no va, se queda
      return { data: { id: p.eventId } };
    },
    /** El reemplazo total del código viejo: si alguien lo llama, `updates` lo delata. */
    update: async (p: { calendarId: string; eventId: string; requestBody: Record<string, any> }) => {
      this.updates++;
      await this.paso("events.update", p);
      const k = `${p.calendarId}/${p.eventId}`;
      if (!this.eventos.has(k)) throw errorGoogle(404, "notFound", "Not Found");
      this.eventos.set(k, { ...structuredClone(p.requestBody), id: p.eventId, status: "confirmed" });
      return { data: { id: p.eventId } };
    },
    delete: async (p: { calendarId: string; eventId: string; sendUpdates?: string }) => {
      await this.paso("events.delete", p);
      const k = `${p.calendarId}/${p.eventId}`;
      const e = this.eventos.get(k);
      if (!e) throw errorGoogle(404, "notFound", "Not Found");
      if (e.status === "cancelled") throw errorGoogle(410, "deleted", "Resource has been deleted");
      e.status = "cancelled";
      return {};
    },
  };

  calendarList = {
    list: async (p?: { pageToken?: string; maxResults?: number }) => {
      await this.paso("calendarList.list", p);
      const items: EntradaCalendario[] = [...this.calendarios.values()].map((c) => ({ id: c.id, summary: c.summary, description: c.description }));
      return { data: { items } };
    },
    patch: async (p: { calendarId: string; requestBody: Record<string, any> }) => {
      await this.paso("calendarList.patch", p);
      const c = this.calendarios.get(p.calendarId);
      if (c) Object.assign(c, p.requestBody);
      return {};
    },
  };

  calendars = {
    insert: async (p: { requestBody: Record<string, any> }) => {
      await this.paso("calendars.insert", p);
      const id = `cal${++this.seq}@group.calendar.google.com`;
      this.calendarios.set(id, { id, summary: p.requestBody.summary, description: p.requestBody.description, timeZone: p.requestBody.timeZone });
      return { data: { id } };
    },
    delete: async (p: { calendarId: string }) => {
      await this.paso("calendars.delete", p);
      this.calendarios.delete(p.calendarId);
      return {};
    },
    patch: async (p: { calendarId: string; requestBody: Record<string, any> }) => {
      await this.paso("calendars.patch", p);
      const c = this.calendarios.get(p.calendarId);
      if (!c) throw errorGoogle(404, "notFound", "Not Found");
      Object.assign(c, p.requestBody);
      return {};
    },
  };
}
