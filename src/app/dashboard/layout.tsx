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
import { ExpiredPlanModal } from "@/components/dashboard/expired-plan-modal";
import { ChatLauncher } from "@/components/dashboard/chat/chat-launcher";
import { getOnboardingCompleted } from "@/lib/onboarding-steps-server";
import { getActiveClinicModuleKeys } from "@/lib/clinical-shared/get-active-clinic-modules";
import { I18nProvider } from "@/i18n/i18n-provider";
import { getDict } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { localeFromClinic } from "@/i18n/server";
import { hasValidTwoFactorCookie } from "@/lib/auth/two-factor-cookie";
import {
  TWO_FA_ROUTE_PREFIX,
  TWO_FA_CHALLENGE_PATH,
  TWO_FA_SETUP_PATH,
} from "@/lib/auth/two-factor-constants";
import { ACTIVE_SUBSCRIPTION_STATUSES, isPlanExpired } from "@/lib/plan-status";
import { getBranchQuota } from "@/lib/branches";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const clinic = user.clinic;
  const pathname = headers().get("x-pathname") ?? "";

  // i18n — idioma del panel resuelto desde la clínica de la sesión. El layout ya
  // tiene la clínica en mano (getCurrentUser arriba), así que resuelve locale +
  // dict inline y los baja al provider cliente; solo se serializa el idioma
  // activo, no ambos. El cast defensivo vive centralizado en localeFromClinic.
  // Server components / route handlers SIN la clínica a mano: getServerT().
  const locale = localeFromClinic(clinic);
  const dict = getDict(locale);
  const t = makeT(dict);

  // ── Gate 2FA (AUTORITATIVO, no evitable) ──────────────────────────
  // La sesión la crea Supabase tras el password; el 2FA es una segunda barrera
  // a nivel de aplicación. Corre en CADA render de /dashboard (force-dynamic)
  // con la BD en mano, así que NO se puede saltar navegando directo — a
  // diferencia del fast-path del middleware (presencia de cookie en Edge, sin
  // BD). Aunque la cookie df_2fa_pending falte o se borre, este check bloquea.
  //   • Usuario con totpEnabled sin df_2fa válida → reto TOTP.
  //   • Clínica con require2fa y usuario sin 2FA → enrolamiento forzado.
  // Las rutas /dashboard/2fa* quedan EXENTAS (si no, loop) y se renderizan con
  // layout mínimo (sin sidebar/topbar) para no exponer el panel antes del 2FA.
  const isTwoFaRoute = pathname.startsWith(TWO_FA_ROUTE_PREFIX);
  if (!isTwoFaRoute) {
    if (
      (user as { totpEnabled?: boolean }).totpEnabled &&
      !hasValidTwoFactorCookie(user.supabaseId, user.clinicId)
    ) {
      redirect(`${TWO_FA_CHALLENGE_PATH}?next=${encodeURIComponent(pathname || "/dashboard")}`);
    }
    if (
      (clinic as { require2fa?: boolean }).require2fa &&
      !(user as { totpEnabled?: boolean }).totpEnabled
    ) {
      redirect(TWO_FA_SETUP_PATH);
    }
  }
  if (isTwoFaRoute) {
    // Layout mínimo: sin sidebar/topbar ni providers de dashboard; dentro de
    // I18nProvider para que el reto/enrolamiento tengan useT.
    return (
      <I18nProvider locale={locale} dict={dict}>
        <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10 font-sans">
          {children}
        </main>
      </I18nProvider>
    );
  }

  // ── Gating sin plan activo (sin modal bloqueante) ────────────────
  // Una clínica está sin acceso cuando trialEndsAt < now Y la suscripción
  // no está activa (subscriptionStatus no es active / trialing / paid).
  // Cubre tanto la cuenta NUEVA (pending_payment, trial en cero) como la
  // SUSPENDIDA por impago. Una clínica que paga limpia subscriptionStatus
  // a 'active' y NO se bloquea aunque trialEndsAt siga en el pasado.
  // El gating aplica a TODOS los roles (incluso SUPER_ADMIN). Si un
  // SUPER_ADMIN necesita destrabar una clínica, lo hace desde el panel
  // /admin (ruta separada, no cubierta por este check) que permite
  // extender trial o activar suscripción manualmente.
  //
  // Implementación: en vez de un modal de "acceso bloqueado", redirigimos
  // DIRECTO a la pantalla de pago /dashboard/suspended (abajo). El redirect
  // es server-side (sin parpadeo del dashboard); el guard de cliente
  // <ExpiredPlanModal/> cubre las navegaciones soft donde el layout no
  // se re-ejecuta.
  const trialEndsAt = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  const now = new Date();
  const subscriptionStatus = (clinic as { subscriptionStatus?: string | null }).subscriptionStatus ?? null;
  const subscriptionActive =
    subscriptionStatus !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
  const isExpired = isPlanExpired(clinic);
  const isInTrial = !!trialEndsAt && trialEndsAt > now && !subscriptionActive;

  // Redirect server-side a la pantalla de pago. Excepción: la propia
  // /dashboard/suspended (ahí se completa el pago) — sin esta guarda habría
  // loop. x-pathname lo inyecta el middleware (updateSession) en TODA ruta
  // /dashboard, así que es fiable; si faltara, el guard de cliente cubre.
  if (isExpired && pathname && pathname !== "/dashboard/suspended") {
    redirect("/dashboard/suspended");
  }
  // allClinics (switcher), módulos activos y estado de onboarding no dependen
  // entre sí: una sola ronda en paralelo en vez de 3 awaits serie.
  //
  // Marketplace specialties — set de keys para el sidebar global. Cada
  // item de "Especialidades" en el sidebar exige que su moduleKey esté
  // en esta lista; si no quedan items, la sección entera se oculta.
  // Durante trial vigente getActiveClinicModuleKeys devuelve todas las
  // SPECIALTY_MODULE_KEYS — todas las especialidades quedan visibles.
  //
  // onboardingCompleted alimenta el checklist "Primeros pasos" (ids alineados
  // con STEPS). El cálculo vive en getOnboardingCompleted (React.cache), así el
  // home del panel lo reusa en el MISMO request sin re-correr los COUNT(*).
  const [allClinics, clinicModuleKeys, onboardingCompleted] = await Promise.all([
    getUserClinics(),
    getActiveClinicModuleKeys(clinic.id),
    getOnboardingCompleted(clinic.id, clinic.waConnected),
  ]);

  // Multi-Clínica Fase 1 — cupo de sucursales para el switcher del sidebar.
  // Sin queries extra: las sedes que este dueño ya tiene salen de allClinics
  // (getUserClinics trae el rol POR clínica) y la config de planes va con caché
  // en memoria. Esto es sólo para PINTAR: el gate que manda es el de
  // POST /api/clinics, que recuenta contra la BD con el supabaseId de la sesión.
  const branchQuota = await getBranchQuota({
    clinic,
    isOwner: user.role === "SUPER_ADMIN",
    ownedCount: allClinics.filter((c) => c.role === "SUPER_ADMIN").length,
  });

  return (
    <I18nProvider locale={locale} dict={dict}>
    <ActiveConsultProvider>
    <NewPatientProvider>
    <NewAppointmentProvider>
    {/* Skip link — WCAG 2.4.1 Bypass Blocks. Oculto por defecto, visible
        al recibir focus por teclado para que usuarios de teclado/lectores
        salten la sidebar y la topbar. */}
    <a href="#main-content" className="mf-skip-link">
      {t("common.skipToContent")}
    </a>
    {/* Fondo --bg plano (Variante A): inline y solo aquí — .dashboard-shell la
        comparten labs/proveedores/afiliados, que no entran en el piloto. */}
    <div className="dashboard-shell flex min-h-screen font-sans" style={{ background: "var(--bg)" }}>
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
        branches={{
          quota: branchQuota,
          defaults: {
            category: (clinic as any).category ?? "OTHER",
            city: clinic.city ?? "",
            state: clinic.state ?? "",
          },
        }}
        onboardingCompleted={onboardingCompleted}
        trialEndsAt={trialEndsAt}
        isInTrial={isInTrial}
        clinicModuleKeys={clinicModuleKeys}
        sidebarCollapsed={(user as { sidebarCollapsed?: string[] }).sidebarCollapsed ?? []}
      />
      <div className="flex min-h-screen flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        <GlobalAnnouncementBanner />
        <Topbar
          clinicName={clinic.name}
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
    <ExpiredPlanModal isExpired={isExpired} currentPathname={pathname} />
    {/* Ícono de chat flotante (FAB) permanente en todo el dashboard. Una sola
        instancia aquí ⇒ visible exactamente una vez en cada ruta /dashboard/*. */}
    <ChatLauncher />
    </NewAppointmentProvider>
    </NewPatientProvider>
    </ActiveConsultProvider>
    </I18nProvider>
  );
}
