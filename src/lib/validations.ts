import { z } from "zod";

export const registerSchema = z.object({
  firstName:  z.string().min(2),
  lastName:   z.string().min(2),
  email:      z.string().email(),
  password:   z.string().min(8),
  clinicName: z.string().min(2),
  specialty:  z.string().min(1),
  country:    z.string().min(1),
  city:       z.string().optional(),
  phone:      z.string().optional(),
  plan:       z.enum(["BASIC","PRO","CLINIC"]).default("PRO"),
});

export const patientSchema = z.object({
  firstName:          z.string().min(2),
  lastName:           z.string().min(2),
  email:              z.string().email().optional().or(z.literal("")),
  phone:              z.string().optional(),
  dob:                z.string().optional(),
  gender:             z.enum(["M","F","OTHER"]).default("OTHER"),
  bloodType:          z.string().optional(),
  address:            z.string().optional(),
  insuranceProvider:  z.string().optional(),
  insurancePolicy:    z.string().optional(),
  allergies:          z.array(z.string()).default([]),
  chronicConditions:  z.array(z.string()).default([]),
  currentMedications: z.array(z.string()).default([]),
  tags:               z.array(z.string()).default([]),
  notes:              z.string().optional(),
  // NOM-024 identificación
  curp:               z.string().max(18).optional().nullable(),
  curpStatus:         z.enum(["COMPLETE","PENDING","FOREIGN"]).optional(),
  passportNo:         z.string().max(20).optional().nullable(),
  // NOM-004 antecedentes
  familyHistory:                   z.string().optional().nullable(),
  personalNonPathologicalHistory:  z.string().optional().nullable(),
});

export const appointmentSchema = z.object({
  patientId:    z.string().min(1),
  doctorId:     z.string().min(1),
  type:         z.string().min(1),
  date:         z.string().min(1),
  startTime:    z.string().min(1),
  endTime:      z.string().min(1),
  durationMins: z.number().default(30),
  room:         z.string().optional(),
  notes:        z.string().optional(),
});

export const invoiceSchema = z.object({
  patientId:     z.string().min(1),
  appointmentId: z.string().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    quantity:    z.number().min(1),
    unitPrice:   z.number().min(0),
    total:       z.number(),
  })).min(1),
  discount:      z.number().default(0),
  paymentMethod: z.string().optional(),
  notes:         z.string().optional(),
  dueDate:       z.string().optional(),
});

export type RegisterInput    = z.infer<typeof registerSchema>;
export type PatientInput     = z.infer<typeof patientSchema>;
export type AppointmentInput = z.infer<typeof appointmentSchema>;
export type InvoiceInput     = z.infer<typeof invoiceSchema>;
