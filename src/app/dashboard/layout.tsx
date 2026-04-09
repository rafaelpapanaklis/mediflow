import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user   = await getCurrentUser();
  const clinic = user.clinic;
  const isSuspended = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();

  // Onboarding: check which steps are completed
  const [hasDoctor, hasPatient, hasAppt, hasRecord, hasInvoice] = await Promise.all([
    prisma.user.count({ where: { clinicId: user.clinicId, role: "DOCTOR" } }),
    prisma.patient.count({ where: { clinicId: user.clinicId } }),
    prisma.appointment.count({ where: { clinicId: user.clinicId } }),
    prisma.medicalRecord.count({ where: { clinicId: user.clinicId } }),
    prisma.invoice.count({ where: { clinicId: user.clinicId } }),
  ]);

  const completedSteps = [
    ...(hasDoctor > 0           ? ["doctor"]      : []),
    // schedule: checked separately to avoid extra query in layout
    ...(hasPatient > 0          ? ["patient"]     : []),
    ...(hasAppt > 0             ? ["appointment"] : []),
    ...(hasRecord > 0           ? ["record"]      : []),
    ...(hasInvoice > 0          ? ["invoice"]     : []),
    ...(clinic.waConnected      ? ["whatsapp"]    : []),
  ];

  return (
    <div className="flex min-h-screen bg-background font-sans">
      <Sidebar
        user={{
          firstName: user.firstName,
          lastName:  user.lastName,
          email:     user.email,
          role:      user.role,
          color:     user.color ?? "#7c3aed",
        }}
        clinicName={clinic.name}
        plan={clinic.plan}
        onboardingSlot={
          <div className="px-3 pb-3">
            <OnboardingChecklist completed={completedSteps} clinicId={user.clinicId} />
          </div>
        }
      />
      <div className="flex-1 flex flex-col min-h-screen lg:max-h-screen lg:overflow-y-auto">
        {isSuspended && (
          <div className="bg-rose-600 text-white text-sm font-bold px-4 py-2.5 text-center flex-shrink-0">
            ⚠️ Tu suscripción ha vencido.{" "}
            <a href="/dashboard/suspended" className="underline hover:no-underline">Ver opciones de pago →</a>
          </div>
        )}
        <main className="flex-1 p-5 lg:p-6 pt-16 lg:pt-6">{children}</main>
      </div>
    </div>
  );
}
