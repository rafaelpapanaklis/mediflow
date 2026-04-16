import { getCurrentUser, getUserClinics } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { QuickActionsBar } from "@/components/dashboard/quick-actions";
import { TodayStrip } from "@/components/dashboard/today-strip";
import { prisma } from "@/lib/prisma";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const clinic = user.clinic;
  const allClinics = await getUserClinics();
  const isSuspended = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const isDoctor   = user.role === "DOCTOR";

  const [
    todayAppts,
    doctorCount,
    patientCount,
    apptCount,
    recordCount,
    invoiceCount,
    scheduleCount,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId: clinic.id,
        date: { gte: todayStart, lte: todayEnd },
        status: { notIn: ["CANCELLED"] },
        ...(isDoctor ? { doctorId: user.id } : {}),
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true, color: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.user.count({ where: { clinicId: clinic.id, role: "DOCTOR" } }),
    prisma.patient.count({ where: { clinicId: clinic.id } }),
    prisma.appointment.count({ where: { clinicId: clinic.id } }),
    prisma.medicalRecord.count({ where: { clinicId: clinic.id } }),
    prisma.invoice.count({ where: { clinicId: clinic.id } }),
    prisma.clinicSchedule.count({ where: { clinicId: clinic.id } }),
  ]);

  const onboardingCompleted: string[] = [];
  if (doctorCount   > 0) onboardingCompleted.push("doctor");
  if (scheduleCount > 0) onboardingCompleted.push("schedule");
  if (patientCount  > 0) onboardingCompleted.push("patient");
  if (apptCount     > 0) onboardingCompleted.push("appointment");
  if (recordCount   > 0) onboardingCompleted.push("record");
  if (invoiceCount  > 0) onboardingCompleted.push("invoice");
  if (clinic.waConnected) onboardingCompleted.push("whatsapp");

  const serializedAppts = todayAppts.map((a) => ({
    id: a.id, type: a.type, startTime: a.startTime, endTime: a.endTime,
    durationMins: a.durationMins, status: a.status, notes: a.notes,
    patient: a.patient, doctor: a.doctor as any,
  }));

  return (
    <div className="dashboard-shell flex min-h-screen bg-background font-sans">
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
        <div className="border-b border-border bg-card pt-16 lg:pt-0">
          <div className="px-4 pt-3 lg:px-6 lg:pt-4">
            <QuickActionsBar
              currentUserId={user.id}
              clinicId={clinic.id}
              isAdmin={user.role === "ADMIN" || user.role === "SUPER_ADMIN"}
            />
          </div>
          <div className="px-4 pb-3 lg:px-6 lg:pb-4">
            <TodayStrip initialAppts={serializedAppts} />
          </div>
        </div>
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
