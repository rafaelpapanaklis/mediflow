/**
 * Single source of truth para los planes de suscripción de la
 * plataforma MediFlow.
 *
 * Los precios viven aquí (no en una tabla todavía) para evitar que el
 * cliente y el endpoint /api/billing/checkout puedan diferir. Si en el
 * futuro se quiere precios dinámicos por clínica/cupón, se mueve a una
 * tabla pero el módulo se mantiene como fachada.
 */

export const PLAN_IDS = ["BASIC", "PRO", "CLINIC"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDescriptor {
  id: PlanId;
  name: string;
  priceMxn: number;
  features: string[];
}

export const PLANS: ReadonlyArray<PlanDescriptor> = [
  {
    id: "BASIC",
    name: "Básico",
    priceMxn: 99,
    features: ["1 profesional", "200 pacientes", "Agenda", "Facturación"],
  },
  {
    id: "PRO",
    name: "Profesional",
    priceMxn: 179,
    features: ["3 profesionales", "Ilimitado", "Expedientes", "Reportes"],
  },
  {
    id: "CLINIC",
    name: "Clínica",
    priceMxn: 249,
    features: ["Todo ilimitado", "Multi-sucursal", "API", "Manager"],
  },
];

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

export function getPlan(id: PlanId): PlanDescriptor {
  const p = PLANS.find((x) => x.id === id);
  if (!p) throw new Error(`Plan no encontrado: ${id}`);
  return p;
}
