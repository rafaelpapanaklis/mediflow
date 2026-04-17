export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { OnboardingClient } from "./onboarding-client";

export const metadata: Metadata = { title: "Onboarding — Admin MediFlow" };

const ONBOARDING_STEPS = [
  { id: "doctor",      label: "1. Doctor creado" },
  { id: "schedule",    label: "2. Horario configurado" },
  { id: "patient",     label: "3. Primer paciente" },
  { id: "appointment", label: "4. Primera cita" },
  { id: "record",      label: "5. Primer expediente" },
  { id: "invoice",     label: "6. Primera factura" },
  { id: "whatsapp",    label: "7. WhatsApp conectado" },
] as const;

export default async function OnboardingPage() {
  const clinics = await prisma.clinic.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      waConnected: true,
      _count: {
        select: {
          users:        true,
          patients:     true,
          appointments: true,
          records:      true,
          invoices:     true,
          schedules:    true,
        },
      },
    },
  });

  const rows = clinics.map(c => {
    const doctors   = c._count.users;
    const completed: string[] = [];
    if (doctors > 0)              completed.push("doctor");
    if (c._count.schedules > 0)   completed.push("schedule");
    if (c._count.patients > 0)    completed.push("patient");
    if (c._count.appointments > 0) completed.push("appointment");
    if (c._count.records > 0)     completed.push("record");
    if (c._count.invoices > 0)    completed.push("invoice");
    if (c.waConnected)            completed.push("whatsapp");

    const currentStep = ONBOARDING_STEPS.find(s => !completed.includes(s.id));
    const daysSinceSignup = Math.floor(
      (Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      id:              c.id,
      name:            c.name,
      email:           c.email,
      createdAt:       c.createdAt.toISOString(),
      completedSteps:  completed.length,
      totalSteps:      ONBOARDING_STEPS.length,
      stuckOn:         currentStep ? currentStep.label : null,
      daysSinceSignup,
    };
  });

  return <OnboardingClient rows={rows} steps={ONBOARDING_STEPS as any} />;
}
