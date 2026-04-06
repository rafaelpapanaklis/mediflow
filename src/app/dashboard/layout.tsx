import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { QuickActionsBar } from "@/components/dashboard/quick-actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user   = await getCurrentUser();
  const clinic = user.clinic;
  const isSuspended = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

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
      />
      <div className="flex-1 flex flex-col min-h-screen lg:max-h-screen lg:overflow-y-auto">
        {isSuspended && (
          <div className="bg-rose-600 text-white text-sm font-bold px-4 py-2.5 text-center flex-shrink-0">
            ⚠️ Tu suscripción ha vencido.{" "}
            <a href="/dashboard/suspended" className="underline hover:no-underline">Ver opciones de pago →</a>
          </div>
        )}
        <main className="flex-1 p-5 lg:p-6 pt-16 lg:pt-6">
          {/* Quick actions bar - visible on all pages */}
          <QuickActionsBar
            currentUserId={user.id}
            clinicId={user.clinicId}
            isAdmin={isAdmin}
          />
          {children}
        </main>
      </div>
    </div>
  );
}
