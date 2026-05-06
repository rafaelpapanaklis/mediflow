/**
 * Helpers para órdenes de laboratorio cross-modulo (LabOrder).
 *
 * El schema base tiene `LabOrderType` enum con valores genéricos
 * (`custom_abutment`, `crown`, `surgical_guide`, `ortho_appliance`, etc).
 * Para implantes usamos discriminadores adicionales en `spec.implantOrderSubtype`
 * para casos donde el enum no granulariza (atornillada vs cementada).
 */
import { z } from "zod";
import type { LabOrderStatus, LabOrderType } from "./types";
import {
  IMPLANT_LAB_ORDER_SUBTYPES,
  type ImplantLabOrderSubtype,
  implantSubtypeToLabOrderType,
} from "./types";

// ── Specs por subtipo de implante ──────────────────────────────────

export const pilarPersonalizadoSpecsSchema = z.object({
  implantOrderSubtype: z.literal("pilar_personalizado"),
  implantBrand: z.string().min(1),
  implantPlatform: z.string().min(1),
  implantDiameterMm: z.number().min(2).max(8),
  abutmentMaterial: z.enum(["TITANIO", "ZIRCONIO", "TITANIO_ZIRCONIO"]),
  emergenceProfile: z.enum(["RECTO", "CONCAVO", "CONVEXO"]),
  mucosalHeightMm: z.number().min(0).max(10),
  angulationDeg: z.number().min(0).max(30),
  finishLineHeightMm: z.number().min(0).max(5),
  shade: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const protesisAtornilladaSpecsSchema = z.object({
  implantOrderSubtype: z.literal("protesis_atornillada"),
  implantBrand: z.string().min(1),
  implantPlatform: z.string().min(1),
  abutmentLot: z.string().min(1),
  prosthesisMaterial: z.enum([
    "ZIRCONIA_MONOLITHIC",
    "PORCELAIN_FUSED_TO_ZIRCONIA",
    "PORCELAIN_FUSED_TO_METAL",
    "LITHIUM_DISILICATE",
  ]),
  shade: z.string().min(1),
  occlusionScheme: z.enum([
    "CONTACTO_LIGERO",
    "PROTECCION_CANINA",
    "FUNCION_GRUPAL",
    "CONTACTO_CENTRICO",
  ]),
  contactProximal: z.enum(["LIGERO", "FIRME"]).optional(),
  screwTorqueNcmTarget: z.number().int().min(15).max(45),
  notes: z.string().max(1000).optional(),
});

export const protesisCementadaSpecsSchema = z.object({
  implantOrderSubtype: z.literal("protesis_cementada"),
  implantBrand: z.string().min(1),
  abutmentLot: z.string().min(1),
  cementType: z.enum(["TEMPORAL", "PERMANENTE_RESINA", "PERMANENTE_FOSFATO"]),
  prosthesisMaterial: z.enum([
    "ZIRCONIA_MONOLITHIC",
    "PORCELAIN_FUSED_TO_ZIRCONIA",
    "PORCELAIN_FUSED_TO_METAL",
    "LITHIUM_DISILICATE",
  ]),
  shade: z.string().min(1),
  marginType: z.enum(["SUPRAGINGIVAL", "EQUIGINGIVAL", "SUBGINGIVAL"]),
  occlusionScheme: z.enum([
    "CONTACTO_LIGERO",
    "PROTECCION_CANINA",
    "FUNCION_GRUPAL",
    "CONTACTO_CENTRICO",
  ]),
  notes: z.string().max(1000).optional(),
});

export const guiaQuirurgicaSpecsSchema = z.object({
  implantOrderSubtype: z.literal("guia_quirurgica"),
  implantBrand: z.string().min(1),
  implantPlatform: z.string().min(1),
  guideType: z.enum([
    "TOOTH_SUPPORTED",
    "MUCOSA_SUPPORTED",
    "BONE_SUPPORTED",
    "PIN_SUPPORTED",
  ]),
  drillKit: z.string().min(1),
  fullyGuided: z.boolean(),
  cbctReference: z.string().optional(),
  stlReference: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const modeloEstudioDigitalSpecsSchema = z.object({
  implantOrderSubtype: z.literal("modelo_estudio_digital"),
  scanner: z.string().min(1),
  fileFormat: z.enum(["STL", "PLY", "OBJ", "DCM"]),
  arches: z.enum(["UPPER", "LOWER", "BOTH"]),
  bite: z.boolean().default(false),
  articulationType: z.enum(["NONE", "MOUNTED", "VIRTUAL"]),
  scanFileRef: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const implantLabOrderSpecsSchema = z.discriminatedUnion(
  "implantOrderSubtype",
  [
    pilarPersonalizadoSpecsSchema,
    protesisAtornilladaSpecsSchema,
    protesisCementadaSpecsSchema,
    guiaQuirurgicaSpecsSchema,
    modeloEstudioDigitalSpecsSchema,
  ],
);

export type ImplantLabOrderSpecs = z.infer<typeof implantLabOrderSpecsSchema>;

export function validateImplantLabSpecs(specs: unknown): ImplantLabOrderSpecs {
  return implantLabOrderSpecsSchema.parse(specs);
}

// ── Schema de creación ──────────────────────────────────────────────

export const labOrderCreateSchema = z.object({
  patientId: z.string().min(1),
  module: z.enum([
    "pediatrics",
    "endodontics",
    "periodontics",
    "implants",
    "orthodontics",
  ]),
  partnerId: z.string().nullable().optional(),
  orderType: z.enum([
    "post_core",
    "surgical_guide",
    "custom_abutment",
    "crown",
    "ortho_appliance",
    "retainer",
    "ped_space_maintainer_lab",
    "other",
  ]),
  spec: z.unknown(),
  toothFdi: z.number().int().min(11).max(85).nullable().optional(),
  shadeGuide: z.string().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type LabOrderCreateInput = z.infer<typeof labOrderCreateSchema>;

/**
 * Para una orden implantológica, valida que `spec` cumpla el schema
 * discriminado por `implantOrderSubtype` y que el `orderType` sea
 * compatible con el subtype.
 */
export function parseImplantLabOrderInput(input: unknown): {
  base: LabOrderCreateInput;
  subtype: ImplantLabOrderSubtype;
  spec: ImplantLabOrderSpecs;
} {
  const base = labOrderCreateSchema.parse(input);
  if (base.module !== "implants") {
    throw new Error("parseImplantLabOrderInput requiere module=implants");
  }
  const spec = validateImplantLabSpecs(base.spec);
  const expectedOrderType = implantSubtypeToLabOrderType(spec.implantOrderSubtype);
  if (base.orderType !== expectedOrderType) {
    throw new Error(
      `orderType=${base.orderType} no coincide con subtype=${spec.implantOrderSubtype} (esperado ${expectedOrderType})`,
    );
  }
  return { base, subtype: spec.implantOrderSubtype, spec };
}

// ── Etiquetas en español ────────────────────────────────────────────

export function labOrderStatusLabel(status: LabOrderStatus): string {
  switch (status) {
    case "draft":
      return "Borrador";
    case "sent":
      return "Enviada";
    case "in_progress":
      return "En proceso";
    case "received":
      return "Recibida";
    case "cancelled":
      return "Cancelada";
    default:
      return status;
  }
}

export function implantLabOrderSubtypeLabel(s: ImplantLabOrderSubtype): string {
  switch (s) {
    case "pilar_personalizado":
      return "Pilar personalizado";
    case "protesis_atornillada":
      return "Prótesis atornillada";
    case "protesis_cementada":
      return "Prótesis cementada";
    case "guia_quirurgica":
      return "Guía quirúrgica";
    case "modelo_estudio_digital":
      return "Modelo de estudio digital";
    default:
      return s;
  }
}

export function labOrderTypeLabel(t: LabOrderType): string {
  switch (t) {
    case "post_core":
      return "Poste y muñón";
    case "surgical_guide":
      return "Guía quirúrgica";
    case "custom_abutment":
      return "Pilar personalizado";
    case "crown":
      return "Corona";
    case "ortho_appliance":
      return "Aparatología ortodóncica";
    case "retainer":
      return "Retenedor";
    case "ped_space_maintainer_lab":
      return "Mantenedor de espacio";
    case "other":
      return "Otro";
    default:
      return t;
  }
}

// ── Máquina de estados ──────────────────────────────────────────────

export function isLabOrderTerminal(status: LabOrderStatus): boolean {
  return status === "received" || status === "cancelled";
}

export function nextLabOrderStatuses(
  current: LabOrderStatus,
): LabOrderStatus[] {
  switch (current) {
    case "draft":
      return ["sent", "cancelled"];
    case "sent":
      return ["in_progress", "received", "cancelled"];
    case "in_progress":
      return ["received", "cancelled"];
    case "received":
    case "cancelled":
      return [];
    default:
      return [];
  }
}

export function canTransitionLabOrder(
  from: LabOrderStatus,
  to: LabOrderStatus,
): boolean {
  return nextLabOrderStatuses(from).includes(to);
}

export { IMPLANT_LAB_ORDER_SUBTYPES };
