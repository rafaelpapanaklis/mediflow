export const dynamic = "force-dynamic";

import { getCurrentUser, getUserClinics } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { GlobalAnnouncementBanner } from "@/components/dashboard/global-announcement-banner";
import { ActiveConsultProvider } from "@/components/dashboard/active-consult-provider";
import { PatientContextBar } from "@/components/dashboard/patient-context-bar";
import { prisma } from "@/lib/prisma";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const clinic = user.clinic;
  const allClinics = await getUserClinics();
  const trialEndsAt = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  const now = new Date();
  const isSuspended = trialEndsAt && trialEndsAt < now;
  // Trial activo = futuro Y sin suscripción activa pagando
  const subscriptionActive =
    (clinic as any).subscriptionStatus === "active" ||
    (clinic as any).subscriptionStatus === "paid";
  const isInTrial = !!trialEndsAt && trialEndsAt > now && !subscriptionActive;

  const counts = await prisma.$queryRaw<[{ doctors: bigint; patients: bigint; appts: bigint; records: bigint; invoices: bigint; schedules: bigint }]>`
    SELECT
      (SELECT COUNT(*) FROM users WHERE "clinicId" = ${clinic.id} AND role = 'DOCTOR') AS doctors,
      (SELECT COUNT(*) FROM patients WHERE "clinicId" = ${clinic.id}) AS patients,
      (SELECT COUNT(*) FROM appointments WHERE "clinicId" = ${clinic.id}) AS appts,
      (SELECT COUNT(*) FROM medical_records WHERE "clinicId" = ${clinic.id}) AS records,
      (SELECT COUNT(*) FROM invoices WHERE "clinicId" = ${clinic.id}) AS invoices,
      (SELECT COUNT(*) FROM clinic_schedules WHERE "clinicId" = ${clinic.id}) AS schedules
  `;

  const c = counts[0];
  const doctorCount   = Number(c.doctors);
  const patientCount  = Number(c.patients);
  const apptCount     = Number(c.appts);
  const recordCount   = Number(c.records);
  const invoiceCount  = Number(c.invoices);
  const scheduleCount = Number(c.schedules);

  const onboardingCompleted: string[] = [];
  if (doctorCount   > 0) onboardingCompleted.push("doctor");
  if (scheduleCount > 0) onboardingCompleted.push("schedule");
  if (patientCount  > 0) onboardingCompleted.push("patient");
  if (apptCount     > 0) onboardingCompleted.push("appointment");
  if (recordCount   > 0) onboardingCompleted.push("record");
  if (invoiceCount  > 0) onboardingCompleted.push("invoice");
  if (clinic.waConnected) onboardingCompleted.push("whatsapp");

  return (
    <ActiveConsultProvider>
    <div className="dashboard-shell flex min-h-screen font-sans">
      <Sidebar
        user={{
          firstName: user.firstName,
          lastName:  user.lastName,
          email:     user.email,
          role:      user.role,
          color:     user.color ?? "#7c3aed",
        }}
        clinicName={clinic.name}
        clinicId={clinic.id}
        plan={clinic.plan}
        clinicCategory={(clinic as any).category ?? "OTHER"}
        allClinics={allClinics}
        onboardingCompleted={onboardingCompleted}
      />
      <div className="flex min-h-screen flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        {isSuspended && (
          <div className="flex-shrink-0 bg-destructive px-4 py-2.5 text-center text-sm font-bold text-destructive-foreground">
            ⚠️ Tu suscripción ha vencido.{" "}
            <a href="/dashboard/suspended" className="underline hover:no-underline">Ver opciones de pago →</a>
          </div>
        )}
        <GlobalAnnouncementBanner />
        <Topbar
          clinicName={clinic.name}
          trialEndsAt={isInTrial ? trialEndsAt : null}
          plan={clinic.plan as any}
        />
        <PatientContextBar />
        <main
          className="flex-1 pt-20 lg:pt-6"
          style={{ padding: "clamp(12px, 1.5vw, 28px)", paddingTop: "clamp(16px, 2vw, 24px)" }}
        >
          {children}
        </main>
      </div>
    </div>
    </ActiveConsultProvider>
  );
}
