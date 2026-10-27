/**
 * ws1-t4 v8 — La bitácora no nombra sedes a las que quien mira no tiene acceso.
 *
 * Filas viejas (de antes de v7/v8) guardan en la sede activa datos de OTRAS sedes del mismo
 * dueño: el alta de una sede (nombre, slug, plan), el «también en» del alta por correo, los
 * vínculos de pacientes (ids)… No se tocan en la base: se tapan AL LEER. Cada id, slug o nombre
 * de una sede del dueño en la que quien mira no tiene ficha activa sale como «otra sede».
 * El dueño tiene ficha en todas sus sedes (también en las archivadas), así que lo ve todo.
 */
import { prisma } from "@/lib/prisma";

export const OTRA_SEDE = "otra sede";

export interface SedeAjena {
  id: string;
  name: string;
  slug: string | null;
}

/**
 * Sedes del dueño (o dueños) de `clinicId` en las que `supabaseId` (de la SESIÓN) no tiene ficha
 * activa. Incluye las archivadas: también salen en filas viejas. Tres consultas, en serie.
 */
export async function sedesAjenasPara(clinicId: string, supabaseId: string | null | undefined): Promise<SedeAjena[]> {
  if (!clinicId) throw new Error("sedesAjenasPara: falta clinicId");
  const duenos = await prisma.user.findMany({
    where: { clinicId, role: "SUPER_ADMIN", isActive: true },
    select: { supabaseId: true },
  });
  const ids = Array.from(new Set(duenos.map((d) => d.supabaseId).filter(Boolean)));
  if (ids.length === 0) return [];
  const filas = await prisma.user.findMany({
    where: { supabaseId: { in: ids }, role: "SUPER_ADMIN", isActive: true, clinicId: { not: clinicId } },
    select: { clinic: { select: { id: true, name: true, slug: true } } },
  });
  const grupo = new Map<string, SedeAjena>();
  for (const f of filas) if (f.clinic) grupo.set(f.clinic.id, { id: f.clinic.id, name: f.clinic.name, slug: f.clinic.slug ?? null });
  if (grupo.size === 0) return [];
  // Sin supabaseId en la sesión no ve ninguna: todas son ajenas.
  const propias = supabaseId
    ? await prisma.user.findMany({
        where: { supabaseId, clinicId: { in: Array.from(grupo.keys()) }, isActive: true },
        select: { clinicId: true },
      })
    : [];
  for (const p of propias) grupo.delete(p.clinicId);
  return Array.from(grupo.values());
}

/** Copia de `valor` con cada id, slug o nombre de una sede ajena cambiado por «otra sede». Puro. */
export function taparSedesAjenas<T>(valor: T, ajenas: SedeAjena[]): T {
  if (ajenas.length === 0) return valor;
  const exactos = new Set<string>();
  for (const s of ajenas) {
    exactos.add(s.id);
    if (s.slug) exactos.add(s.slug);
  }
  // Los nombres también dentro de un texto («Sede creada: X»). Primero los más largos, para que
  // «Sede Centro Norte» no quede a medias por «Sede Centro».
  const nombres = Array.from(new Set(ajenas.map((s) => s.name.trim()).filter((n) => n.length >= 3))).sort(
    (a, b) => b.length - a.length,
  );
  const tapar = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (exactos.has(v)) return OTRA_SEDE;
      let s = v;
      for (const n of nombres) if (s.includes(n)) s = s.split(n).join(OTRA_SEDE);
      return s;
    }
    if (Array.isArray(v)) return v.map(tapar);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = tapar(x);
      return out;
    }
    return v;
  };
  return tapar(valor) as T;
}

/** Lo que de una fila de bitácora puede nombrar otra sede: `entityId` y `changes`. */
export function taparFilaDeBitacora<F extends { entityId: string; changes: unknown }>(fila: F, ajenas: SedeAjena[]): F {
  if (ajenas.length === 0) return fila;
  return { ...fila, entityId: taparSedesAjenas(fila.entityId, ajenas), changes: taparSedesAjenas(fila.changes, ajenas) };
}
