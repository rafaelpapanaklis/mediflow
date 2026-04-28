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

  if (role === "RECEPTIONIST") {
    const data = await fetchReceptionistData();
    return (
      <HomeShell>
        <HomeReceptionist user={homeUser} clinic={homeClinic} data={data} />
      </HomeShell>
    );
  }

  if (role === "DOCTOR") {
    const data = await fetchDoctorData();
    return (
      <HomeShell>
        <HomeDoctor user={homeUser} clinic={homeClinic} data={data} />
      </HomeShell>
    );
  }

  const isAdminLike =
    role === "ADMIN" || role === "SUPER_ADMIN";

  if (isAdminLike) {
    const hybridCheck = await fetchHybridRoleCheck();

    const adminData = await fetchAdminData(period);
    const doctorData = hybridCheck.canBeDoctor ? await fetchDoctorData() : null;

    return (
      <HomeShell>
        <HomeClientSwitch
          user={homeUser}
          clinic={homeClinic}
          adminContent={
            <HomeAdmin user={homeUser} clinic={homeClinic} data={adminData} period={period} />
          }
          doctorContent={
            doctorData ? (
              <HomeDoctor user={homeUser} clinic={homeClinic} data={doctorData} />
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
      <HomeAdmin user={homeUser} clinic={homeClinic} data={adminData} period={period} />
    </HomeShell>
  );
}

function isValidPeriod(p?: string): boolean {
  return p === "day" || p === "month" || p === "quarter" || p === "year";
}
