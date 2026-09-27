// Datos bancarios POR SEDE (ws1-t3 fase 2) — banco, beneficiario, CLABE y
// referencia, para «Pedir anticipo → Transferencia» y su PDF/texto.
//
// Mismo molde que src/lib/billing/spei-directo.ts (la cuenta de la
// PLATAFORMA): la validación de forma (banco/beneficiario/CLABE) se REUSA de
// spei-directo-core.ts — una CLABE válida es una CLABE válida, sea de
// DaleControl o de una clínica. Aquí solo cambia el "cliente" (Prisma
// clinicBankAccount por clinicId) y que hay un campo extra: `referencia`
// (texto libre de guía para el concepto de la transferencia).
//
// Sin "server-only" a propósito (mismo criterio que el resto de
// src/lib/anticipos/*.server.ts): así los tests lo cargan con tsx/node:test.

import { prisma } from "@/lib/prisma";
import { clabeValida, normalizarClabe, type CuentaBancaria } from "@/lib/billing/spei-directo-core";

export interface CuentaBancariaSede extends CuentaBancaria {
  /** Guía del concepto ("Escribe el nombre del paciente"). null = sin guía. */
  referencia: string | null;
}

const LARGO_MAX_TEXTO = 120;
const LARGO_MAX_REFERENCIA = 200;

/** Tabla que todavía no existe (el SQL va por detrás del deploy). */
function faltaTabla(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === "P2021" || code === "P2022") return true;
  // Cliente de Prisma sin regenerar: pasa en un `next dev` que arrancó antes
  // de `npx prisma generate` — el delegado del modelo nuevo (clinicBankAccount)
  // todavía no existe y `prisma.clinicBankAccount` es `undefined`, así que
  // `.findUnique`/`.upsert` truena como TypeError, no como error de Prisma.
  // En producción `npm run build` siempre genera el cliente antes de arrancar,
  // así que ahí este caso no se da (mismo criterio que spei-directo.ts).
  return e instanceof TypeError && /reading '(findUnique|findFirst|findMany|count|upsert|create)'/.test(e.message);
}

/**
 * Normaliza lo escrito en Configuración → Anticipos.
 *
 * UN SOLO TIPO, sin unión: el repo no compila en `strict` y no estrecha bien
 * por `ok` (mismo criterio que ResultadoPedirAnticipo en panel.server.ts) —
 * `cuenta` es `null` en vez de estar ausente del tipo.
 */
export interface ValidacionCuentaBancariaSede {
  ok: boolean;
  error: string | null;
  cuenta: CuentaBancariaSede | null;
}

export function validarCuentaBancariaSede(
  raw: Partial<Record<keyof CuentaBancariaSede, unknown>>,
): ValidacionCuentaBancariaSede {
  const invalida = (error: string): ValidacionCuentaBancariaSede => ({ ok: false, error, cuenta: null });
  const banco = String(raw.banco ?? "").trim();
  const beneficiario = String(raw.beneficiario ?? "").trim();
  const clabe = normalizarClabe(String(raw.clabe ?? ""));
  const referencia = raw.referencia == null ? "" : String(raw.referencia).trim();
  if (!banco) return invalida("Escribe el nombre del banco.");
  if (!beneficiario) return invalida("Escribe el nombre del beneficiario.");
  if (banco.length > LARGO_MAX_TEXTO || beneficiario.length > LARGO_MAX_TEXTO) {
    return invalida(`Banco y beneficiario admiten hasta ${LARGO_MAX_TEXTO} caracteres.`);
  }
  if (!/^\d{18}$/.test(clabe)) return invalida("La CLABE tiene 18 dígitos.");
  if (!clabeValida(clabe)) return invalida("La CLABE no es válida: revisa los dígitos (falla el dígito verificador).");
  if (referencia.length > LARGO_MAX_REFERENCIA) {
    return invalida(`La referencia admite hasta ${LARGO_MAX_REFERENCIA} caracteres.`);
  }
  return { ok: true, error: null, cuenta: { banco, beneficiario, clabe, referencia: referencia || null } };
}

/** ¿Los datos guardados son utilizables? Igual que cuentaUsable de spei-directo-core. */
export function cuentaSedeUsable(c: Partial<CuentaBancariaSede> | null | undefined): c is CuentaBancariaSede {
  return !!c && !!c.banco?.trim() && !!c.beneficiario?.trim() && clabeValida(c.clabe ?? "");
}

/** La cuenta de esta sede, o null si falta / está incompleta / CLABE inválida. */
export async function leerDatosBancarios(clinicId: string): Promise<CuentaBancariaSede | null> {
  if (!clinicId) return null;
  try {
    const fila = await prisma.clinicBankAccount.findUnique({ where: { clinicId } });
    return cuentaSedeUsable(fila) ? { banco: fila.banco, beneficiario: fila.beneficiario, clabe: fila.clabe, referencia: fila.referencia ?? null } : null;
  } catch (e) {
    if (faltaTabla(e)) return null;
    throw e;
  }
}

/** Igual que leerDatosBancarios pero devuelve lo guardado aunque esté incompleto (para el editor). */
export async function leerDatosBancariosParaEditar(
  clinicId: string,
): Promise<(Partial<CuentaBancariaSede> & { updatedAt: string | null }) | null> {
  if (!clinicId) return null;
  try {
    const fila = await prisma.clinicBankAccount.findUnique({ where: { clinicId } });
    if (!fila) return null;
    return {
      banco: fila.banco,
      beneficiario: fila.beneficiario,
      clabe: fila.clabe,
      referencia: fila.referencia ?? null,
      updatedAt: fila.updatedAt.toISOString(),
    };
  } catch (e) {
    if (faltaTabla(e)) return null;
    throw e;
  }
}

/** La tabla (aún) no existe: sql/anticipo-transferencia.sql todavía no se aplicó. */
export class DatosBancariosSinTabla extends Error {
  constructor() {
    super("Falta aplicar la actualización de la base (sql/anticipo-transferencia.sql).");
    this.name = "DatosBancariosSinTabla";
  }
}

/**
 * Guardar SÍ debe avisar (a diferencia de leer, que se calla): perder en
 * silencio lo que la clínica acaba de escribir sería peor que un error
 * claro. Se traduce a `DatosBancariosSinTabla`, catchable por nombre, para
 * que la ruta responda 409 con un mensaje legible en vez de un 500 crudo.
 */
export async function guardarDatosBancarios(clinicId: string, cuenta: CuentaBancariaSede, userId: string): Promise<void> {
  try {
    await prisma.clinicBankAccount.upsert({
      where: { clinicId },
      create: { clinicId, ...cuenta, updatedBy: userId },
      update: { ...cuenta, updatedBy: userId },
    });
  } catch (e) {
    if (faltaTabla(e)) throw new DatosBancariosSinTabla();
    throw e;
  }
}
