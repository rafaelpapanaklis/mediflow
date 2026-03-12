import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans">
      <Sidebar
        user={{ firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role }}
        clinicName={user.clinic.name}
        plan={user.clinic.plan}
      />
      <div className="flex-1 flex flex-col min-h-screen lg:max-h-screen lg:overflow-y-auto">
        <main className="flex-1 p-5 lg:p-6 pt-16 lg:pt-6">
          {children}
        </main>
      </div>
    </div>
  );
}
