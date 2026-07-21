// src/app/dashboard/page.tsx
import { getCurrentUser } from "@/lib/auth";
import {
  fetchReceptionistData,
  fetchDoctorData,
  fetchAdminData,
  fetchHybridRoleCheck,
} from "@/lib/home/fetchers";
import { HomeShell } from "@/components/dashboard/home/home-shell";
import { HomeReceptionist } from "@/components/dashboard/home/home-receptionist";
import { HomeDoctor } from "@/components/dashboard/home/home-doctor";
import { HomeAdmin } from "@/components/dashboard/home/home-admin";
import { HomeClientSwitch } from "./home-client-switch";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { getOnboardingCompleted } from "@/lib/onboarding-steps-server";

export const dynamic = "force-dynamic";

type AdminPeriod = "day" | "month" | "quarter" | "year";

interface PageProps {
  searchParams?: { period?: string; mode?: string };
}

export default async function DashboardHomePage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  const clinic = user.clinic;
  if (!user || !clinic) return null;

  const displayName =
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
    user.email ||
    "";
  const homeUser = { displayName, role: user.role };
  const homeClinic = { name: clinic.name };

  const role = user.role;
  const period: AdminPeriod = isValidPeriod(searchParams?.period)
    ? (searchParams!.period as AdminPeriod)
    : "month";

  // MULTI-CLÍNICA: `key={clinic.id}` en cada vista del home. Al cambiar de
  // sucursal el server ya re-renderiza con los datos correctos, pero React
  // REUTILIZA los componentes cliente y conserva su estado interno — la
  // gráfica de ingresos (useState(initialData) + fetch sólo al montar) seguía
  // pintando la serie de la clínica ANTERIOR mientras los KPIs ya iban en $0.
  // Con la key, el árbol se re-monta al cambiar de clínica y el estado muere.
  if (role === "RECEPTIONIST") {
    const data = await fetchReceptionistData();
    return (
      <HomeShell>
        <HomeReceptionist key={clinic.id} user={homeUser} clinic={homeClinic} data={data} />
      </HomeShell>
    );
  }

  if (role === "DOCTOR") {
    const data = await fetchDoctorData();
    return (
      <HomeShell>
        <HomeDoctor key={clinic.id} user={homeUser} clinic={homeClinic} data={data} />
      </HomeShell>
    );
  }

  const isAdminLike =
    role === "ADMIN" || role === "SUPER_ADMIN";

  if (isAdminLike) {
    // hybridCheck, adminData y el estado de onboarding no dependen entre sí —
    // una sola ronda en paralelo; solo doctorData queda condicionado al check.
    // getOnboardingCompleted ya corrió en el layout (React.cache) ⇒ 0 queries
    // extra aquí: solo alimenta el checklist "Primeros pasos" del home (admins).
    const [hybridCheck, adminData, onboardingCompleted] = await Promise.all([
      fetchHybridRoleCheck(),
      fetchAdminData(period),
      getOnboardingCompleted(clinic.id, clinic.waConnected),
    ]);
    const doctorData = hybridCheck.canBeDoctor ? await fetchDoctorData() : null;

    return (
      <HomeShell>
        {/* Checklist de primeros pasos — solo admins; se auto-oculta al 100%
            o si el usuario lo descartó (localStorage por clinicId). */}
        <OnboardingChecklist completed={onboardingCompleted} clinicId={clinic.id} />
        <HomeClientSwitch
          user={homeUser}
          clinic={homeClinic}
          adminContent={
            <HomeAdmin key={clinic.id} user={homeUser} clinic={homeClinic} data={adminData} period={period} />
          }
          doctorContent={
            doctorData ? (
              <HomeDoctor key={clinic.id} user={homeUser} clinic={homeClinic} data={doctorData} />
            ) : null
          }
          canBeDoctor={hybridCheck.canBeDoctor}
          initialMode={searchParams?.mode === "doctor" ? "doctor" : "admin"}
        />
      </HomeShell>
    );
  }

  const adminData = await fetchAdminData(period);
  return (
    <HomeShell>
      <HomeAdmin key={clinic.id} user={homeUser} clinic={homeClinic} data={adminData} period={period} />
    </HomeShell>
  );
}

function isValidPeriod(p?: string): boolean {
  return p === "day" || p === "month" || p === "quarter" || p === "year";
}
