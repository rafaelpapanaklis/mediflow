export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, getUserClinics } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { GlobalAnnouncementBanner } from "@/components/dashboard/global-announcement-banner";
import { ActiveConsultProvider } from "@/components/dashboard/active-consult-provider";
import { NewAppointmentProvider } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { NewPatientProvider } from "@/components/dashboard/new-patient/new-patient-provider";
import { PatientContextBar } from "@/components/dashboard/patient-context-bar";
import { prisma } from "@/lib/prisma";

const SUSPENDED_PATH = "/dashboard/suspended";
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid"]);

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const clinic = user.clinic;
  const pathname = headers().get("x-pathname") ?? "";

  // ── Bloqueo total cuando el plan/trial expira ────────────────────
  // Una clínica está expirada cuando trialEndsAt < now Y la suscripción
  // no está activa (subscriptionStatus no es active / trialing / paid).
  // Una clínica que paga después del trial limpia subscriptionStatus a
  // 'active' y NO debe bloquearse aunque trialEndsAt siga en el pasado.
  // SUPER_ADMIN nunca se bloquea: administra múltiples clínicas y no
  // queremos atarlo a la salud comercial de una sola.
  const trialEndsAt = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  const now = new Date();
  const subscriptionStatus = (clinic as { subscriptionStatus?: string | null }).subscriptionStatus ?? null;
  const subscriptionActive =
    subscriptionStatus !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
  const trialExpired = !!trialEndsAt && trialEndsAt < now;
  const isExpired = trialExpired && !subscriptionActive;
  const bypassSuspended = user.role === "SUPER_ADMIN";

  // En la pantalla de suspended NO renderizamos sidebar/topbar/banner:
  // la página controla su propio chrome y debe ser bloqueante full-screen.
  // Aplica a cualquiera que llegue ahí (incluso clínicas activas que
  // accidentalmente tipean la URL — verán la pantalla de renovación pero
  // sin perder el panel: pueden volver navegando a /dashboard).
  if (pathname === SUSPENDED_PATH) {
    return <>{children}</>;
  }

  // Cualquier otra ruta de /dashboard/* con clínica expirada se redirige.
  if (isExpired && !bypassSuspended) {
    redirect(SUSPENDED_PATH);
  }

  const isInTrial = !!trialEndsAt && trialEndsAt > now && !subscriptionActive;
  const allClinics = await getUserClinics();

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
    <NewPatientProvider>
    <NewAppointmentProvider>
    {/* Skip link — WCAG 2.4.1 Bypass Blocks. Oculto por defecto, visible
        al recibir focus por teclado para que usuarios de teclado/lectores
        salten la sidebar y la topbar. */}
    <a href="#main-content" className="mf-skip-link">
      Saltar al contenido principal
    </a>
    <div className="dashboard-shell flex min-h-screen font-sans">
      <Sidebar
        user={{
          firstName: user.firstName,
          lastName:  user.lastName,
          email:     user.email,
          role:      user.role,
          color:     user.color ?? "#7c3aed",
          // Prisma user.permissionsOverride es String[] @default([]) en
          // schema; el tipo generado lo expone non-nullable. Sin cast, así
          // el sidebar lo recibe correctamente y filtra los items.
          permissionsOverride: user.permissionsOverride,
        }}
        clinicName={clinic.name}
        clinicId={clinic.id}
        plan={clinic.plan}
        clinicCategory={(clinic as any).category ?? "OTHER"}
        allClinics={allClinics}
        onboardingCompleted={onboardingCompleted}
      />
      <div className="flex min-h-screen flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        <GlobalAnnouncementBanner />
        <Topbar
          clinicName={clinic.name}
          trialEndsAt={isInTrial ? trialEndsAt : null}
          plan={clinic.plan as any}
          userRole={user.role}
        />
        <PatientContextBar />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pt-20 lg:pt-6"
          style={{ padding: "clamp(12px, 1.5vw, 28px)", paddingTop: "clamp(16px, 2vw, 24px)" }}
        >
          {children}
        </main>
      </div>
    </div>
    </NewAppointmentProvider>
    </NewPatientProvider>
    </ActiveConsultProvider>
  );
}
