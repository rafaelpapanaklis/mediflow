import "server-only";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { isRealtySubscriptionActive } from "@/lib/realty/plan-shared";
import { REALTY_FILES_BUCKET } from "@/lib/realty/types";
import type {
  RealtyChargeStatus,
  RealtyCurrency,
  RealtyDepositStatus,
  RealtyExpenseKind,
  RealtyLeaseStatus,
  RealtyMaintenanceStatus,
  RealtyPaymentMethod,
  RealtyPropertyStatus,
} from "@/lib/realty/types";
import {
  PORTAL_CODE_MAX_ATTEMPTS,
  PORTAL_CODE_MAX_PER_WINDOW,
  PORTAL_CODE_TTL_MIN,
  PORTAL_CODE_WINDOW_MIN,
  PORTAL_ISSUE_MAX_OPEN,
  REALTY_PORTAL_COOKIE,
  buildOwnerStatement,
  isChargeOpen,
  monthRange,
  pickPortalAccount,
  portalOriginMismatch,
  readPortalSession,
  sumMoney,
  type OwnerStatement,
  type PortalAccountDTO,
  type RealtyPortalRole,
  type RealtyPortalSession,
} from "@/lib/realty/portal-core";

/**
 * El núcleo PURO del portal (constantes, firma de la sesión, aritmética de
 * dinero y fechas, armado del corte del propietario) vive en ./portal-core
 * y se re-exporta desde aquí: los consumidores importan de un solo sitio y
 * las pruebas pueden cargar el núcleo sin arrastrar prisma ni next/headers.
 */
export * from "@/lib/realty/portal-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — PORTAL DEL CLIENTE FINAL (/i/portal).

   Un inquilino no tiene usuario del panel, ni contraseña, ni ganas de
   inventarse una. Entra con su WhatsApp y un código de seis dígitos, desde
   la calle, con una liga que le llegó por mensaje.

   LO QUE ESTE MÓDULO GARANTIZA
   ────────────────────────────────────────────────────────────────────────
   1. El código NUNCA se guarda ni se registra en claro: en
      RealtyClientAuthToken.codeHash va un hash bcrypt. Un volcado de la
      tabla no revela un solo código.
   2. Caduca (10 min), es de UN SOLO uso y tiene tope de intentos (5). Al
      quinto fallo se quema; no se queda vivo esperando al bot.
   3. ENUMERACIÓN DE TELÉFONOS: la respuesta de "mándame el código" es
      idéntica exista o no la persona — mismo texto, mismo status y el mismo
      costo de CPU (se hashea un valor falso cuando no hay a quién mandarle).
      Sin esto, cualquiera podría preguntarle al portal quién es inquilino
      de quién probando números uno por uno.
   4. La sesión del portal es PROPIA: cookie httpOnly firmada (dcr_portal),
      sin relación con la sesión Supabase del panel, con la del dental ni
      con la de barbería.
   5. 🔴 EL PORTAL NO ABRE NINGUNA PUERTA AL PANEL. Quien entra aquí no
      tiene sesión de Supabase, así que getRealtyContext() —el punto único
      del panel— le devuelve null y /inmobiliaria lo manda al login. No es
      una lista negra que alguien pueda olvidar actualizar: es que la cookie
      del portal es literalmente invisible para @supabase/ssr.
   6. 🔴 TODA consulta se acota por accountId Y por el conjunto de contratos
      o inmuebles que se derivan del TELÉFONO VERIFICADO. Ningún id que
      venga de la URL o del cuerpo se usa sin comprobar antes que pertenece
      a ese conjunto.

   LAS DOS CARAS
   ────────────────────────────────────────────────────────────────────────
   El mismo teléfono puede ser INQUILINO de una inmobiliaria y PROPIETARIO
   de otra (o de la misma). Tras validar el código se le pregunta con cuál
   entrar, y la sesión guarda esa elección. Las dos experiencias no se
   cruzan NUNCA:

     · El inquilino ve su contrato, sus pagos, su adeudo y sus fallas.
       No ve gastos, ni rentabilidad, ni a otros inquilinos.
     · El propietario ve sus inmuebles, su corte del mes y los
       mantenimientos. Del inquilino ve el NOMBRE con el que firmó y nada
       más: ni su teléfono, ni su correo, ni su investigación de solvencia.

   FRONTERAS
   ────────────────────────────────────────────────────────────────────────
   · El WhatsApp lo manda T6. Aquí está el stub tipado (deliverPortalCode)
     con la firma exacta que T6 tiene que ofrecer.
   · El módulo de mantenimiento del panel es de T4: aquí solo se CREAN
     incidencias desde el inquilino y se LEEN.
   ═══════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════
// 1. IDENTIDADES DEL TELÉFONO
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyPortalIdentity {
  /** `${role}:${accountId}` — ver portalIdentityKey en portal-core. */
  key: string;
  role: RealtyPortalRole;
  accountId: string;
  /** Nombre con el que está capturada la persona en ESA cuenta. */
  personName: string;
  account: PortalAccountDTO;
  /** Contratos (inquilino) o inmuebles (propietario). Para la pantalla de elegir. */
  count: number;
}

/** Estados de contrato que dan acceso al portal. BORRADOR no: un contrato
 *  en borrador todavía no es una relación con nadie. */
const LEASE_STATUSES_WITH_PORTAL: RealtyLeaseStatus[] = ["ACTIVO", "VENCIDO", "TERMINADO"];

interface PhoneMatchRow {
  role: string;
  accountId: string;
  subjectId: string;
  personName: string;
}

/**
 * Filas de RealtyContact y RealtyPropertyOwner cuyo teléfono, NORMALIZADO,
 * coincide con los 10 dígitos verificados.
 *
 * ⚠️ ENVUELTO EN `cache()` DE REACT. Pintar una pantalla del portal lo
 * pediría TRES veces —el guard del layout, la página y la comprobación de
 * "¿tiene más de una cara?"— y esta consulta NO puede usar índice: el
 * `CASE` de abajo es una expresión, así que Postgres recorre las dos tablas
 * enteras. Con `cache()` se ejecuta UNA vez por petición. El índice de
 * expresión que la volvería barata está en `sql/realty-portal.sql`, sin
 * aplicar todavía.
 *
 * 🔴 POR QUÉ SQL CRUDO Y NO UN `where` DE PRISMA. RealtyContact.phone SÍ
 * está documentado como "normalizado a 10 dígitos", pero
 * RealtyPropertyOwner.phone NO lo está — ahí el dueño se captura a mano y
 * llega como "33 1234 5678", "+52 33…" o con guiones. Una igualdad simple
 * dejaría FUERA de su propio portal a media lista de propietarios, y un
 * `contains` sobre un teléfono sin normalizar no compara nada útil.
 * `right(regexp_replace(...))` normaliza en el motor y compara exacto:
 *   "+52 1 55 1234 5678" → "5215512345678" → right(…,10) = "5512345678"
 *
 * Es un SELECT parametrizado sobre dos tablas del propio vertical. No
 * inventa columnas ni toca DDL.
 */
const matchPhoneRows = cache(async function matchPhoneRows(
  phone: string,
): Promise<PhoneMatchRow[]> {
  // 🔴 ESTO ES mxTenDigits, LETRA POR LETRA, EN SQL. Un `right(digitos, 10)`
  // a secas es MÁS LAXO que la regla del repo: se queda con los últimos diez
  // dígitos de cualquier cadena, así que un propietario capturado como
  // "+1 555 123 4567" (11 dígitos) colisionaría con el mexicano 5551234567
  // que verifica por WhatsApp — y la colisión cruza cuentas, porque esta
  // consulta todavía no sabe de qué cuenta se trata. Aquí solo pasan las
  // tres formas que mxTenDigits acepta: 10 dígitos, 12 empezando en 52, o
  // 13 empezando en 521.
  return prisma.$queryRaw<PhoneMatchRow[]>`
    WITH mx AS (
      SELECT 'INQUILINO' AS "role", c."accountId", c."id", c."name",
             regexp_replace(coalesce(c."phone", ''), '[^0-9]', '', 'g') AS d
        FROM "realty_contacts" c
      UNION ALL
      SELECT 'PROPIETARIO', o."accountId", o."id", o."name",
             regexp_replace(coalesce(o."phone", ''), '[^0-9]', '', 'g')
        FROM "realty_property_owners" o
    )
    SELECT "role",
           "accountId" AS "accountId",
           "id"        AS "subjectId",
           "name"      AS "personName"
      FROM mx
     WHERE CASE
             WHEN length(d) = 13 AND left(d, 3) = '521' THEN right(d, 10)
             WHEN length(d) = 12 AND left(d, 2) = '52'  THEN right(d, 10)
             WHEN length(d) = 10                        THEN d
             ELSE NULL
           END = ${phone}
  `;
});

/** Cuentas que pueden servir portal: vivas y con la suscripción al día. */
async function loadOpenAccounts(accountIds: string[]): Promise<Map<string, PortalAccountDTO>> {
  const out = new Map<string, PortalAccountDTO>();
  if (accountIds.length === 0) return out;
  const rows = await prisma.realtyAccount.findMany({
    where: { id: { in: accountIds }, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      city: true,
      state: true,
      timezone: true,
      logoUrl: true,
      // Solo para decidir la puerta. NO salen del servidor: el recorte lo
      // hace la lista blanca, no un destructuring que se pueda olvidar de
      // un campo nuevo.
      subscriptionStatus: true,
    },
  });
  for (const row of rows) {
    if (!isRealtySubscriptionActive(row)) continue;
    out.set(row.id, pickPortalAccount(row as unknown as Record<string, unknown>));
  }
  return out;
}

/**
 * Las caras con las que ESE teléfono puede entrar. Se recalcula en CADA
 * petición (ver el encabezado de portal-core): el día que la persona deja
 * de ser inquilina, la lista se queda vacía y el portal se le cierra solo.
 */
export async function resolvePortalIdentities(phone: string): Promise<RealtyPortalIdentity[]> {
  if (!/^\d{10}$/.test(phone)) return [];

  const matches = await matchPhoneRows(phone).catch((err) => {
    console.error("[realty/portal] no se pudo resolver el teléfono:", err);
    return [] as PhoneMatchRow[];
  });
  if (matches.length === 0) return [];

  const contactIds = matches.filter((m) => m.role === "INQUILINO").map((m) => m.subjectId);
  const ownerIds = matches.filter((m) => m.role === "PROPIETARIO").map((m) => m.subjectId);

  const [parties, properties] = await Promise.all([
    contactIds.length
      ? prisma.realtyLeaseParty.findMany({
          where: {
            contactId: { in: contactIds },
            role: "INQUILINO",
            lease: { status: { in: LEASE_STATUSES_WITH_PORTAL } },
          },
          select: { accountId: true, leaseId: true },
        })
      : Promise.resolve([] as Array<{ accountId: string; leaseId: string }>),
    ownerIds.length
      ? prisma.realtyProperty.findMany({
          where: { ownerId: { in: ownerIds } },
          select: { accountId: true, id: true },
        })
      : Promise.resolve([] as Array<{ accountId: string; id: string }>),
  ]);

  const tenantLeases = new Map<string, Set<string>>();
  for (const p of parties) {
    let set = tenantLeases.get(p.accountId);
    if (!set) tenantLeases.set(p.accountId, (set = new Set()));
    set.add(p.leaseId);
  }
  const ownerProps = new Map<string, Set<string>>();
  for (const p of properties) {
    let set = ownerProps.get(p.accountId);
    if (!set) ownerProps.set(p.accountId, (set = new Set()));
    set.add(p.id);
  }

  // Array.from / forEach y NO spread del iterador: el tsconfig del repo no
  // fija `target`, así que `[...map.keys()]` saca TS2802 en `tsc --noEmit`.
  const conRelacion = new Set<string>();
  tenantLeases.forEach((_v, k) => conRelacion.add(k));
  ownerProps.forEach((_v, k) => conRelacion.add(k));
  const accounts = await loadOpenAccounts(Array.from(conRelacion));

  // El nombre: el de la primera fila de esa cuenta y ese papel.
  const nameOf = (role: string, accountId: string) =>
    matches.find((m) => m.role === role && m.accountId === accountId)?.personName ?? "";

  const out: RealtyPortalIdentity[] = [];
  for (const [accountId, leases] of Array.from(tenantLeases.entries())) {
    const account = accounts.get(accountId);
    if (!account || leases.size === 0) continue;
    out.push({
      key: `INQUILINO:${accountId}`,
      role: "INQUILINO",
      accountId,
      personName: nameOf("INQUILINO", accountId),
      account,
      count: leases.size,
    });
  }
  for (const [accountId, props] of Array.from(ownerProps.entries())) {
    const account = accounts.get(accountId);
    if (!account || props.size === 0) continue;
    out.push({
      key: `PROPIETARIO:${accountId}`,
      role: "PROPIETARIO",
      accountId,
      personName: nameOf("PROPIETARIO", accountId),
      account,
      count: props.size,
    });
  }

  // Orden estable: primero inquilino (es la cara más urgente — ahí está el
  // adeudo), luego por nombre de la inmobiliaria.
  return out.sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === "INQUILINO" ? -1 : 1) ||
      a.account.name.localeCompare(b.account.name, "es-MX"),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 2. EL CÓDIGO DE UN SOLO USO
// ═══════════════════════════════════════════════════════════════════════

/** 6 dígitos con randomInt (CSPRNG), ceros a la izquierda incluidos. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Hash de relleno: el camino "no existe" cuesta lo mismo que el bueno. */
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/**
 * 🔴 STUB TIPADO — EL ENVÍO ES DE T6.
 *
 * Firma EXACTA que T9 espera encontrar cuando T6 construya el WhatsApp del
 * vertical (previsiblemente en src/lib/realty/whatsapp.ts):
 *
 *   export async function sendRealtyPortalCode(args: {
 *     accountId: string;  // desde cuyo WhatsApp sale el mensaje
 *     phone: string;      // 10 dígitos YA normalizados (mxTenDigits)
 *     code: string;       // 6 dígitos en claro, solo en memoria
 *   }): Promise<boolean>; // true si Meta lo aceptó
 *
 * Requisitos del mensaje (los impone Meta, no nosotros):
 *   · Plantilla de categoría AUTHENTICATION — es lo único que Meta permite
 *     para un código de un solo uso, y llega con botón de "copiar código".
 *   · Se manda EN EL MOMENTO, no por la cola: un código que llega dentro de
 *     un minuto ya no sirve para entrar.
 *   · El código NO se guarda en el hilo: la fila de RealtyMessage lleva un
 *     cuerpo neutro. Un código en la base es un código filtrado.
 *
 * PARA CONECTARLO, T6 CAMBIA UNA SOLA LÍNEA DE ESTE ARCHIVO: descomentar
 * el import dinámico de abajo. Está comentado porque un import estático a
 * un módulo que todavía no existe rompe el BUILD entero del repo.
 */
export type RealtyPortalCodeSender = (args: {
  accountId: string;
  phone: string;
  code: string;
}) => Promise<boolean>;

async function deliverPortalCode(args: {
  accountId: string;
  phone: string;
  code: string;
}): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    // Para poder probar el portal sin WhatsApp conectado. En producción no
    // se escribe NADA: un código en los logs es un código filtrado.
    console.info(
      `[realty/portal] código de acceso para ${args.phone} (cuenta ${args.accountId}): ${args.code}`,
    );
  }
  try {
    // ── T6: CONECTADO ────────────────────────────────────────────────
    // El import es DINÁMICO a propósito, tal y como lo dejó escrito T9: así
    // este módulo no arrastra el de WhatsApp (ni Prisma de más) en rutas que
    // no mandan nada, y un fallo al cargarlo cae en el catch de abajo sin
    // tumbar la emisión del código.
    const { sendRealtyPortalCode } = await import("@/lib/realty/whatsapp");
    await sendRealtyPortalCode(args);
    // ─────────────────────────────────────────────────────────────────
  } catch (err) {
    // Sin WhatsApp (o con Meta caído) el código YA está emitido y sigue
    // siendo válido: la persona puede pedir otro. JAMÁS propagar — la
    // función de arriba es `void` a propósito para no filtrar si el
    // teléfono existe, y una excepción aquí rompería esa garantía.
    console.error(`[realty/portal] no se pudo enviar el código (${args.accountId}):`, err);
  }
}

/**
 * Emite un código para el teléfono dado. NO dice si la persona existe: es
 * `void` a propósito, para que ninguna ruta pueda filtrar esa señal por
 * accidente.
 *
 * Un teléfono puede ser inquilino en la cuenta A y propietario en la B. Se
 * emite UN SOLO código y se guarda una fila por cuenta con el MISMO hash:
 * así la persona recibe un mensaje, no tres, y al verificar entra a
 * cualquiera de sus caras.
 *
 * Cualquier código anterior de ese teléfono se quema: solo hay uno vivo.
 */
export async function requestPortalCode(phone: string): Promise<void> {
  const identities = await resolvePortalIdentities(phone);
  const accountIds = Array.from(new Set(identities.map((i) => i.accountId)));

  if (accountIds.length === 0) {
    // Nadie a quien mandarle. Se hace el MISMO trabajo de CPU para que el
    // tiempo de respuesta no delate quién está dado de alta.
    await bcrypt.hash(generateCode(), 10);
    return;
  }

  // Tope de reenvíos POR TELÉFONO (no por cuenta): pedir tres códigos en
  // quince minutos ya es raro, y contarlo por cuenta multiplicaría el tope
  // por el número de inmobiliarias que conozcan ese número.
  const windowStart = new Date(Date.now() - PORTAL_CODE_WINDOW_MIN * 60_000);
  // `accountId in [...]` va PRIMERO a propósito: el único índice de la tabla
  // es (accountId, phone, expiresAt), así que un where solo por teléfono
  // barre la tabla entera. Aquí ya conocemos las cuentas, así que sale gratis.
  const recent = await prisma.realtyClientAuthToken.count({
    where: { accountId: { in: accountIds }, phone, createdAt: { gte: windowStart } },
  });
  if (recent >= PORTAL_CODE_MAX_PER_WINDOW * accountIds.length) {
    await bcrypt.hash(generateCode(), 10);
    return;
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + PORTAL_CODE_TTL_MIN * 60_000);

  await prisma.$transaction([
    // Barrido: nada retiene un código muerto de hace una semana, y dejarlos
    // acumularse encarece para siempre las búsquedas por teléfono de
    // verifyPortalCode (que NO puede usar el índice, porque en ese momento
    // todavía no sabe de qué cuentas se trata).
    prisma.realtyClientAuthToken.deleteMany({
      where: {
        accountId: { in: accountIds },
        phone,
        expiresAt: { lt: new Date(Date.now() - 86_400_000) },
      },
    }),
    // Un código nuevo invalida el anterior: nunca hay dos vivos.
    prisma.realtyClientAuthToken.updateMany({
      where: { phone, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.realtyClientAuthToken.createMany({
      data: accountIds.map((accountId) => ({ accountId, phone, codeHash, expiresAt })),
    }),
  ]);

  // UN mensaje. Se manda desde la primera cuenta (la que la pantalla de
  // elegir enseñará primero); el código sirve para todas sus caras.
  await deliverPortalCode({ accountId: accountIds[0], phone, code });
}

export type PortalVerifyResult =
  | { ok: true; identities: RealtyPortalIdentity[] }
  | { ok: false };

/**
 * Valida el código. Devuelve el MISMO `{ ok: false }` para todo lo que
 * falla (no hay tokens, caducó, se quemó, no coincide): quien prueba a
 * ciegas no aprende nada de la respuesta.
 */
export async function verifyPortalCode(phone: string, rawCode: string): Promise<PortalVerifyResult> {
  const code = String(rawCode ?? "").trim();
  if (!/^\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) {
    await bcrypt.compare("000000", DUMMY_HASH);
    return { ok: false };
  }

  const tokens = await prisma.realtyClientAuthToken.findMany({
    where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, attempts: true, createdAt: true },
  });
  if (tokens.length === 0) {
    await bcrypt.compare(code, DUMMY_HASH);
    return { ok: false };
  }

  // Todas las filas vivas de un teléfono son del MISMO envío y comparten
  // hash. Se compara una vez y se actúa sobre el lote entero: si no, un
  // fallo gastaría un intento en una cuenta y dejaría las otras intactas.
  const ids = tokens.map((t) => t.id);

  // 🔴 EL INTENTO SE RESERVA ANTES DE COMPARAR, Y CON UN INCREMENTO ATÓMICO.
  //
  // Leer `attempts`, sumarle uno en memoria y ASIGNAR el resultado es un
  // lost update de manual: quinientas peticiones simultáneas leen 0, las
  // quinientas escriben 1, y el tope de cinco no se agota NUNCA. Se
  // adivinarían quinientos códigos gastando un solo intento, y failbanGuard
  // no salva porque se consulta al principio del handler: en una ráfaga
  // simultánea ninguna petición ve el candado que las otras escriben.
  //
  // Con el `where` condicional + `increment`, el UPDATE es una sola
  // sentencia: Postgres serializa el bloqueo de fila y, en cuanto attempts
  // llega a cinco, el where deja de casar y count vuelve 0.
  const reservado = await prisma.realtyClientAuthToken.updateMany({
    where: { id: { in: ids }, usedAt: null, attempts: { lt: PORTAL_CODE_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reservado.count === 0) {
    // Se agotaron los intentos (o alguien lo quemó entretanto): se quema del
    // todo, no se queda vivo esperando al siguiente bot.
    await prisma.realtyClientAuthToken.updateMany({
      where: { id: { in: ids } },
      data: { usedAt: new Date() },
    });
    await bcrypt.compare(code, DUMMY_HASH);
    return { ok: false };
  }

  const match = await bcrypt.compare(code, tokens[0].codeHash);
  if (!match) {
    // Al último intento el código se quema. El `gte` lo decide la BASE con
    // el valor ya incrementado, no una cuenta que hicimos en memoria.
    await prisma.realtyClientAuthToken.updateMany({
      where: { id: { in: ids }, attempts: { gte: PORTAL_CODE_MAX_ATTEMPTS } },
      data: { usedAt: new Date() },
    });
    return { ok: false };
  }

  // Un solo uso: se marca quemado en la MISMA operación que lo acepta.
  const burned = await prisma.realtyClientAuthToken.updateMany({
    where: { id: { in: ids }, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burned.count === 0) return { ok: false }; // otro proceso llegó primero

  // Se vuelven a resolver DESPUÉS de acertar: la lista que vale es la de
  // ahora, no la del momento en que se pidió el código.
  const identities = await resolvePortalIdentities(phone);
  if (identities.length === 0) return { ok: false };
  return { ok: true, identities };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. SESIÓN Y ALCANCE
// ═══════════════════════════════════════════════════════════════════════

/** La cookie, leída y verificada. NO comprueba nada contra la base. */
export function getPortalSession(): RealtyPortalSession | null {
  return readPortalSession(cookies().get(REALTY_PORTAL_COOKIE)?.value);
}

export interface PortalTenantScope {
  role: "INQUILINO";
  phone: string;
  accountId: string;
  account: PortalAccountDTO;
  personName: string;
  /** Filas de contacto de esa persona en esa cuenta (pueden ser varias). */
  contactIds: string[];
  /** 🔴 EL CERCO. Toda consulta del inquilino se acota a estos contratos. */
  leaseIds: string[];
}

export interface PortalOwnerScope {
  role: "PROPIETARIO";
  phone: string;
  accountId: string;
  account: PortalAccountDTO;
  personName: string;
  ownerIds: string[];
  /** 🔴 EL CERCO. Toda consulta del propietario se acota a estos inmuebles. */
  propertyIds: string[];
}

export type PortalScope = PortalTenantScope | PortalOwnerScope;

/**
 * El alcance REAL de quien entró: la cuenta, la persona y el conjunto de
 * contratos o inmuebles que puede ver.
 *
 * 🔴 ESTE ES EL PUNTO ÚNICO. Ninguna página ni ningún endpoint del portal
 * inventa su propio filtro: piden el alcance aquí y meten `accountId` y el
 * conjunto de ids en el `where`. Un id que llegue por la URL se COMPARA
 * contra el conjunto, nunca se consulta a secas.
 *
 * Devuelve null si: no hay cookie, la cookie no está firmada, caducó, no
 * eligió cara todavía, la inmobiliaria se dio de baja, o la relación
 * (contrato / inmueble) ya no existe.
 */
export async function getPortalScope(): Promise<PortalScope | null> {
  const session = getPortalSession();
  if (!session || !session.role || !session.accountId) return null;
  return resolveScope(session.phone, session.role, session.accountId);
}

async function resolveScope(
  phone: string,
  role: RealtyPortalRole,
  accountId: string,
): Promise<PortalScope | null> {
  const matches = await matchPhoneRows(phone).catch(() => [] as PhoneMatchRow[]);
  const mine = matches.filter((m) => m.role === role && m.accountId === accountId);
  if (mine.length === 0) return null;

  const accounts = await loadOpenAccounts([accountId]);
  const account = accounts.get(accountId);
  if (!account) return null;

  const personName = mine[0].personName;
  const subjectIds = Array.from(new Set(mine.map((m) => m.subjectId)));

  if (role === "INQUILINO") {
    const parties = await prisma.realtyLeaseParty.findMany({
      // accountId ADEMÁS de contactId: la columna está denormalizada justo
      // para poder acotar la hija por el tenant en un solo where.
      where: {
        accountId,
        contactId: { in: subjectIds },
        role: "INQUILINO",
        lease: { status: { in: LEASE_STATUSES_WITH_PORTAL } },
      },
      select: { leaseId: true },
    });
    const leaseIds = Array.from(new Set(parties.map((p) => p.leaseId)));
    if (leaseIds.length === 0) return null;
    return {
      role: "INQUILINO",
      phone,
      accountId,
      account,
      personName,
      contactIds: subjectIds,
      leaseIds,
    };
  }

  const properties = await prisma.realtyProperty.findMany({
    where: { accountId, ownerId: { in: subjectIds } },
    select: { id: true },
  });
  const propertyIds = properties.map((p) => p.id);
  if (propertyIds.length === 0) return null;
  return {
    role: "PROPIETARIO",
    phone,
    accountId,
    account,
    personName,
    ownerIds: subjectIds,
    propertyIds,
  };
}

/** El alcance, solo si es de inquilino. */
export async function getTenantScope(): Promise<PortalTenantScope | null> {
  const scope = await getPortalScope();
  return scope && scope.role === "INQUILINO" ? scope : null;
}

/** El alcance, solo si es de propietario. */
export async function getOwnerScope(): Promise<PortalOwnerScope | null> {
  const scope = await getPortalScope();
  return scope && scope.role === "PROPIETARIO" ? scope : null;
}

/** 401 estándar del portal. Mismo texto siempre. */
export function portalUnauthorized(): NextResponse {
  return NextResponse.json({ error: "Vuelve a entrar con tu WhatsApp." }, { status: 401 });
}

/**
 * CSRF de las mutaciones del portal. El middleware solo comprueba el
 * origen en /api/admin/*; aquí se hace explícito. La cookie ya es
 * `sameSite: lax` (que frena el POST entre sitios), esto es la segunda
 * cerradura.
 */
export function portalCsrfBlocked(req: NextRequest): NextResponse | null {
  const mismatch = portalOriginMismatch({
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    host: req.headers.get("host"),
  });
  return mismatch ? NextResponse.json({ error: "Petición no válida." }, { status: 403 }) : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 4. ARCHIVOS (bucket privado realty-files)
// ═══════════════════════════════════════════════════════════════════════

let cachedAdmin: ReturnType<typeof createSupabaseAdmin> | null = null;
function storageAdmin() {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  return cachedAdmin;
}

/**
 * Helpers PROPIOS del portal y no los de src/lib/storage.ts porque el
 * union `BucketName` de aquel archivo solo conoce patient-files y
 * clinic-public: "realty-files" no compila ahí, y ese archivo no es de
 * esta terminal.
 */
const SIGNED_TTL_SECONDS = 300;

/** Extrae el path interno del bucket de una URL de Supabase o lo deja tal cual. */
function storagePath(urlOrPath: string): string | null {
  if (!urlOrPath) return null;
  if (!urlOrPath.startsWith("http")) return urlOrPath;
  try {
    const u = new URL(urlOrPath);
    const marker = "/storage/v1/object/";
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) return null;
    const parts = u.pathname.slice(idx + marker.length).split("/");
    if (parts.length < 3 || parts[1] !== REALTY_FILES_BUCKET) return null;
    return decodeURIComponent(parts.slice(2).join("/").split("?")[0]);
  } catch {
    return null;
  }
}

/**
 * Firma una URL del bucket privado.
 *
 * 🔴 DEVUELVE null SI EL VALOR NO ES DE NUESTRO BUCKET, y no la URL tal
 * cual. Es deliberado: quien llama a esto redirige (302) a lo que devuelva,
 * así que reenviar una URL arbitraria convertiría /api/realty/portal/archivo
 * en un redirector abierto AUTENTICADO — lo escribiría el panel de la
 * inmobiliaria, no un extraño, pero un redirector abierto es un redirector
 * abierto. Un contrato colgado fuera (Drive, Dropbox) simplemente no se
 * sirve desde el portal.
 */
export async function signPortalFile(urlOrPath: string | null | undefined): Promise<string | null> {
  if (!urlOrPath) return null;
  const path = storagePath(urlOrPath);
  if (!path) return null;
  try {
    const { data, error } = await storageAdmin()
      .storage.from(REALTY_FILES_BUCKET)
      .createSignedUrl(path, SIGNED_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Sube una foto de la falla al bucket privado. Lanza si Supabase falla. */
export async function uploadPortalPhoto(
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await storageAdmin()
    .storage.from(REALTY_FILES_BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(`No se pudo subir ${path}: ${error.message}`);
}

/**
 * Borra fotos que se subieron para un reporte que al final NO se creó. Sin
 * esto, cada reporte fallido deja megas en el bucket que nadie contabiliza
 * ni recoge. Best-effort: si el borrado falla, el reporte igual se rechazó.
 */
export async function removePortalPhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await storageAdmin().storage.from(REALTY_FILES_BUCKET).remove(paths);
  } catch (err) {
    console.error("[realty/portal] no se pudieron borrar fotos huérfanas:", err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5. LO QUE VE EL INQUILINO
// ═══════════════════════════════════════════════════════════════════════

export interface PortalLeaseDTO {
  id: string;
  status: RealtyLeaseStatus;
  startsAt: string;
  endsAt: string;
  rentAmount: number;
  currency: RealtyCurrency;
  paymentDay: number;
  depositAmount: number;
  /** Firmado; se entrega SIEMPRE como liga firmada de 5 minutos. */
  hasSignedDoc: boolean;
  propertyTitle: string;
  propertyAddress: string | null;
  /** Depósito en garantía, si está registrado. */
  deposit: { amount: number; status: RealtyDepositStatus } | null;
}

export interface PortalChargeDTO {
  id: string;
  leaseId: string;
  periodMonth: string;
  dueAt: string;
  amount: number;
  paid: number;
  status: RealtyChargeStatus;
}

export interface PortalReceiptDTO {
  id: string;
  chargeId: string | null;
  leaseId: string | null;
  periodMonth: string | null;
  amount: number;
  method: RealtyPaymentMethod;
  paidAt: string;
  reference: string | null;
}

export interface PortalTenantData {
  leases: PortalLeaseDTO[];
  charges: PortalChargeDTO[];
  receipts: PortalReceiptDTO[];
  /** Lo que falta por pagar sumando TODOS los cargos abiertos. */
  saldo: number;
  currency: RealtyCurrency;
}

/**
 * Todo lo del inquilino en tres consultas acotadas.
 *
 * 🔴 Cada `where` lleva `accountId` Y `leaseId in scope.leaseIds`. Los dos.
 * El accountId aísla el tenant; la lista de contratos aísla a la persona
 * dentro de ese tenant.
 */
export async function loadTenantData(scope: PortalTenantScope): Promise<PortalTenantData> {
  const where = { accountId: scope.accountId, leaseId: { in: scope.leaseIds } };

  const [leases, charges, payments, deposits] = await Promise.all([
    prisma.realtyLease.findMany({
      where: { accountId: scope.accountId, id: { in: scope.leaseIds } },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        rentAmount: true,
        currency: true,
        paymentDay: true,
        depositAmount: true,
        signedDocUrl: true,
        property: { select: { title: true, address: true, colonia: true, city: true } },
      },
      orderBy: [{ status: "asc" }, { endsAt: "desc" }],
    }),
    prisma.realtyRentCharge.findMany({
      where,
      select: {
        id: true,
        leaseId: true,
        periodMonth: true,
        dueAt: true,
        amount: true,
        status: true,
      },
      orderBy: { dueAt: "desc" },
      take: 60,
    }),
    prisma.realtyPayment.findMany({
      where: {
        accountId: scope.accountId,
        // Un pago del inquilino cuelga de su CARGO (renta) o directamente
        // de su CONTRATO (depósito, penalización). Nunca de un dealId: esa
        // es la comisión de la inmobiliaria y no es asunto suyo.
        OR: [{ leaseId: { in: scope.leaseIds } }, { charge: { leaseId: { in: scope.leaseIds } } }],
      },
      select: {
        id: true,
        chargeId: true,
        leaseId: true,
        amount: true,
        method: true,
        paidAt: true,
        reference: true,
        charge: { select: { periodMonth: true } },
      },
      orderBy: { paidAt: "desc" },
      take: 120,
    }),
    prisma.realtyDeposit.findMany({
      where,
      select: { leaseId: true, amount: true, status: true },
    }),
  ]);

  const depositByLease = new Map(
    deposits.map((d) => [d.leaseId, { amount: Number(d.amount), status: d.status as RealtyDepositStatus }]),
  );

  const paidByCharge = new Map<string, number[]>();
  for (const p of payments) {
    if (!p.chargeId) continue;
    const list = paidByCharge.get(p.chargeId) ?? [];
    list.push(Number(p.amount));
    paidByCharge.set(p.chargeId, list);
  }

  const chargeDTOs: PortalChargeDTO[] = charges.map((c) => ({
    id: c.id,
    leaseId: c.leaseId,
    periodMonth: c.periodMonth,
    dueAt: c.dueAt.toISOString(),
    amount: Number(c.amount),
    paid: sumMoney(paidByCharge.get(c.id) ?? []),
    status: c.status as RealtyChargeStatus,
  }));

  const pendientes = chargeDTOs.filter((c) => isChargeOpen(c.status));
  const saldo = sumMoney(pendientes.map((c) => Math.max(0, c.amount - c.paid)));

  return {
    leases: leases.map((l) => ({
      id: l.id,
      status: l.status as RealtyLeaseStatus,
      startsAt: l.startsAt.toISOString(),
      endsAt: l.endsAt.toISOString(),
      rentAmount: Number(l.rentAmount),
      currency: l.currency as RealtyCurrency,
      paymentDay: l.paymentDay,
      depositAmount: Number(l.depositAmount),
      hasSignedDoc: Boolean(l.signedDocUrl),
      propertyTitle: l.property.title,
      propertyAddress:
        [l.property.address, l.property.colonia, l.property.city].filter(Boolean).join(", ") || null,
      deposit: depositByLease.get(l.id) ?? null,
    })),
    charges: chargeDTOs,
    receipts: payments.map((p) => ({
      id: p.id,
      chargeId: p.chargeId,
      leaseId: p.leaseId,
      periodMonth: p.charge?.periodMonth ?? null,
      amount: Number(p.amount),
      method: p.method as RealtyPaymentMethod,
      paidAt: p.paidAt.toISOString(),
      reference: p.reference,
    })),
    saldo,
    currency: (leases[0]?.currency as RealtyCurrency) ?? "MXN",
  };
}

export interface PortalIssueDTO {
  id: string;
  description: string;
  status: RealtyMaintenanceStatus;
  /** Quién va a ir. Null mientras la inmobiliaria no lo asigne. */
  vendorName: string | null;
  photoCount: number;
  createdAt: string;
  resolvedAt: string | null;
  propertyTitle: string;
}

/** Las fallas de SUS contratos. Nada de las de otros inquilinos. */
export async function loadTenantIssues(scope: PortalTenantScope): Promise<PortalIssueDTO[]> {
  const rows = await prisma.realtyMaintenance.findMany({
    where: { accountId: scope.accountId, leaseId: { in: scope.leaseIds } },
    select: {
      id: true,
      description: true,
      status: true,
      vendorName: true,
      photoUrls: true,
      createdAt: true,
      resolvedAt: true,
      property: { select: { title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    status: r.status as RealtyMaintenanceStatus,
    vendorName: r.vendorName,
    photoCount: r.photoUrls.length,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    propertyTitle: r.property.title,
  }));
}

/**
 * Un objeto, NO una unión discriminada: el tsconfig del repo corre con
 * `strict: false` y ahí `if (!res.ok)` no estrecha la unión, así que
 * `res.error` no compila del otro lado del `if`.
 */
export interface CreateIssueResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Crea la incidencia. El inmueble NO viene del cuerpo: se deriva del
 * contrato, y el contrato se comprueba contra el cerco de la sesión.
 *
 * `reportedBy` guarda el nombre con el que la persona está capturada — el
 * campo existe justo porque "casi siempre lo reporta el inquilino, que no
 * tiene usuario del panel".
 */
export interface TenantIssueSlot {
  ok: boolean;
  error?: string;
  /** El inmueble, DERIVADO del contrato ya verificado. Nunca del cuerpo. */
  propertyId?: string;
}

/**
 * ¿Puede esta persona abrir un reporte en ese contrato?
 *
 * 🔴 SE LLAMA DOS VECES A PROPÓSITO: la ruta la usa ANTES de subir un solo
 * byte (si no, un inquilino con el cupo lleno sube 4 fotos, el reporte se
 * rechaza y los archivos se quedan huérfanos en el bucket sin que nadie los
 * cuente ni los borre), y createTenantIssue la repite justo antes de
 * insertar. La segunda no es paranoia: entre una y otra pasan las subidas.
 */
export async function checkTenantIssueSlot(
  scope: PortalTenantScope,
  leaseId: string,
): Promise<TenantIssueSlot> {
  // 🔴 El leaseId llega del formulario: se comprueba contra el cerco.
  if (!scope.leaseIds.includes(leaseId)) {
    return { ok: false, error: "No encontramos ese contrato." };
  }

  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: scope.accountId },
    select: { id: true, propertyId: true },
  });
  if (!lease) return { ok: false, error: "No encontramos ese contrato." };

  const abiertas = await prisma.realtyMaintenance.count({
    where: {
      accountId: scope.accountId,
      leaseId,
      status: { in: ["ABIERTO", "EN_PROCESO"] },
    },
  });
  if (abiertas >= PORTAL_ISSUE_MAX_OPEN) {
    return {
      ok: false,
      error: "Ya tienes varios reportes abiertos. Espera a que los atiendan para mandar otro.",
    };
  }

  return { ok: true, propertyId: lease.propertyId };
}

export async function createTenantIssue(
  scope: PortalTenantScope,
  args: { leaseId: string; description: string; photoUrls: string[] },
): Promise<CreateIssueResult> {
  const slot = await checkTenantIssueSlot(scope, args.leaseId);
  if (!slot.ok || !slot.propertyId) {
    return { ok: false, error: slot.error ?? "No encontramos ese contrato." };
  }

  const created = await prisma.realtyMaintenance.create({
    data: {
      accountId: scope.accountId,
      propertyId: slot.propertyId,
      leaseId: args.leaseId,
      reportedBy: scope.personName || null,
      description: args.description,
      photoUrls: args.photoUrls,
      status: "ABIERTO",
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

// ═══════════════════════════════════════════════════════════════════════
// 6. LO QUE VE EL PROPIETARIO
// ═══════════════════════════════════════════════════════════════════════

export interface PortalOwnerPropertyDTO {
  id: string;
  title: string;
  status: RealtyPropertyStatus;
  address: string | null;
  rentPrice: number | null;
  commissionPct: number | null;
  /** Contrato vigente, si lo hay. */
  lease: {
    id: string;
    /** 🔴 SOLO el nombre del inquilino. Ni teléfono, ni correo, ni solvencia. */
    tenantName: string | null;
    startsAt: string;
    endsAt: string;
    rentAmount: number;
    currency: RealtyCurrency;
    status: RealtyLeaseStatus;
  } | null;
}

export async function loadOwnerProperties(
  scope: PortalOwnerScope,
): Promise<PortalOwnerPropertyDTO[]> {
  const [properties, leases] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: { accountId: scope.accountId, id: { in: scope.propertyIds } },
      select: {
        id: true,
        title: true,
        status: true,
        address: true,
        colonia: true,
        city: true,
        rentPrice: true,
        commissionPct: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.realtyLease.findMany({
      where: {
        accountId: scope.accountId,
        propertyId: { in: scope.propertyIds },
        status: { in: ["ACTIVO", "VENCIDO"] },
      },
      select: {
        id: true,
        propertyId: true,
        startsAt: true,
        endsAt: true,
        rentAmount: true,
        currency: true,
        status: true,
        parties: {
          where: { role: "INQUILINO" },
          // Lista blanca explícita: del contacto sale el NOMBRE y nada más.
          select: { contact: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: { endsAt: "desc" },
    }),
  ]);

  const leaseByProperty = new Map<string, (typeof leases)[number]>();
  for (const l of leases) if (!leaseByProperty.has(l.propertyId)) leaseByProperty.set(l.propertyId, l);

  return properties.map((p) => {
    const l = leaseByProperty.get(p.id);
    return {
      id: p.id,
      title: p.title,
      status: p.status as RealtyPropertyStatus,
      address: [p.address, p.colonia, p.city].filter(Boolean).join(", ") || null,
      rentPrice: p.rentPrice === null ? null : Number(p.rentPrice),
      commissionPct: p.commissionPct === null ? null : Number(p.commissionPct),
      lease: l
        ? {
            id: l.id,
            tenantName: l.parties[0]?.contact.name ?? null,
            startsAt: l.startsAt.toISOString(),
            endsAt: l.endsAt.toISOString(),
            rentAmount: Number(l.rentAmount),
            currency: l.currency as RealtyCurrency,
            status: l.status as RealtyLeaseStatus,
          }
        : null,
    };
  });
}

export interface PortalOwnerExpenseDTO {
  id: string;
  propertyId: string;
  kind: RealtyExpenseKind;
  amount: number;
  paidAt: string;
  note: string | null;
}

export interface PortalOwnerMaintenanceDTO {
  id: string;
  propertyId: string;
  propertyTitle: string;
  description: string;
  status: RealtyMaintenanceStatus;
  vendorName: string | null;
  cost: number | null;
  /** La del inmueble: RealtyMaintenance no guarda moneda propia. */
  currency: RealtyCurrency;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PortalOwnerStatementData {
  statement: OwnerStatement;
  expenses: PortalOwnerExpenseDTO[];
  maintenances: PortalOwnerMaintenanceDTO[];
  propertyTitles: Record<string, string>;
  currency: RealtyCurrency;
}

/**
 * El corte del mes. Los números los arma buildOwnerStatement (puro, en
 * portal-core); aquí solo se leen las filas, todas acotadas por accountId
 * Y por los inmuebles del cerco.
 */
export async function loadOwnerStatement(
  scope: PortalOwnerScope,
  periodMonth: string,
): Promise<PortalOwnerStatementData | null> {
  const range = monthRange(periodMonth, scope.account.timezone);
  if (!range) return null;

  const [properties, payments, expenses, maintenances] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: { accountId: scope.accountId, id: { in: scope.propertyIds } },
      select: { id: true, title: true, commissionPct: true, currency: true },
    }),
    // Lo COBRADO en el mes: pagos de RENTA cuyo cargo cuelga de un contrato
    // de uno de sus inmuebles. `paidAt` en el mes, no `createdAt`.
    //
    // 🔴 `chargeId: { not: null }` NO ES UN ADORNO. Es lo que distingue un
    // pago de renta de un DEPÓSITO EN GARANTÍA o una penalización, que
    // cuelgan directo del contrato (así lo dice el contrato de
    // RealtyPayment: chargeId = renta, leaseId = depósito/penalización,
    // dealId = comisión). Un depósito es dinero del inquilino RETENIDO, no
    // ingreso del propietario: colarlo aquí lo sumaría a "cobrado", le
    // retendría comisión ENCIMA y saldría en "se te depositó" — dinero mal
    // dicho justo en el papel con el que el propietario reclama.
    prisma.realtyPayment.findMany({
      where: {
        accountId: scope.accountId,
        paidAt: { gte: range.start, lt: range.end },
        chargeId: { not: null },
        charge: { lease: { propertyId: { in: scope.propertyIds } } },
      },
      select: {
        amount: true,
        charge: { select: { lease: { select: { propertyId: true } } } },
      },
    }),
    prisma.realtyExpense.findMany({
      where: {
        accountId: scope.accountId,
        propertyId: { in: scope.propertyIds },
        paidAt: { gte: range.start, lt: range.end },
      },
      select: { id: true, propertyId: true, kind: true, amount: true, paidAt: true, note: true },
      orderBy: { paidAt: "desc" },
    }),
    prisma.realtyMaintenance.findMany({
      where: {
        accountId: scope.accountId,
        propertyId: { in: scope.propertyIds },
        createdAt: { gte: range.start, lt: range.end },
      },
      select: {
        id: true,
        propertyId: true,
        description: true,
        status: true,
        vendorName: true,
        cost: true,
        createdAt: true,
        resolvedAt: true,
        property: { select: { title: true, currency: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const pctById = new Map(properties.map((p) => [p.id, p.commissionPct === null ? 0 : Number(p.commissionPct)]));
  const titles: Record<string, string> = {};
  for (const p of properties) titles[p.id] = p.title;

  const rents = payments
    .map((p) => {
      const propertyId = p.charge?.lease.propertyId ?? null;
      if (!propertyId || !scope.propertyIds.includes(propertyId)) return null;
      return {
        propertyId,
        amount: Number(p.amount),
        commissionPct: pctById.get(propertyId) ?? 0,
      };
    })
    .filter((r): r is { propertyId: string; amount: number; commissionPct: number } => r !== null);

  const statement = buildOwnerStatement({
    periodMonth,
    rents,
    expenses: expenses.map((e) => ({ propertyId: e.propertyId, amount: Number(e.amount) })),
    // La cartera ENTERA con su comisión pactada: es lo que decide si el
    // corte puede decir "no hay comisión pactada". Ver buildOwnerStatement.
    properties: properties.map((p) => ({
      propertyId: p.id,
      commissionPct: pctById.get(p.id) ?? 0,
    })),
  });

  return {
    statement,
    expenses: expenses.map((e) => ({
      id: e.id,
      propertyId: e.propertyId,
      kind: e.kind as RealtyExpenseKind,
      amount: Number(e.amount),
      paidAt: e.paidAt.toISOString(),
      note: e.note,
    })),
    maintenances: maintenances.map((m) => ({
      id: m.id,
      propertyId: m.propertyId,
      propertyTitle: m.property.title,
      description: m.description,
      status: m.status as RealtyMaintenanceStatus,
      vendorName: m.vendorName,
      cost: m.cost === null ? null : Number(m.cost),
      currency: m.property.currency as RealtyCurrency,
      createdAt: m.createdAt.toISOString(),
      resolvedAt: m.resolvedAt ? m.resolvedAt.toISOString() : null,
    })),
    propertyTitles: titles,
    currency: (properties[0]?.currency as RealtyCurrency) ?? "MXN",
  };
}

/** Todos los mantenimientos de sus inmuebles, con su costo. */
export async function loadOwnerMaintenances(
  scope: PortalOwnerScope,
): Promise<PortalOwnerMaintenanceDTO[]> {
  const rows = await prisma.realtyMaintenance.findMany({
    where: { accountId: scope.accountId, propertyId: { in: scope.propertyIds } },
    select: {
      id: true,
      propertyId: true,
      description: true,
      status: true,
      vendorName: true,
      cost: true,
      createdAt: true,
      resolvedAt: true,
      property: { select: { title: true, currency: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((m) => ({
    id: m.id,
    propertyId: m.propertyId,
    propertyTitle: m.property.title,
    description: m.description,
    status: m.status as RealtyMaintenanceStatus,
    vendorName: m.vendorName,
    cost: m.cost === null ? null : Number(m.cost),
    currency: m.property.currency as RealtyCurrency,
    createdAt: m.createdAt.toISOString(),
    resolvedAt: m.resolvedAt ? m.resolvedAt.toISOString() : null,
  }));
}

export interface PortalOwnerLeaseDTO {
  id: string;
  propertyId: string;
  propertyTitle: string;
  tenantName: string | null;
  startsAt: string;
  endsAt: string;
  rentAmount: number;
  currency: RealtyCurrency;
  status: RealtyLeaseStatus;
  paymentDay: number;
}

/** Sus contratos y sus vencimientos. */
export async function loadOwnerLeases(scope: PortalOwnerScope): Promise<PortalOwnerLeaseDTO[]> {
  const rows = await prisma.realtyLease.findMany({
    where: { accountId: scope.accountId, propertyId: { in: scope.propertyIds } },
    select: {
      id: true,
      propertyId: true,
      startsAt: true,
      endsAt: true,
      rentAmount: true,
      currency: true,
      status: true,
      paymentDay: true,
      property: { select: { title: true } },
      parties: { where: { role: "INQUILINO" }, select: { contact: { select: { name: true } } }, take: 1 },
    },
    orderBy: { endsAt: "asc" },
    take: 100,
  });
  return rows.map((l) => ({
    id: l.id,
    propertyId: l.propertyId,
    propertyTitle: l.property.title,
    tenantName: l.parties[0]?.contact.name ?? null,
    startsAt: l.startsAt.toISOString(),
    endsAt: l.endsAt.toISOString(),
    rentAmount: Number(l.rentAmount),
    currency: l.currency as RealtyCurrency,
    status: l.status as RealtyLeaseStatus,
    paymentDay: l.paymentDay,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// 7. ARCHIVOS DEL INQUILINO — la única puerta a un documento
// ═══════════════════════════════════════════════════════════════════════

export type PortalFileKind = "contrato" | "recibo";

/**
 * Resuelve la liga firmada de un archivo COMPROBANDO antes que pertenece a
 * quien la pide.
 *
 * 🔴 Aquí es donde se intentaría cambiar un id en la URL para leer el
 * contrato de otro. El `where` lleva accountId + el id del cerco, así que
 * un id ajeno no devuelve la fila ajena: devuelve nada.
 *
 * El inquilino NO tiene acceso a RealtyPropertyDocument (escrituras,
 * predial, identificaciones): esos son papeles del propietario y del
 * inmueble, no suyos. Solo su contrato firmado y sus recibos.
 */
export async function resolveTenantFile(
  scope: PortalTenantScope,
  kind: PortalFileKind,
  id: string,
): Promise<string | null> {
  if (kind === "contrato") {
    if (!scope.leaseIds.includes(id)) return null;
    const lease = await prisma.realtyLease.findFirst({
      where: { id, accountId: scope.accountId },
      select: { signedDocUrl: true },
    });
    return signPortalFile(lease?.signedDocUrl);
  }
  const payment = await prisma.realtyPayment.findFirst({
    where: {
      id,
      accountId: scope.accountId,
      OR: [{ leaseId: { in: scope.leaseIds } }, { charge: { leaseId: { in: scope.leaseIds } } }],
    },
    select: { receiptUrl: true },
  });
  return signPortalFile(payment?.receiptUrl);
}

/** Un pago del inquilino, con todo lo que necesita su recibo. Null si no es suyo. */
export async function loadTenantReceipt(scope: PortalTenantScope, paymentId: string) {
  const p = await prisma.realtyPayment.findFirst({
    where: {
      id: paymentId,
      accountId: scope.accountId,
      OR: [{ leaseId: { in: scope.leaseIds } }, { charge: { leaseId: { in: scope.leaseIds } } }],
    },
    select: {
      id: true,
      amount: true,
      method: true,
      paidAt: true,
      reference: true,
      // La MONEDA sale del contrato: RealtyPayment no tiene columna propia,
      // y sin ella un recibo de un contrato en dólares se imprimiría en
      // pesos — el mismo número diciendo otra cosa.
      charge: {
        select: {
          periodMonth: true,
          lease: {
            select: {
              currency: true,
              property: { select: { title: true, address: true, colonia: true, city: true } },
            },
          },
        },
      },
      lease: {
        select: {
          currency: true,
          property: { select: { title: true, address: true, colonia: true, city: true } },
        },
      },
    },
  });
  if (!p) return null;
  const lease = p.charge?.lease ?? p.lease ?? null;
  const property = lease?.property ?? null;
  return {
    id: p.id,
    amount: Number(p.amount),
    method: p.method as RealtyPaymentMethod,
    paidAt: p.paidAt,
    reference: p.reference,
    currency: (lease?.currency as RealtyCurrency) ?? "MXN",
    periodMonth: p.charge?.periodMonth ?? null,
    propertyTitle: property?.title ?? "",
    propertyAddress:
      property ? [property.address, property.colonia, property.city].filter(Boolean).join(", ") || null : null,
  };
}

/** El propietario también baja el recibo de un gasto suyo (si lo hay). */
export async function resolveOwnerExpenseReceipt(
  scope: PortalOwnerScope,
  expenseId: string,
): Promise<string | null> {
  const expense = await prisma.realtyExpense.findFirst({
    where: { id: expenseId, accountId: scope.accountId, propertyId: { in: scope.propertyIds } },
    select: { receiptUrl: true },
  });
  return signPortalFile(expense?.receiptUrl);
}

/** La cuenta de un slug, para pintar el logo en el login. Solo si sirve portal. */
export async function resolvePortalAccountBySlug(slug: unknown): Promise<PortalAccountDTO | null> {
  if (typeof slug !== "string" || !slug.trim()) return null;
  const row = await prisma.realtyAccount.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      city: true,
      state: true,
      timezone: true,
      logoUrl: true,
      isActive: true,
      subscriptionStatus: true,
    },
  });
  if (!row || !row.isActive || !isRealtySubscriptionActive(row)) return null;
  return pickPortalAccount(row as unknown as Record<string, unknown>);
}

/** Normaliza el teléfono con la MISMA regla que todo el repo. */
export function normalizePortalPhone(raw: unknown): string | null {
  return mxTenDigits(typeof raw === "string" ? raw : "");
}
