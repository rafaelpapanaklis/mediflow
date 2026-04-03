import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const clinic = user.clinic;
  const isSuspended = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < new Date();

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      <Sidebar
        user={{ firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role }}
        clinicName={clinic.name}
        plan={clinic.plan}
      />
      <div className="flex-1 flex flex-col min-h-screen lg:max-h-screen lg:overflow-y-auto">
        {isSuspended && (
          <div className="bg-rose-600 text-white text-xs font-bold px-4 py-2.5 text-center flex items-center justify-center gap-2 flex-shrink-0">
            ⚠️ Tu suscripción ha vencido. El acceso a nuevas funciones está limitado.{" "}
            <a href="/dashboard/suspended" className="underline hover:no-underline">Ver opciones de pago →</a>
          </div>
        )}
        <main className="flex-1 p-5 lg:p-6 pt-16 lg:pt-6">{children}</main>
      </div>
    </div>
  );
}
