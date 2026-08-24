import "server-only";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { cookies } from "next/headers";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";
import { BARBER_FILES_BUCKET, canTransition } from "@/lib/barber/types";
import {
  BARBER_CANCEL_WINDOW_HOURS,
  BARBER_LOYALTY_GOAL,
  BARBER_PORTAL_COOKIE,
  PORTAL_CODE_MAX_ATTEMPTS,
  PORTAL_CODE_MAX_PER_WINDOW,
  PORTAL_CODE_TTL_MIN,
  PORTAL_CODE_WINDOW_MIN,
  canClientCancel,
  pickPortalShop,
  readPortalSession,
  type PortalSession,
  type PortalShopDTO,
} from "@/lib/barber/portal-core";

/**
 * El núcleo PURO del portal (parámetros, firma de la sesión, política de
 * cancelación) vive en ./portal-core y se re-exporta desde aquí: los
 * consumidores siguen importando de "@/lib/barber/client-portal" y las
 * pruebas pueden cargar el núcleo sin arrastrar prisma ni next/headers.
 */
export * from "@/lib/barber/portal-core";
import type {
  BarberAppointmentStatus,
  BarberClientMembershipStatus,
  BarberDepositStatus,
  BarberPaymentMethod,
  BarberPhotoKind,
} from "@/lib/barber/types";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — PORTAL DEL CLIENTE (/b/[slug]/mi-cuenta).
   ═══════════════════════════════════════════════════════════════════════

   En una barbería nadie recuerda una contraseña. El acceso es teléfono +
   código de un solo uso, y punto.

   LO QUE ESTE MÓDULO GARANTIZA
   ────────────────────────────────────────────────────────────────────────
   1. El código NUNCA se guarda ni se loguea en claro: en
      BarberClientAuthToken.codeHash va un hash bcrypt. Un volcado de la
      tabla no revela un solo código.
   2. Caduca (10 min), es de un SOLO uso y tiene tope de intentos (5). Al
      quinto fallo el código se quema, no se queda esperando al bot.
   3. ENUMERACIÓN DE TELÉFONOS: la respuesta de "mándame el código" es
      idéntica exista o no el cliente — mismo texto, mismo status y hasta el
      mismo costo de CPU (se hashea un valor falso cuando no hay cliente).
   4. La sesión del portal es PROPIA: cookie httpOnly firmada, sin relación
      con la sesión Supabase del panel ni con la del dental. Lleva dentro el
      barbershopId y se valida contra la barbería del slug en CADA petición:
      un cliente de la barbería X no alcanza nada de la barbería Y.
   5. Un cliente del portal NO tiene sesión Supabase, así que
      getBarberContext() devuelve null y el layout de /barber/** lo manda a
      /login. No hay puerta al panel desde aquí.

   FRONTERAS
   ────────────────────────────────────────────────────────────────────────
   · T7 manda el WhatsApp: deliverPortalCode() es el gancho. Esta ola genera
     y valida el código; NO envía mensajes.
   · T4 es dueño de membresías y anticipos: aquí solo se LEEN.
   ═══════════════════════════════════════════════════════════════════════ */

// ── La barbería del portal, resuelta por slug ───────────────────────────

/**
 * Resuelve el slug para el portal. Una barbería apagada o con la suscripción
 * impaga no expone portal: los datos de sus clientes dejan de estar servidos
 * en cuanto deja de ser cliente de DaleControl.
 */
export async function resolvePortalShop(slug: string): Promise<PortalShopDTO | null> {
  if (typeof slug !== "string" || !slug.trim()) return null;
  const row = await prisma.barbershop.findUnique({
    where: { slug: slug.trim() },
    select: {
      id: true, name: true, slug: true, phone: true, address: true, city: true,
      state: true, timezone: true, locale: true, logoUrl: true, branchName: true,
      isActive: true, subscriptionStatus: true,
    },
  });
  if (!row || !row.isActive || !isBarbershopSubscriptionActive(row)) return null;
  // isActive y subscriptionStatus se leyeron SOLO para decidir la puerta: no
  // salen del servidor. El recorte lo hace la lista blanca, no un destructuring
  // que se pueda olvidar de un campo nuevo.
  return pickPortalShop(row as unknown as Record<string, unknown>);
}

// ── Código de un solo uso ───────────────────────────────────────────────

/** 6 dígitos con randomInt (CSPRNG), ceros a la izquierda incluidos. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * GANCHO — entrega del código. T7 es dueño del envío por WhatsApp.
 *
 * Fuera de producción escribe el código en el log del servidor para poder
 * probar el portal sin WhatsApp conectado. En producción NO escribe nada:
 * un código en los logs es un código filtrado.
 */
export function deliverPortalCode(args: {
  barbershopId: string;
  phone: string;
  code: string;
}): void {
  if (process.env.NODE_ENV === "production") {
    // TODO(T7): enviar la plantilla de WhatsApp con el código.
    return;
  }
  console.info(
    `[barber/portal] código de acceso para ${args.phone} (barbería ${args.barbershopId}): ${args.code}`,
  );
}

/**
 * Emite un código para el teléfono dado. NO dice si el cliente existe: es
 * `void` a propósito, para que ninguna ruta pueda filtrar esa señal por
 * accidente.
 *
 * Cuando el cliente sí existe, cualquier código anterior suyo se quema: solo
 * hay UN código vivo por cliente en todo momento.
 */
export async function requestPortalCode(args: {
  barbershopId: string;
  phone: string;
}): Promise<void> {
  const { barbershopId, phone } = args;

  const client = await prisma.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId, phone } },
    select: { id: true, portalEnabled: true, blockedAt: true },
  });

  // Sin cliente (o con el portal apagado / bloqueado) se hace el MISMO
  // trabajo: un bcrypt de un valor falso, para que el tiempo de respuesta no
  // delate quién está dado de alta.
  if (!client || !client.portalEnabled || client.blockedAt) {
    await bcrypt.hash(generateCode(), 10);
    return;
  }

  const windowStart = new Date(Date.now() - PORTAL_CODE_WINDOW_MIN * 60_000);
  const recent = await prisma.barberClientAuthToken.count({
    where: { clientId: client.id, createdAt: { gte: windowStart } },
  });
  if (recent >= PORTAL_CODE_MAX_PER_WINDOW) {
    // Tope de reenvíos alcanzado: mismo silencio, mismo costo.
    await bcrypt.hash(generateCode(), 10);
    return;
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + PORTAL_CODE_TTL_MIN * 60_000);

  await prisma.$transaction([
    // Un código nuevo invalida el anterior: nunca hay dos vivos.
    prisma.barberClientAuthToken.updateMany({
      where: { clientId: client.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.barberClientAuthToken.create({
      data: { clientId: client.id, barbershopId, codeHash, expiresAt },
    }),
  ]);

  deliverPortalCode({ barbershopId, phone, code });
}

export type PortalVerifyResult =
  | { ok: true; clientId: string; name: string }
  | { ok: false };

/**
 * Valida el código. Devuelve el mismo `{ ok: false }` para TODO lo que
 * falla (no hay cliente, no hay código vivo, caducó, se quemó, no coincide):
 * el que prueba a ciegas no aprende nada de la respuesta.
 */
export async function verifyPortalCode(args: {
  barbershopId: string;
  phone: string;
  code: string;
}): Promise<PortalVerifyResult> {
  const { barbershopId, phone } = args;
  const code = String(args.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return { ok: false };

  const client = await prisma.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId, phone } },
    select: { id: true, name: true, portalEnabled: true, blockedAt: true },
  });
  if (!client || !client.portalEnabled || client.blockedAt) {
    await bcrypt.compare(code, DUMMY_HASH);
    return { ok: false };
  }

  const token = await prisma.barberClientAuthToken.findFirst({
    where: {
      clientId: client.id,
      // El barbershopId del token se compara aunque el cliente ya sea de
      // esta barbería: defensa en profundidad, cuesta nada.
      barbershopId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, attempts: true },
  });
  if (!token) {
    await bcrypt.compare(code, DUMMY_HASH);
    return { ok: false };
  }
  if (token.attempts >= PORTAL_CODE_MAX_ATTEMPTS) {
    await prisma.barberClientAuthToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });
    return { ok: false };
  }

  const match = await bcrypt.compare(code, token.codeHash);
  if (!match) {
    const attempts = token.attempts + 1;
    await prisma.barberClientAuthToken.update({
      where: { id: token.id },
      data: {
        attempts,
        // Al último intento el código se quema: no se queda vivo esperando.
        ...(attempts >= PORTAL_CODE_MAX_ATTEMPTS ? { usedAt: new Date() } : {}),
      },
    });
    return { ok: false };
  }

  // Un solo uso: se marca quemado en la MISMA operación que lo acepta.
  const burned = await prisma.barberClientAuthToken.updateMany({
    where: { id: token.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  // Si otro proceso lo quemó primero, este intento ya no vale.
  if (burned.count === 0) return { ok: false };

  await prisma.barberClient.update({
    where: { id: client.id },
    data: { lastPortalLoginAt: new Date() },
  });

  return { ok: true, clientId: client.id, name: client.name };
}

/** Hash de relleno para que el camino "no existe" cueste lo mismo que el bueno. */
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/**
 * La sesión viva PARA ESTA BARBERÍA. Devuelve null si la cookie es de otra
 * barbería — la comparación es el corazón del aislamiento entre tenants.
 */
export function getPortalSession(barbershopId: string): PortalSession | null {
  const raw = cookies().get(BARBER_PORTAL_COOKIE)?.value;
  const session = readPortalSession(raw);
  if (!session) return null;
  if (session.barbershopId !== barbershopId) return null;
  return session;
}


// ── Datos del cliente (lo que el portal pinta) ──────────────────────────

export interface PortalServiceLine {
  name: string;
  price: number;
}

export interface PortalPhotoDTO {
  id: string;
  url: string;
  kind: BarberPhotoKind;
  createdAt: string;
}

export interface PortalAppointmentDTO {
  id: string;
  startAt: string;
  endAt: string;
  status: BarberAppointmentStatus;
  barberName: string | null;
  services: PortalServiceLine[];
  total: number;
  /** Falso dentro de la ventana de cortesía o si el estado ya no lo permite. */
  canCancel: boolean;
  deposit: { amount: number; status: BarberDepositStatus } | null;
}

export interface PortalVisitDTO {
  id: string;
  startAt: string;
  barberName: string | null;
  services: PortalServiceLine[];
  total: number;
  photos: PortalPhotoDTO[];
}

export interface PortalPaymentDTO {
  id: string;
  createdAt: string;
  total: number;
  tip: number;
  paymentMethod: BarberPaymentMethod;
  items: { description: string; qty: number; unitPrice: number }[];
}

export interface PortalMembershipDTO {
  name: string;
  status: BarberClientMembershipStatus;
  startAt: string;
  endAt: string;
  includedCuts: number | null;
  cutsUsed: number;
  /** null = la membresía no limita cortes. */
  cutsLeft: number | null;
}

export interface PortalPayload {
  client: {
    name: string;
    phone: string;
    totalVisits: number;
    lastVisitAt: string | null;
    loyaltyCount: number;
    loyaltyGoal: number;
    freeCutReady: boolean;
  };
  upcoming: PortalAppointmentDTO[];
  history: PortalVisitDTO[];
  payments: PortalPaymentDTO[];
  gallery: PortalPhotoDTO[];
  membership: PortalMembershipDTO | null;
  policy: { cancelWindowHours: number };
}


/**
 * TODO lo que el portal muestra, en una sola llamada. Cada búsqueda filtra
 * por clientId Y barbershopId: no hay forma de que un id ajeno se cuele por
 * un where incompleto (en Prisma un undefined BORRA el filtro).
 *
 * AUDITORÍA DE SALIDA — este payload es la lista COMPLETA de lo que sale al
 * navegador del cliente. No hay tokens, ni ids de usuarios de la barbería
 * (soldByUserId, uploadedByUserId), ni notas internas de la cita, ni datos
 * de ningún otro cliente.
 */
export async function loadPortalData(args: {
  barbershopId: string;
  clientId: string;
  now?: Date;
}): Promise<PortalPayload | null> {
  const { barbershopId, clientId } = args;
  const now = args.now ?? new Date();

  const client = await prisma.barberClient.findFirst({
    where: { id: clientId, barbershopId },
    select: {
      name: true, phone: true, totalVisits: true, lastVisitAt: true,
      loyaltyCount: true, portalEnabled: true, blockedAt: true,
    },
  });
  if (!client || !client.portalEnabled || client.blockedAt) return null;

  const [appointments, sales, photos, membership] = await Promise.all([
    prisma.barberAppointment.findMany({
      where: { barbershopId, clientId },
      select: {
        id: true, startAt: true, endAt: true, status: true,
        depositAmount: true, depositStatus: true,
        barber: { select: { name: true, nickname: true } },
        services: { select: { priceAtBooking: true, service: { select: { name: true } } } },
      },
      orderBy: { startAt: "desc" },
      take: 60,
    }),
    prisma.barberSale.findMany({
      where: { barbershopId, clientId },
      select: {
        id: true, createdAt: true, total: true, tip: true, paymentMethod: true,
        items: { select: { description: true, qty: true, unitPrice: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    // SOLO las fotos que la barbería marcó visibles para el cliente.
    prisma.barberVisitPhoto.findMany({
      where: { barbershopId, clientId, visibleToClient: true },
      select: { id: true, url: true, kind: true, createdAt: true, appointmentId: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.barberClientMembership.findFirst({
      where: { barbershopId, clientId, status: { in: ["ACTIVE", "PAUSED"] } },
      select: {
        status: true, startAt: true, endAt: true, cutsUsed: true,
        membership: { select: { name: true, includedCuts: true } },
      },
      orderBy: { endAt: "desc" },
    }),
  ]);

  const signedByPhotoId = await signVisitPhotos(photos);

  const toLines = (
    rows: { priceAtBooking: unknown; service: { name: string } }[],
  ): PortalServiceLine[] =>
    rows.map((r) => ({ name: r.service.name, price: Number(r.priceAtBooking) }));

  const upcoming: PortalAppointmentDTO[] = [];
  const history: PortalVisitDTO[] = [];

  for (const a of appointments) {
    const services = toLines(a.services);
    const total = services.reduce((acc, s) => acc + s.price, 0);
    const barberName = a.barber ? a.barber.nickname || a.barber.name : null;

    const isFuture = a.startAt.getTime() > now.getTime();
    const isOpen = a.status === "PENDING" || a.status === "CONFIRMED" || a.status === "IN_PROGRESS";

    if (isFuture && isOpen) {
      upcoming.push({
        id: a.id,
        startAt: a.startAt.toISOString(),
        endAt: a.endAt.toISOString(),
        status: a.status as BarberAppointmentStatus,
        barberName,
        services,
        total,
        canCancel: canClientCancel(a.status as BarberAppointmentStatus, a.startAt, now),
        deposit:
          a.depositAmount !== null && a.depositStatus !== null
            ? { amount: Number(a.depositAmount), status: a.depositStatus as BarberDepositStatus }
            : null,
      });
      continue;
    }

    if (a.status === "DONE") {
      history.push({
        id: a.id,
        startAt: a.startAt.toISOString(),
        barberName,
        services,
        total,
        photos: photos
          .filter((p) => p.appointmentId === a.id && signedByPhotoId.has(p.id))
          .map((p) => ({
            id: p.id,
            url: signedByPhotoId.get(p.id) as string,
            kind: p.kind as BarberPhotoKind,
            createdAt: p.createdAt.toISOString(),
          })),
      });
    }
  }

  upcoming.sort((a, b) => a.startAt.localeCompare(b.startAt));

  // La galería suelta = las fotos visibles que NO cuelgan de una visita ya
  // mostrada. Se calcula sobre el historial RECORTADO para que ninguna foto
  // se quede sin sitio donde aparecer.
  const shownHistory = history.slice(0, 20);
  const attachedIds = new Set(shownHistory.flatMap((v) => v.photos.map((p) => p.id)));
  const gallery: PortalPhotoDTO[] = photos
    .filter((p) => !attachedIds.has(p.id) && signedByPhotoId.has(p.id))
    .map((p) => ({
      id: p.id,
      url: signedByPhotoId.get(p.id) as string,
      kind: p.kind as BarberPhotoKind,
      createdAt: p.createdAt.toISOString(),
    }));

  const cutsLeft =
    membership?.membership.includedCuts != null
      ? Math.max(0, membership.membership.includedCuts - membership.cutsUsed)
      : null;

  return {
    client: {
      name: client.name,
      phone: client.phone,
      totalVisits: client.totalVisits,
      lastVisitAt: client.lastVisitAt ? client.lastVisitAt.toISOString() : null,
      loyaltyCount: client.loyaltyCount,
      loyaltyGoal: BARBER_LOYALTY_GOAL,
      freeCutReady: client.loyaltyCount >= BARBER_LOYALTY_GOAL,
    },
    upcoming,
    history: shownHistory,
    payments: sales.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      total: Number(s.total),
      tip: Number(s.tip),
      paymentMethod: s.paymentMethod as BarberPaymentMethod,
      items: s.items.map((i) => ({
        description: i.description,
        qty: i.qty,
        unitPrice: Number(i.unitPrice),
      })),
    })),
    gallery,
    policy: { cancelWindowHours: BARBER_CANCEL_WINDOW_HOURS },
    membership: membership
      ? {
          name: membership.membership.name,
          status: membership.status as BarberClientMembershipStatus,
          startAt: membership.startAt.toISOString(),
          endAt: membership.endAt.toISOString(),
          includedCuts: membership.membership.includedCuts,
          cutsUsed: membership.cutsUsed,
          cutsLeft,
        }
      : null,
  };
}

// ── Fotos: URL pública tal cual, path del bucket firmado ────────────────

let cachedStorage: ReturnType<typeof createSupabaseAdmin> | null = null;
function storageAdmin() {
  if (cachedStorage) return cachedStorage;
  cachedStorage = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cachedStorage;
}

/**
 * BarberVisitPhoto.url puede traer una URL absoluta (bucket público) o un
 * path dentro de BARBER_FILES_BUCKET. Lo primero pasa tal cual; lo segundo
 * se firma con TTL corto. Falla SUAVE: una foto que no se pueda firmar
 * simplemente no se muestra — mejor una foto de menos que una pantalla rota.
 */
async function signVisitPhotos(
  rows: { id: string; url: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const toSign: { id: string; path: string }[] = [];
  for (const r of rows) {
    if (!r.url) continue;
    if (/^https?:\/\//i.test(r.url)) out.set(r.id, r.url);
    else toSign.push({ id: r.id, path: r.url.replace(/^\/+/, "") });
  }
  if (toSign.length === 0) return out;
  try {
    const { data, error } = await storageAdmin()
      .storage.from(BARBER_FILES_BUCKET)
      .createSignedUrls(toSign.map((t) => t.path), 300);
    if (error || !data) return out;
    data.forEach((row, i) => {
      const target = toSign[i];
      if (target && row.signedUrl && !row.error) out.set(target.id, row.signedUrl);
    });
  } catch {
    // Bucket inexistente o storage caído: se devuelven solo las públicas.
  }
  return out;
}

// ── Acciones del cliente sobre SUS citas ────────────────────────────────

export interface PortalActionOk {
  ok: true;
}
export interface PortalActionErr {
  ok: false;
  code: "notFound" | "tooLate" | "badStatus";
}
export type PortalActionResult = PortalActionOk | PortalActionErr;

/**
 * GUARDA DE TIPO — con strict:false (tsconfig del repo) TypeScript no
 * estrecha una union por un discriminante booleano, así que `if (!r.ok)`
 * no basta para poder leer `r.code`.
 */
export function isPortalActionError(r: PortalActionResult): r is PortalActionErr {
  return r.ok === false;
}

/**
 * Cancela una cita del cliente. La pertenencia NO se comprueba aparte: va
 * DENTRO del where del update (id + barbershopId + clientId), así que un id
 * ajeno simplemente no encuentra fila. Cero filas = 404, nunca un dato de
 * otro.
 */
export async function cancelPortalAppointment(args: {
  barbershopId: string;
  clientId: string;
  appointmentId: string;
  now?: Date;
}): Promise<PortalActionResult> {
  const now = args.now ?? new Date();
  const appointment = await prisma.barberAppointment.findFirst({
    where: {
      id: args.appointmentId,
      barbershopId: args.barbershopId,
      clientId: args.clientId,
    },
    select: { id: true, status: true, startAt: true },
  });
  if (!appointment) return { ok: false, code: "notFound" };

  const status = appointment.status as BarberAppointmentStatus;
  if (!canTransition(status, "CANCELLED")) return { ok: false, code: "badStatus" };
  if (!canClientCancel(status, appointment.startAt, now)) return { ok: false, code: "tooLate" };

  const res = await prisma.barberAppointment.updateMany({
    where: {
      id: appointment.id,
      barbershopId: args.barbershopId,
      clientId: args.clientId,
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    data: { status: "CANCELLED" },
  });
  if (res.count === 0) return { ok: false, code: "badStatus" };
  return { ok: true };
}

/**
 * "Quiero cambiar mi hora": deja la petición ANOTADA en la cita para que la
 * barbería la vea en su agenda. NO mueve la cita ni cambia su estado — quién
 * y cuándo se reagenda lo decide la barbería (la agenda es de T1). La
 * pantalla ofrece además abrir WhatsApp, que es como se resuelve de verdad.
 */
export async function requestPortalReschedule(args: {
  barbershopId: string;
  clientId: string;
  appointmentId: string;
  message: string | null;
  now?: Date;
}): Promise<PortalActionResult> {
  const now = args.now ?? new Date();
  const appointment = await prisma.barberAppointment.findFirst({
    where: {
      id: args.appointmentId,
      barbershopId: args.barbershopId,
      clientId: args.clientId,
    },
    select: { id: true, status: true, notes: true },
  });
  if (!appointment) return { ok: false, code: "notFound" };
  if (appointment.status !== "PENDING" && appointment.status !== "CONFIRMED") {
    return { ok: false, code: "badStatus" };
  }

  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const extra = (args.message ?? "").trim().slice(0, 240);
  const line = `[${stamp}] El cliente pidió reagendar${extra ? `: ${extra}` : "."}`;
  const notes = appointment.notes ? `${appointment.notes}\n${line}` : line;

  await prisma.barberAppointment.updateMany({
    where: {
      id: appointment.id,
      barbershopId: args.barbershopId,
      clientId: args.clientId,
    },
    data: { notes: notes.slice(-4000) },
  });
  return { ok: true };
}
