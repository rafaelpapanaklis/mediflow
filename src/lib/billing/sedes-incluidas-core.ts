import { findBranchMothers, type BranchBillingRow, type ClinicOwnerRow } from "@/lib/admin/mrr-core";
import { cfdiOverage, type CfdiOverage } from "@/lib/cfdi-quota";

/**
 * SEDES INCLUIDAS — núcleo PURO (ws1-t5, auditoría del plan Clínica y sedes).
 *
 * Decisión de Rafael (7-oct-2026): las sedes incluidas no pagan aparte y SIGUEN el estado de pago de la
 * clínica que paga (la «madre»); el cupo de CFDI del mes (y almacenamiento / tokens IA del plan) es del
 * dueño, compartido entre sus sedes. Quién es la madre de quién lo decide `findBranchMothers` (mrr-core),
 * la misma fuente que usa /admin: no hay `parentClinicId` en el schema.
 */

export interface GrupoDePago {
  /** La clínica que PAGA: la propia si no es sede incluida. */
  pagadoraId: string;
  /** La pagadora más sus sedes incluidas. Siempre incluye `clinicId`. */
  miembros: string[];
  /** true = `clinicId` es una sede incluida (no paga: la paga `pagadoraId`). */
  esSedeIncluida: boolean;
}

export function grupoDePago(
  clinicId: string,
  clinicas: BranchBillingRow[],
  duenos: ClinicOwnerRow[],
): GrupoDePago {
  const madres = findBranchMothers(clinicas, duenos);
  const pagadoraId = madres.get(clinicId) ?? clinicId;
  const miembros = [pagadoraId];
  madres.forEach((madre, sede) => {
    if (madre === pagadoraId && miembros.indexOf(sede) === -1) miembros.push(sede);
  });
  if (miembros.indexOf(clinicId) === -1) miembros.push(clinicId);
  return { pagadoraId, miembros, esSedeIncluida: pagadoraId !== clinicId };
}

/** Lo que de la madre se copia a cada sede incluida. */
export interface EstadoDeMadre {
  plan: string;
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
}

/**
 * Los datos que se escriben en cada sede incluida para que siga a su madre.
 *  · «active / trialing / paid» → la sede queda `active` (la huella con la que nace: el gate mira el
 *    estado, no la fecha). Cualquier otro (past_due, cancelled, paused, unpaid…) se copia TAL CUAL.
 *  · `trialEndsAt` (el «acceso hasta» del gate) se copia para que la sede tenga EL MISMO margen que la
 *    madre: con past_due y periodo por delante sigue entrando hasta que la madre lo pierda.
 *  · `nextBillingDate` NO se copia nunca: es lo que distingue a la sede (sin cobro propio) de un
 *    pagador manual, y sin ello el cron de caducidad manual apagaría sedes pagadas.
 * Una madre sin estado (null) no propaga nada: no se inventa un estado.
 */
export function datosDeSedeDesdeMadre(madre: EstadoDeMadre): {
  plan: string;
  subscriptionStatus: string;
  trialEndsAt?: Date;
} | null {
  const estado = madre.subscriptionStatus;
  if (!estado) return null;
  const vivo = estado === "active" || estado === "trialing" || estado === "paid";
  return {
    plan: madre.plan,
    subscriptionStatus: vivo ? "active" : estado,
    ...(madre.trialEndsAt ? { trialEndsAt: madre.trialEndsAt } : {}),
  };
}

/**
 * A2 — bajar de plan con varias sedes. `maxClinicsDestino` null = sin tope. Se bloquea cuando el dueño
 * tiene MÁS sedes de las que admite el plan destino (Básico/Profesional = 1). Con una sola sede, como hoy.
 */
export function bloqueoDowngradePorSedes(input: {
  sedes: number;
  maxClinicsDestino: number | null;
}): { bloqueado: false } | { bloqueado: true; sobran: number; mensaje: string } {
  const max = input.maxClinicsDestino;
  if (max === null || input.sedes <= max) return { bloqueado: false };
  const sobran = input.sedes - max;
  return {
    bloqueado: true,
    sobran,
    mensaje:
      `Tienes ${input.sedes} sedes y ese plan admite ${max}. ` +
      `Para bajar de plan primero cierra o archiva ${sobran === 1 ? "1 sede" : `${sobran} sedes`} ` +
      "(escríbenos a soporte si necesitas ayuda) y vuelve a intentarlo. Mientras tengas varias sedes tu plan sigue siendo Clínica.",
  };
}

/** M1/M2 — texto cuando una sede incluida intenta pagar / cancelar / cambiar plan. */
export function avisoSedeIncluida(principalNombre: string | null): string {
  return principalNombre
    ? `Esta sede va incluida en el plan de «${principalNombre}», que es la clínica que paga. Cambia a esa clínica para pagar, cambiar de plan o cancelar.`
    : "Esta sede va incluida en el plan de la clínica principal del dueño. Cambia a esa clínica para pagar, cambiar de plan o cancelar.";
}

/**
 * M5 — cupo de CFDI del mes COMPARTIDO por el grupo de pago (la madre y sus sedes incluidas).
 * `timbrados` = lo timbrado en el periodo por cada miembro. El excedente se calcula sobre el total y se
 * cobra a la madre.
 */
export function cupoCfdiDelGrupo(input: {
  timbrados: number[];
  incluidosMes: number;
  centavosPorExcedente: number;
}): CfdiOverage {
  const total = input.timbrados.reduce((a, n) => a + Math.max(0, Math.floor(n || 0)), 0);
  return cfdiOverage(total, input.incluidosMes, input.centavosPorExcedente);
}

export interface FilaCfdiPendiente {
  id: string;
  clinicId: string;
  period: string;
  stamped: number;
}

export interface GrupoCfdiPendiente<T extends FilaCfdiPendiente = FilaCfdiPendiente> {
  /** La clínica a la que se cobra el excedente (la madre, o la propia si no es sede incluida). */
  pagadoraId: string;
  period: string;
  filas: T[];
  /** Suma de timbrados de todas las filas del grupo en el periodo. */
  totalTimbrados: number;
}

/**
 * M5 — agrupa las filas de uso CFDI sin cobrar por (clínica que paga, periodo). `madres` es sede → madre
 * (solo las sedes incluidas; el resto se agrupa consigo misma). El cron cobra UNA vez por grupo.
 */
export function agruparCfdiPorPagadora<T extends FilaCfdiPendiente>(
  filas: T[],
  madres: Map<string, string>,
): GrupoCfdiPendiente<T>[] {
  const grupos = new Map<string, GrupoCfdiPendiente<T>>();
  for (const f of filas) {
    const pagadoraId = madres.get(f.clinicId) ?? f.clinicId;
    const clave = `${pagadoraId}|${f.period}`;
    let g = grupos.get(clave);
    if (!g) {
      g = { pagadoraId, period: f.period, filas: [], totalTimbrados: 0 };
      grupos.set(clave, g);
    }
    g.filas.push(f);
    g.totalTimbrados += Math.max(0, Math.floor(f.stamped || 0));
  }
  return Array.from(grupos.values());
}
