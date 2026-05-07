// Tipos DTO para Sección F (Finanzas, Open Choice G5, Sign@Home G6).

import type {
  OrthoQuoteScenarioStatus,
  OrthoQuoteScenarioPaymentMode,
  OrthoSignAtHomeStatus,
  OrthoPaymentMethod,
} from "@prisma/client";

export type {
  OrthoQuoteScenarioStatus,
  OrthoQuoteScenarioPaymentMode,
  OrthoSignAtHomeStatus,
  OrthoPaymentMethod,
};

export interface OrthoInstallmentDTO {
  id: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  status: "PENDING" | "PAID" | "OVERDUE" | "WAIVED";
  paidAt: string | null;
  cfdiUuid: string | null;
}

export interface QuoteScenarioDTO {
  id: string;
  label: string;
  paymentMode: OrthoQuoteScenarioPaymentMode;
  downPayment: number;
  monthlyAmount: number;
  monthsCount: number;
  totalAmount: number;
  discountPct: number | null;
  badge: string | null;
  includes: string[];
  status: OrthoQuoteScenarioStatus;
}

export interface SignAtHomePackageDTO {
  id: string;
  token: string;
  expiresAt: string;
  status: OrthoSignAtHomeStatus;
  selectedQuoteScenarioId: string | null;
  downPaymentAmount: number | null;
  cfdiUuid: string | null;
  sentAt: string | null;
  signedAt: string | null;
  paidAt: string | null;
}

export interface CFDIRecordDTO {
  uuid: string;
  date: string;
  amount: number;
  status: "TIMBRADA" | "CANCELADA" | "PENDIENTE";
  /** Etiqueta verbose: "Timbrada · enganche", "Timbrada · mes 5". */
  label: string;
}
