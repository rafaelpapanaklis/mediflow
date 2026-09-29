// ═══════════════════════════════════════════════════════════════════════════
// PRIMEROS PASOS del módulo de Ortodoncia (ws1-t5, 28-sep-2026) — fila 29 del
// mapa de conexiones de la revisión de lógica de uso: «después de pagar, la
// clínica entra a un Tablero vacío».
//
// Qué le falta a la clínica para estrenar el módulo, en el orden en que tiene
// sentido hacerlo. Puro, sin I/O: recibe lo que ya se sabe de la clínica y
// devuelve los pasos con su «hecho». La carga vive en `primeros-pasos-db.ts`;
// los mismos títulos van en el correo «Módulo activado».
//
//   npx tsx --test src/lib/orthodontics/__tests__/primeros-pasos.test.ts
// ═══════════════════════════════════════════════════════════════════════════

import type { OrthoBillingMode } from "./billing-mode";

export const RUTA_CONFIGURACION_ORTODONCIA = "/dashboard/orthodontics/configuracion";
export const RUTA_PACIENTES_ORTODONCIA = "/dashboard/orthodontics/pacientes";

export type ClavePrimerPaso = "modo-de-cobro" | "primer-caso" | "plan-de-pago";

export interface EstadoPrimerosPasos {
  /** La clínica ya guardó su Configuración de Ortodoncia al menos una vez. */
  configuracionGuardada: boolean;
  /** Modo de cobro de la clínica (el de fábrica si no ha guardado nada). */
  modoDeCobro: OrthoBillingMode;
  /** Casos de ortodoncia de la clínica, en cualquier estado. */
  casos: number;
  /** De esos, los que ya tienen su plan de pago abierto (factura ligada). */
  casosConPlanDePago: number;
}

export interface PrimerPaso {
  clave: ClavePrimerPaso;
  titulo: string;
  detalle: string;
  /** A dónde lleva el paso. */
  href: string;
  /** Texto del enlace. */
  accion: string;
  hecho: boolean;
}

export interface PrimerosPasos {
  pasos: PrimerPaso[];
  hechos: number;
  total: number;
  /** Todo hecho: el bloque ya no se enseña. */
  completo: boolean;
  /** El primer paso sin hacer, para resaltarlo. `null` si no queda ninguno. */
  siguiente: ClavePrimerPaso | null;
}

/**
 * Los pasos, en orden. El plan de pago solo existe en «Precio total a
 * plazos»: en «Pago por control» cada control se cobra aparte y no hay plan
 * que abrir, así que ese paso no se pide.
 */
export function primerosPasosOrtodoncia(e: EstadoPrimerosPasos): PrimerosPasos {
  const pasos: PrimerPaso[] = [
    {
      clave: "modo-de-cobro",
      titulo: "Elige cómo cobras la ortodoncia",
      detalle:
        "Precio total a plazos (enganche y mensualidades) o pago por control. Es el modo con el que nace cada caso nuevo; al abrir un caso puedes elegir el otro.",
      href: RUTA_CONFIGURACION_ORTODONCIA,
      accion: "Ir a Configuración",
      hecho: e.configuracionGuardada,
    },
    {
      clave: "primer-caso",
      titulo: "Abre tu primer caso",
      detalle: "Busca al paciente y ábrele su caso de ortodoncia: diagnóstico, aparatología y duración estimada.",
      href: RUTA_PACIENTES_ORTODONCIA,
      accion: "Ir a Casos",
      hecho: e.casos > 0,
    },
  ];

  if (e.modoDeCobro === "PRECIO_TOTAL") {
    pasos.push({
      clave: "plan-de-pago",
      titulo: "Abre el plan de pago del caso",
      detalle: "Desde la ficha del paciente, en Ortodoncia → Cobro: enganche, número de mensualidades y día de pago. Con eso el módulo ya sabe qué se debe y cuándo.",
      href: RUTA_PACIENTES_ORTODONCIA,
      accion: "Ir a Casos",
      hecho: e.casosConPlanDePago > 0,
    });
  }

  const hechos = pasos.filter((p) => p.hecho).length;
  return {
    pasos,
    hechos,
    total: pasos.length,
    completo: hechos === pasos.length,
    siguiente: pasos.find((p) => !p.hecho)?.clave ?? null,
  };
}

/** Los títulos para el correo «Módulo activado» (clínica recién contratada, modo de fábrica). */
export function titulosPrimerosPasos(modoDeCobro: OrthoBillingMode = "PRECIO_TOTAL"): string[] {
  return primerosPasosOrtodoncia({
    configuracionGuardada: false,
    modoDeCobro,
    casos: 0,
    casosConPlanDePago: 0,
  }).pasos.map((p) => p.titulo);
}
