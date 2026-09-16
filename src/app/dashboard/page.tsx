// src/app/dashboard/page.tsx
import { getCurrentUser } from "@/lib/auth";
import {
  fetchReceptionistData,
  fetchDoctorData,
  fetchAdminData,
  fetchHybridRoleCheck,
} from "@/lib/home/fetchers";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { HomeShell } from "@/components/dashboard/home/home-shell";
import { HomeReceptionist } from "@/components/dashboard/home/home-receptionist";
import { HomeDoctor } from "@/components/dashboard/home/home-doctor";
import { HomeAdmin } from "@/components/dashboard/home/home-admin";
import { RaizHoy } from "@/components/dashboard/hoy-rediseno/raiz";
import { HoyRecepcion } from "@/components/dashboard/hoy-rediseno/hoy-recepcion";
import { HoyDoctor } from "@/components/dashboard/hoy-rediseno/hoy-doctor";
import { HoyAdmin } from "@/components/dashboard/hoy-rediseno/hoy-admin";
import { HomeClientSwitch } from "./home-client-switch";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { AiQuotaBanner } from "@/components/dashboard/ai-quota-banner";
import { getOnboardingCompleted } from "@/lib/onboarding-steps-server";

export const dynamic = "force-dynamic";

type AdminPeriod = "day" | "month" | "quarter" | "year";

interface PageProps {
  searchParams?: { period?: string; mode?: string };
}

// REDISEÑO DE «HOY» — el MISMO interruptor por clínica que enciende el menú de
// dos niveles, Pacientes y la Agenda (`clinic_feature_flags`, bandera
// `menu-dos-niveles`), no uno propio: Rafael prueba «el diseño nuevo» como una
// sola cosa. Falla cerrado (sin tabla, sin fila o con error → false = la home
// de siempre, tal cual). No cuesta una consulta: el layout ya lo resolvió en
// este mismo request y la respuesta vive 60 s en memoria por clínica; aquí va
// en el mismo Promise.all que los datos de la vista para no esperar en serie.
//
// Con la bandera apagada, lo que se devuelve abajo es, rama por rama, el
// árbol de siempre: HomeShell y los componentes de `components/dashboard/home/`.
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
  // gráfica de ingresos (serie en useState + fetch al montar y al cambiar de
  // periodo) seguía pintando la de la clínica ANTERIOR con los KPIs ya en $0.
  // Con la key, el árbol se re-monta al cambiar de clínica y el estado muere.
  if (role === "RECEPTIONIST") {
    const [data, rediseno] = await Promise.all([
      fetchReceptionistData(),
      menuDosNivelesEncendido(clinic.id),
    ]);
    if (rediseno) {
      return (
        <RaizHoy>
          <HoyRecepcion key={clinic.id} user={homeUser} clinic={homeClinic} data={data} />
        </RaizHoy>
      );
    }
    return (
      <HomeShell>
        <HomeReceptionist key={clinic.id} user={homeUser} clinic={homeClinic} data={data} />
      </HomeShell>
    );
  }

  if (role === "DOCTOR") {
    const [data, rediseno] = await Promise.all([
      fetchDoctorData(),
      menuDosNivelesEncendido(clinic.id),
    ]);
    if (rediseno) {
      return (
        <RaizHoy>
          <HoyDoctor key={clinic.id} user={homeUser} clinic={homeClinic} data={data} />
        </RaizHoy>
      );
    }
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
    const [hybridCheck, adminData, onboardingCompleted, rediseno] = await Promise.all([
      fetchHybridRoleCheck(),
      fetchAdminData(period),
      getOnboardingCompleted(clinic.id, clinic.waConnected),
      menuDosNivelesEncendido(clinic.id),
    ]);
    const doctorData = hybridCheck.canBeDoctor ? await fetchDoctorData() : null;

    const contenido = (
      <>
        {/* Aviso de cupo de IA — se pinta solo si la clínica pasó el 80% del
            cupo mensual. Se auto-gatea (admin + límite > 0) y se descarta por
            sesión; en planes sin IA (límite 0) no aparece nunca. */}
        <AiQuotaBanner />
        {/* Checklist de primeros pasos — solo admins; se auto-oculta al 100%
            o si el usuario lo descartó (localStorage por clinicId). */}
        <OnboardingChecklist completed={onboardingCompleted} clinicId={clinic.id} />
        <HomeClientSwitch
          user={homeUser}
          clinic={homeClinic}
          adminContent={
            rediseno ? (
              <HoyAdmin key={clinic.id} user={homeUser} clinic={homeClinic} data={adminData} period={period} />
            ) : (
              <HomeAdmin key={clinic.id} user={homeUser} clinic={homeClinic} data={adminData} period={period} />
            )
          }
          doctorContent={
            doctorData ? (
              rediseno ? (
                <HoyDoctor key={clinic.id} user={homeUser} clinic={homeClinic} data={doctorData} />
              ) : (
                <HomeDoctor key={clinic.id} user={homeUser} clinic={homeClinic} data={doctorData} />
              )
            ) : null
          }
          canBeDoctor={hybridCheck.canBeDoctor}
          initialMode={searchParams?.mode === "doctor" ? "doctor" : "admin"}
          rediseno={rediseno}
        />
      </>
    );

    return rediseno ? <RaizHoy>{contenido}</RaizHoy> : <HomeShell>{contenido}</HomeShell>;
  }

  const [adminData, rediseno] = await Promise.all([
    fetchAdminData(period),
    menuDosNivelesEncendido(clinic.id),
  ]);
  if (rediseno) {
    return (
      <RaizHoy>
        <HoyAdmin key={clinic.id} user={homeUser} clinic={homeClinic} data={adminData} period={period} />
      </RaizHoy>
    );
  }
  return (
    <HomeShell>
      <HomeAdmin key={clinic.id} user={homeUser} clinic={homeClinic} data={adminData} period={period} />
    </HomeShell>
  );
}

function isValidPeriod(p?: string): boolean {
  return p === "day" || p === "month" || p === "quarter" || p === "year";
}
