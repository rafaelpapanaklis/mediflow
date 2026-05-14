export const dynamic = "force-dynamic";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CardNew }  from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { formatRelativeDate } from "@/lib/format";

export default async function ChurnPage() {
  const now   = new Date();
  const prev7 = new Date(now); prev7.setDate(prev7.getDate()-7);
  const next3 = new Date(now); next3.setDate(next3.getDate()+3);

  const allClinics = await prisma.clinic.findMany({
    include: {
      users:  { select: { email:true, firstName:true, lastName:true, lastLogin:true } },
      _count: { select: { patients:true, appointments:true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const churnRisk    = allClinics.filter(c => {
    const last = c.users[0]?.lastLogin;
    return last && new Date(last) < prev7 && c.subscriptionStatus === "active";
  });
  const trialExpiring = allClinics.filter(c => {
    if (!c.trialEndsAt) return false;
    const d = new Date(c.trialEndsAt);
    return d > now && d < next3;
  });
  const inactiveTrial = allClinics.filter(c => {
    const isTrial = c.trialEndsAt && new Date(c.trialEndsAt) > now;
    const last    = c.users[0]?.lastLogin;
    return isTrial && (!last || new Date(last) < prev7);
  });

  function Section({
    title,
    sub,
    clinics,
    emptyMsg,
    tone,
  }: {
    title: string;
    sub: string;
    clinics: typeof allClinics;
    emptyMsg: string;
    tone: "danger" | "warning" | "neutral";
  }) {
    return (
      <CardNew
        title={title}
        sub={sub}
        action={<BadgeNew tone={tone}>{clinics.length}</BadgeNew>}
        noPad
      >
        {clinics.length === 0 ? (
          <div style={{ padding: "32px 22px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {emptyMsg}
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>Clínica</th>
                <th>Email admin</th>
                <th>Último login</th>
                <th>Pacientes</th>
                <th>Trial vence</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clinics.map(c => {
                const last = c.users[0]?.lastLogin;
                const isStale = !last || new Date(last) < prev7;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link
                        href={`/admin/clinics/${c.id}`}
                        style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none" }}
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td style={{ color: "var(--text-3)", fontSize: 11 }}>
                      {c.users[0]?.email ?? "—"}
                    </td>
                    <td>
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: isStale ? "var(--danger)" : "var(--text-2)", fontWeight: 500 }}
                      >
                        {formatRelativeDate(last)}
                      </span>
                    </td>
                    <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>
                      {c._count.patients}
                    </td>
                    <td className="mono" style={{ color: "var(--text-3)", fontSize: 11 }}>
                      {c.trialEndsAt ? new Date(c.trialEndsAt).toLocaleDateString("es-MX") : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {c.users[0]?.email ? (
                        <a
                          href={`mailto:${c.users[0]?.email}?subject=Tu%20clínica%20en%20MediFlow&body=Hola%20${encodeURIComponent(c.users[0]?.firstName ?? "")},%20notamos%20que%20no%20has%20usado%20MediFlow%20recientemente.%20¿Hay%20algo%20en%20que%20podamos%20ayudarte?`}
                          className="btn-new btn-new--secondary btn-new--sm"
                          style={{ textDecoration: "none" }}
                        >
                          Contactar
                        </a>
                      ) : (
                        <span style={{ color: "var(--text-3)", fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardNew>
    );
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Monitor de retención
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Detecta clínicas en riesgo de churn, trials por vencer y cuentas inactivas.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Section
          title="⚠ Riesgo de churn"
          sub="Activas sin login 7+ días"
          tone="danger"
          clinics={churnRisk}
          emptyMsg="No hay clínicas activas en riesgo de churn"
        />
        <Section
          title="⏳ Trial expirando"
          sub="Vencen en los próximos 3 días"
          tone="warning"
          clinics={trialExpiring}
          emptyMsg="No hay trials por vencer"
        />
        <Section
          title="💤 Trial inactivo"
          sub="Nunca han usado la app"
          tone="neutral"
          clinics={inactiveTrial}
          emptyMsg="Todos los trials están activos"
        />
      </div>
    </div>
  );
}
