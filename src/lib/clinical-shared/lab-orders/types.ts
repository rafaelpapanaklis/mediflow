// Clinical-shared — tipos para LabOrder + LabPartner.

import type { ClinicalModule, LabOrderStatus, LabOrderType } from "@prisma/client";

export type { ClinicalModule, LabOrderStatus, LabOrderType };

export interface LabOrderDTO {
  id: string;
  module: ClinicalModule;
  partnerId: string | null;
  partnerName: string | null;
  patientId: string;
  orderType: LabOrderType;
  spec: Record<string, unknown>;
  toothFdi: number | null;
  shadeGuide: string | null;
  dueDate: string | null;
  status: LabOrderStatus;
  pdfUrl: string | null;
  notes: string | null;
}

export interface LabPartnerDTO {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

export const LAB_ORDER_TYPE_LABELS: Record<LabOrderType, string> = {
  post_core: "Postes y muñones",
  surgical_guide: "Guía quirúrgica",
  custom_abutment: "Pilar personalizado",
  crown: "Corona / restauración fija",
  ortho_appliance: "Aparato ortodóncico",
  retainer: "Retenedor",
  ped_space_maintainer_lab: "Mantenedor de espacio",
  perio_splint: "Ferulización periodontal",
  perio_custom_graft: "Injerto personalizado",
  perio_maintenance_tray: "Planchas de mantenimiento",
  other: "Otro",
};

export const LAB_ORDER_STATUS_LABELS: Record<LabOrderStatus, string> = {
  draft: "Borrador",
  sent: "Enviada",
  in_progress: "En proceso",
  received: "Recibida",
  cancelled: "Cancelada",
};
