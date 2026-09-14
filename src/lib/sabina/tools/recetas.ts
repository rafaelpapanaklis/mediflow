/**
 * `recetas` — «¿qué le receté a este paciente?» y «¿el clonazepam es
 * controlado?», en una sola herramienta con dos modos (§4 del contrato: no
 * multiplicar herramientas que caben como parámetro).
 *
 * ── LA DECISIÓN DELICADA: LA VIGENCIA NO SALE DEL CAMPO GUARDADO ──────────
 * MAPA-clinico.md N4: `POST /api/prescriptions` calcula `expiresAt` con el
 * `cofeprisGroup` que manda EL NAVEGADOR, no el del catálogo. Una receta de
 * morfina (grupo I real, máximo legal 24 h) puede tener guardado
 * `expiresAt` a dos años si quien la creó (o algo entre medio) mandó un
 * grupo distinto o ningún grupo. Repetir ese campo tal cual sería que Sabina
 * jure que una receta de un controlado sigue vigente cuando la ley dice que
 * ya no.
 *
 * Así que aquí NUNCA se confía en `Prescription.cofeprisGroup` (texto libre
 * del cliente) ni en `expiresAt` a solas para un controlado: el grupo real
 * sale de `CumsItem.cofeprisGroup` (el catálogo, que nadie manda por API) y
 * el "vence el" que se usa para decidir vigente/vencida es el MÁS ESTRICTO
 * entre lo guardado y el máximo legal recalculado del catálogo (misma
 * fórmula que `expiresForCofeprisGroup` de la ruta: I→24h, II→30d, III→90d).
 * Si lo guardado es más laxo que la ley, se avisa explícito en vez de
 * callarlo — nunca se calla la discrepancia y nunca se alarga la fecha.
 *
 * ── PERMISO ────────────────────────────────────────────────────────────
 * `prescription.view`, la misma key de GET /api/prescriptions. La búsqueda en
 * el catálogo va con la misma key: es la que ya filtra a quién le tiene
 * sentido preguntar por medicamentos (SUPER_ADMIN, ADMIN, DOCTOR).
 */

import { z } from "zod";
import {
  dbDe,
  definirHerramienta,
  fraseRecorte,
  pacienteVisibleYActivo,
  plural,
  recortar,
  TOPE_FILAS,
  type Lista,
} from "./base";
import type { SabinaCtx } from "../tipos";

// 🔴 SIN `.refine()` a propósito: un `ZodEffects` encima del objeto le quita el
// `.shape` que `punta-a-punta.test.ts` usa para comprobar que cada parámetro
// del zod llega al modelo. La exclusividad de los dos modos se valida a mano
// en `ejecutar` (mismo patrón que `resolverRango`, que lanza en vez de refinar).
const parametros = z.object({
  /** Paciente a consultar. Resuélvelo ANTES con buscar_paciente: nunca lo inventes. */
  patientId: z.string().min(1).optional(),
  /** Texto para buscar en el catálogo CUMS por nombre o clave. */
  buscarMedicamento: z.string().min(2).max(100).optional(),
});

export type ParamsRecetas = z.infer<typeof parametros>;

/** I=1 … VI=6; sin grupo o grupo desconocido = 99 (no controlado). Menor = más restrictivo. */
function rangoGrupo(g: string | null | undefined): number {
  const m: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  return m[(g ?? "").trim().toUpperCase()] ?? 99;
}
function letraDeRango(r: number): string {
  return ["", "I", "II", "III", "IV", "V", "VI"][r] ?? "?";
}

/** El máximo legal del catálogo, misma fórmula que `expiresForCofeprisGroup` del endpoint. `null` si no es I/II/III. */
function vigenciaMaximaLegal(issuedAt: Date, rango: number): Date | null {
  if (rango > 3) return null;
  const out = new Date(issuedAt);
  if (rango === 1) out.setHours(out.getHours() + 24);
  else if (rango === 2) out.setDate(out.getDate() + 30);
  else out.setDate(out.getDate() + 90);
  return out;
}

function fechaCorta(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface RecetaFila {
  /** "Amoxicilina 500mg (cada 8h por 7 días); Ibuprofeno 400mg (cada 8h)". */
  medicamentos: string;
  fecha: string;
  estado: "vigente" | "vencida" | "anulada";
  /** Según el catálogo REAL (CumsItem), no el campo que manda el cliente. */
  controlado: boolean;
  /** `false` = el campo guardado es más laxo que el máximo legal del catálogo; usa `aviso`, no `fecha`. */
  vigenciaConfiable: boolean;
  aviso?: string;
  enlacePdf: string;
}

export interface CumsFila {
  clave: string;
  nombre: string;
  presentacion: string;
  grupoTerapeutico: string | null;
  /** Grupo COFEPRIS real del catálogo. `null` = no controlado. */
  cofeprisGroup: string | null;
  controlado: boolean;
}

export interface DatosRecetas {
  modo: "paciente" | "catalogo";
  recetas?: Lista<RecetaFila>;
  medicamentos?: Lista<CumsFila>;
}

function construirFilaReceta(
  rx: any,
  itemsRx: any[],
  cumsPorClave: Record<string, any>,
  ahora: Date,
): RecetaFila {
  const nombres = itemsRx.map((it) => {
    const c = cumsPorClave[it.cumsKey];
    const nombre = c?.descripcion ?? it.cumsKey;
    return `${nombre} (${it.dosage})`;
  });

  const rango = itemsRx.reduce((peor, it) => {
    const c = cumsPorClave[it.cumsKey];
    return Math.min(peor, rangoGrupo(c?.cofeprisGroup));
  }, 99);
  const controlado = rango <= 3;
  const maxLegal = controlado ? vigenciaMaximaLegal(rx.issuedAt, rango) : null;

  let vigenciaConfiable = true;
  let aviso: string | undefined;
  let venceEl: Date | null = rx.expiresAt ?? null;

  if (maxLegal && (!rx.expiresAt || rx.expiresAt.getTime() > maxLegal.getTime())) {
    vigenciaConfiable = false;
    venceEl = maxLegal;
    aviso =
      `Es un controlado grupo ${letraDeRango(rango)} según el catálogo; el máximo legal es hasta el ` +
      `${fechaCorta(maxLegal)}. El sistema tiene guardada otra fecha` +
      (rx.expiresAt ? ` (${fechaCorta(rx.expiresAt)})` : " (sin fecha)") +
      `, pero no la repitas como si fuera vigente: trátala como vencida el ${fechaCorta(maxLegal)}.`;
  }

  const estado: RecetaFila["estado"] =
    rx.status === "VOIDED" ? "anulada" : venceEl && venceEl.getTime() < ahora.getTime() ? "vencida" : "vigente";

  return {
    medicamentos: nombres.join("; "),
    fecha: fechaCorta(rx.issuedAt),
    estado,
    controlado,
    vigenciaConfiable,
    aviso,
    enlacePdf: `/api/prescriptions/${rx.id}/pdf`,
  };
}

export const recetas = definirHerramienta<ParamsRecetas, DatosRecetas>({
  nombre: "recetas",
  descripcion:
    "Con patientId: las recetas de un paciente (vigentes, vencidas o anuladas), con quién es " +
    "medicamento controlado según el catálogo real. Con buscarMedicamento: busca en el catálogo CUMS " +
    "por nombre o clave, para saber si algo es controlado antes de recetar. Manda solo uno de los dos. " +
    "Nunca crea, firma ni anula recetas: eso lo hace el doctor en su pantalla.",
  parametros,
  permiso: "prescription.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosRecetas> {
    if (Boolean(params.patientId) === Boolean(params.buscarMedicamento)) {
      throw new Error(
        "parametros_invalidos: manda patientId (recetas del paciente) O buscarMedicamento (catálogo), no los dos ni ninguno",
      );
    }
    const db = dbDe(ctx);

    if (params.buscarMedicamento) {
      const texto = params.buscarMedicamento.trim();
      const where = {
        OR: [
          { clave: { contains: texto, mode: "insensitive" } },
          { descripcion: { contains: texto, mode: "insensitive" } },
        ],
      };
      const [total, crudos] = await Promise.all([
        db.cumsItem.count({ where }),
        db.cumsItem.findMany({ where, orderBy: { descripcion: "asc" }, take: TOPE_FILAS }),
      ]);
      const medicamentos: CumsFila[] = crudos.map((c: any) => ({
        clave: c.clave,
        nombre: c.descripcion,
        presentacion: c.presentacion,
        grupoTerapeutico: c.grupoTerapeutico ?? null,
        cofeprisGroup: c.cofeprisGroup ?? null,
        controlado: rangoGrupo(c.cofeprisGroup) <= 3,
      }));
      return { modo: "catalogo", medicamentos: recortar(medicamentos, total) };
    }

    const patientId = params.patientId!;
    const activo = await pacienteVisibleYActivo(ctx, patientId);
    if (!activo) return { modo: "paciente", recetas: recortar<RecetaFila>([], 0) };

    const [total, crudas] = await Promise.all([
      db.prescription.count({ where: { clinicId: ctx.clinicId, patientId } }),
      db.prescription.findMany({
        where: { clinicId: ctx.clinicId, patientId },
        orderBy: { issuedAt: "desc" },
        take: TOPE_FILAS,
      }),
    ]);

    const ids = crudas.map((rx: any) => rx.id);
    const items = ids.length ? await db.prescriptionItem.findMany({ where: { prescriptionId: { in: ids } } }) : [];
    const claves = Array.from(new Set(items.map((it: any) => it.cumsKey)));
    const cums = claves.length ? await db.cumsItem.findMany({ where: { clave: { in: claves } } }) : [];
    const cumsPorClave: Record<string, any> = {};
    for (const c of cums) cumsPorClave[c.clave] = c;

    const ahora = new Date();
    const filas: RecetaFila[] = crudas.map((rx: any) =>
      construirFilaReceta(
        rx,
        items.filter((it: any) => it.prescriptionId === rx.id),
        cumsPorClave,
        ahora,
      ),
    );

    return { modo: "paciente", recetas: recortar(filas, total) };
  },

  vacio: (d) => (d.modo === "catalogo" ? d.medicamentos!.total === 0 : d.recetas!.total === 0),

  resumir(d, params) {
    if (d.modo === "catalogo") {
      const n = d.medicamentos!.total;
      const controlados = d.medicamentos!.filas.filter((m) => m.controlado).length;
      return (
        `${plural(n, "medicamento", "medicamentos")} en el catálogo para "${params.buscarMedicamento}"` +
        (controlados > 0 ? `, ${controlados} controlado(s)` : "") +
        `${fraseRecorte(d.medicamentos!, "medicamentos")}.`
      );
    }
    const l = d.recetas!;
    const vigentes = l.filas.filter((r) => r.estado === "vigente").length;
    const vencidas = l.filas.filter((r) => r.estado === "vencida").length;
    const anuladas = l.filas.filter((r) => r.estado === "anulada").length;
    const dudosas = l.filas.some((r) => !r.vigenciaConfiable);
    return (
      `${plural(l.total, "receta", "recetas")}: ${vigentes} vigente(s), ${vencidas} vencida(s), ${anuladas} anulada(s)` +
      `${fraseRecorte(l, "recetas")}.` +
      (dudosas
        ? " Ojo: alguna es de un controlado y su vigencia guardada no cuadra con el máximo legal; usa el aviso de esa receta, no su fecha."
        : "")
    );
  },
});
