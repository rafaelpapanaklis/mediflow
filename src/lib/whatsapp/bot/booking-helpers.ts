import { prisma } from "@/lib/prisma";
import { getTzParts, todayInTz } from "@/lib/agenda/time-utils";

/**
 * Helpers de soporte para el flujo de agenda del bot (T4): parseo de fechas y
 * horas en español, formateo para WhatsApp y alta/vinculación de paciente por
 * teléfono (scopeado por clinicId, marcado source=WHATSAPP). Espejo de los
 * idiomas ya usados en /api/public/book y el webhook de WhatsApp.
 */

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

export function normalizeLast10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Parsea "hoy"/"mañana"/"pasado mañana", ISO, DD/MM[/YYYY] y "10 de junio". */
export function parseDateInput(text: string, timezone: string): string | null {
  const t = text.trim().toLowerCase();
  const today = todayInTz(timezone);

  if (/pasado\s+ma(n|ñ)ana/.test(t)) return addDaysISO(today, 2);
  if (/\bhoy\b/.test(t)) return today;
  if (/ma(n|ñ)ana/.test(t)) return addDaysISO(today, 1);

  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dm = t.match(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = parseInt(dm[2], 10);
    let year = dm[3] ? parseInt(dm[3], 10) : parseInt(today.slice(0, 4), 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  const named = t.match(/\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{4}))?/);
  if (named) {
    const day = parseInt(named[1], 10);
    const month = MONTHS[named[2]];
    const year = named[3] ? parseInt(named[3], 10) : parseInt(today.slice(0, 4), 10);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }
  return null;
}

/** Parsea "16:30", "4pm", "4 pm". Devuelve "HH:MM" 24h o null. */
export function parseTimeInput(text: string): string | null {
  const t = text.trim().toLowerCase();
  const hm = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const mn = parseInt(hm[2], 10);
    if (h >= 0 && h <= 23 && mn >= 0 && mn <= 59) return `${pad2(h)}:${pad2(mn)}`;
  }
  const ap = t.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (ap) {
    let h = parseInt(ap[1], 10);
    if (ap[2] === "pm" && h < 12) h += 12;
    if (ap[2] === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) return `${pad2(h)}:00`;
  }
  return null;
}

/** Primer entero del texto como índice 0-based dentro de [1, max]; si no, null. */
export function parseChoiceIndex(text: string, max: number): number | null {
  const m = text.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (n >= 1 && n <= max) return n - 1;
  return null;
}

export function isAffirmative(text: string): boolean {
  return /\b(s[ií]|claro|correcto|confirmo|confirmar|de acuerdo|va|ok|okay|dale|perfecto|sale)\b/i.test(text.trim());
}

export function isNegative(text: string): boolean {
  return /\b(no|nel|negativo|mejor no|otro|otra)\b/i.test(text.trim());
}

export function isCancelWord(text: string): boolean {
  return /\b(cancelar|cancela|cancelo|olv[ií]dalo|d[eé]jalo|ya no|salir|detente)\b/i.test(text.trim());
}

export function formatDateHuman(dateISO: string, timezone: string): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

export function formatTimeHuman(date: Date, timezone: string): string {
  const p = getTzParts(date, timezone);
  return `${pad2(p.hour === 24 ? 0 : p.hour)}:${pad2(p.minute)}`;
}

export function toISODate(date: Date, timezone: string): string {
  const p = getTzParts(date, timezone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Busca un paciente por teléfono (últimos 10 dígitos, como el webhook) dentro
 * de la clínica; si no existe lo crea con source=WHATSAPP. patientNumber se
 * genera de forma concurrency-safe con row-lock de la clínica (idéntico a
 * /api/public/book). Devuelve { id } o null si falla.
 */
export async function findOrCreateWhatsAppPatient(
  clinicId: string,
  phoneRaw: string,
  fullName: string,
): Promise<{ id: string } | null> {
  const last10 = normalizeLast10(phoneRaw);
  if (last10.length >= 10) {
    const existing = await prisma.patient.findFirst({
      where: { clinicId, phone: { contains: last10 } },
      select: { id: true },
    });
    if (existing) return existing;
  }

  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || "Paciente";
  const lastName = parts.slice(1).join(" ") || "WhatsApp";

  try {
    return await prisma.$transaction(async (tx) => {
      // Serializa creates concurrentes por clínica (igual que /api/public/book).
      await tx.$executeRaw`SELECT 1 FROM clinics WHERE id = ${clinicId} FOR UPDATE`;
      const count = await tx.patient.count({ where: { clinicId } });
      const patientNumber = `P${String(count + 1).padStart(4, "0")}`;
      return tx.patient.create({
        data: {
          clinicId,
          patientNumber,
          firstName,
          lastName,
          phone: phoneRaw,
          source: "WHATSAPP",
          lifecycleStage: "patient",
        },
        select: { id: true },
      });
    });
  } catch (err) {
    console.error("[bot/booking] patient create failed", err);
    return null;
  }
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
