import { getCurrentUser, getUserClinics } from "@/lib/auth";
import { Sidebar }       from "@/components/dashboard/sidebar";
import { QuickActionsBar }  from "@/components/dashboard/quick-actions";
import { TodayStrip }    from "@/components/dashboard/today-strip";
import { prisma }        from "@/lib/prisma";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user   = await getCurrentUser();
  const clinic = user.clinic;
  const allClinics = await getUserClinics();
  const isSuspended = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();

  // Fetch today's appointments for TodayStrip
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
  const isDoctor   = user.role === "DOCTOR";

  const todayAppts = await prisma.appointment.findMany({
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
  });

  const serializedAppts = todayAppts.map(a => ({
    id: a.id, type: a.type, startTime: a.startTime, endTime: a.endTime,
    durationMins: a.durationMins, status: a.status, notes: a.notes,
    patient: a.patient, doctor: a.doctor as any,
  }));

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
        clinicId={clinic.id}
        plan={clinic.plan}
        clinicCategory={(clinic as any).category ?? "OTHER"}
        allClinics={allClinics}
      />
      <div className="flex-1 flex flex-col min-h-screen lg:max-h-screen lg:overflow-y-auto">
        {isSuspended && (
          <div className="bg-rose-600 text-white text-sm font-bold px-4 py-2.5 text-center flex-shrink-0">
            ⚠️ Tu suscripción ha vencido.{" "}
            <a href="/dashboard/suspended" className="underline hover:no-underline">Ver opciones de pago →</a>
          </div>
        )}
        <div className="pt-16 lg:pt-0">
          <div className="px-4 lg:px-6 pt-3 lg:pt-4">
            <QuickActionsBar
              currentUserId={user.id}
              clinicId={clinic.id}
              isAdmin={user.role === "ADMIN" || user.role === "SUPER_ADMIN"}
            />
          </div>
          <div className="px-4 lg:px-6">
            <TodayStrip initialAppts={serializedAppts} />
          </div>
        </div>
        <main className="flex-1 p-5 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
