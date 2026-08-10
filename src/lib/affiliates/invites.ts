/**
 * Afiliados — INVITACIONES ENTRE AFILIADOS (el segundo nivel, ago 2026).
 *
 * EL MODELO, en una frase: un afiliado invita a otro, el invitado es un
 * afiliado NORMAL e idéntico a él, y quien invita cobra ÚNICAMENTE los bonos
 * por red (@/lib/affiliates/network-bonus) cuando la red de sus invitados
 * crece. Ni un peso de las comisiones del invitado cambia de manos.
 *
 *   · El invitado gana la misma comisión por plan que cualquier afiliado.
 *   · Elige su propia modalidad (fijo recurrente o pago único).
 *   · Gana sus propios bonos por clínicas activas.
 *   · Puede invitar gente a su vez, y usa el panel normal de afiliado.
 *
 * UN SOLO NIVEL. Si A invita a B y B invita a C, las clínicas de C cuentan
 * para el bono de red de B y CERO para A. Nunca se acumula hacia arriba.
 *
 * POR QUÉ EL LINK ES `/afiliados/registro?inv=<referralCode>` Y NO `/r/<code>`
 * `/r/<code>` es el link de CLIENTES: siembra la cookie de atribución `dc_aff`
 * y manda a la home para que la clínica que se dé de alta después cuente como
 * referida. Meter ahí también las invitaciones entre afiliados mezclaría dos
 * atribuciones distintas en la misma cookie —el invitado quedaría además
 * marcado como "clínica referida" de su invitador— y volvería ambiguo qué
 * significa un clic. La invitación es un acto explícito y de una sola pantalla,
 * así que viaja como parámetro visible del registro, sin cookie y sin tocar la
 * atribución de clínicas. `?inv=` es el nombre del parámetro y vive aquí.
 *
 * NADA DE ESTO PUEDE ROMPER UN ALTA. Un código inválido, un invitador que no
 * está APPROVED, una auto-invitación o un error de BD dejan el registro
 * seguir su curso SIN vínculo. Por eso todo aquí devuelve null en vez de lanzar.
 */
import { prisma } from "@/lib/prisma";
import { siteBase } from "./link-url";
import { activeClinicWhere } from "./stats";
import { paidInvoiceCountByClinic } from "./milestones-progress";
import { clinicQualifies } from "./qualifying-clinic";

/** Nombre del parámetro del link de invitación. Fuente única. */
export const INVITE_PARAM = "inv";

/** El link que un afiliado comparte para invitar a otro. */
export function inviteUrl(referralCode: string): string {
  return `${siteBase()}/afiliados/registro?${INVITE_PARAM}=${encodeURIComponent(referralCode)}`;
}

/**
 * Limpia el código que llega de la URL. Mismo formato que `referralCode`
 * ([A-Z0-9]{8}, ver generateReferralCode) pero tolerante a que alguien lo
 * dicte o lo escriba en minúsculas. "" = no hay invitación que resolver.
 */
export function normalizeInviteCode(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z0-9]{4,24}$/.test(v) ? v : "";
}

/**
 * ¿Quién invitó? Devuelve el id del afiliado invitador o null.
 *
 * Se bloquea la AUTO-INVITACIÓN por las dos vías posibles —mismo correo o el
 * afiliado que ya es uno mismo— igual que el anti self-referral del alta de
 * clínicas: sin ese candado, cualquiera se invitaría a sí mismo con una
 * segunda cuenta y se pagaría un bono por su propio trabajo.
 *
 * Y se exige `APPROVED`: un invitador pendiente o suspendido no arrastra a
 * nadie a su red. El alta del invitado sigue igual, solo que sin vínculo.
 *
 * NUNCA lanza.
 */
export async function resolveInviterId(opts: {
  code: unknown;
  /** Correo de quien se está registrando, ya en minúsculas. */
  email: string;
  /** Su affiliateId, si ya existiera (caso vinculación). Opcional. */
  selfAffiliateId?: string | null;
}): Promise<string | null> {
  const code = normalizeInviteCode(opts.code);
  if (!code) return null;
  try {
    const inviter = await prisma.affiliate.findUnique({
      where: { referralCode: code },
      select: { id: true, email: true, status: true },
    });
    if (!inviter) return null;
    if (inviter.status !== "APPROVED") return null;
    // Auto-invitación: mismo correo…
    if (inviter.email && inviter.email.trim().toLowerCase() === (opts.email ?? "").trim().toLowerCase()) {
      return null;
    }
    // …o literalmente el mismo afiliado.
    if (opts.selfAffiliateId && opts.selfAffiliateId === inviter.id) return null;
    return inviter.id;
  } catch {
    return null;
  }
}

/** Quién invitó a ESTE afiliado. null = se registró directo. */
export interface Inviter {
  id: string;
  name: string;
  /** Cuándo se creó la cuenta del invitado — el "desde cuándo" del vínculo. */
  since: Date;
}

export async function getInviter(affiliateId: string): Promise<Inviter | null> {
  if (!affiliateId) return null;
  try {
    const me = await prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { createdAt: true, invitedByAffiliateId: true },
    });
    if (!me?.invitedByAffiliateId) return null;
    const inviter = await prisma.affiliate.findUnique({
      where: { id: me.invitedByAffiliateId },
      select: { id: true, name: true },
    });
    if (!inviter) return null;
    return { id: inviter.id, name: inviter.name, since: me.createdAt };
  } catch {
    return null;
  }
}

/**
 * Un invitado, tal como lo ve quien lo invitó.
 *
 * PRIVACIDAD — esto es todo lo que sale, y es deliberado: nombre, desde cuándo
 * y CONTEOS de clínicas. Jamás sus comisiones, su modalidad, sus datos de pago,
 * su correo ni un solo dato de las clínicas que trajo. El invitador cobra por
 * un número, así que solo ve ese número.
 */
export interface InvitedAffiliate {
  id: string;
  name: string;
  since: Date;
  /** Estado del invitado: explica un conteo en 0 sin revelar nada más. */
  status: string;
  /** Clínicas activas suyas que CUENTAN para el bono de red del invitador. */
  qualifyingClinics: number;
  /** Clínicas activas suyas, califiquen o no (contexto del número de arriba). */
  activeClinics: number;
}

/**
 * Los invitados DIRECTOS de un afiliado, con el conteo que alimenta su bono.
 *
 * Un solo salto: no se recorre el árbol. Cuatro consultas fijas sin importar
 * cuánta gente haya invitado. Cualquier error degrada a lista vacía.
 */
export async function getInvitedAffiliates(
  affiliateId: string,
  now: Date = new Date(),
): Promise<InvitedAffiliate[]> {
  if (!affiliateId) return [];
  try {
    const invited = await prisma.affiliate.findMany({
      where: { invitedByAffiliateId: affiliateId },
      select: { id: true, name: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (invited.length === 0) return [];

    const ids = invited.map((a) => a.id);
    const clinics = await prisma.clinic.findMany({
      where: { AND: [{ affiliateId: { in: ids } }, activeClinicWhere(now)] },
      select: { id: true, affiliateId: true },
    });

    const paidByClinic =
      clinics.length > 0 ? await paidInvoiceCountByClinic(clinics.map((c) => c.id)) : new Map();

    const active = new Map<string, number>();
    const qualifying = new Map<string, number>();
    for (const c of clinics) {
      if (!c.affiliateId) continue;
      active.set(c.affiliateId, (active.get(c.affiliateId) ?? 0) + 1);
      if (clinicQualifies(paidByClinic.get(c.id))) {
        qualifying.set(c.affiliateId, (qualifying.get(c.affiliateId) ?? 0) + 1);
      }
    }

    return invited.map((a) => ({
      id: a.id,
      name: a.name,
      since: a.createdAt,
      status: a.status,
      qualifyingClinics: qualifying.get(a.id) ?? 0,
      activeClinics: active.get(a.id) ?? 0,
    }));
  } catch {
    return [];
  }
}

/** Conteo de invitados directos, para el admin y las tarjetas de resumen. */
export async function countInvited(affiliateId: string): Promise<number> {
  if (!affiliateId) return 0;
  try {
    return await prisma.affiliate.count({ where: { invitedByAffiliateId: affiliateId } });
  } catch {
    return 0;
  }
}
