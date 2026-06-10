import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inter } from "next/font/google";
import { MapPin, Phone, Clock, Stethoscope, BadgeCheck, Instagram, Facebook } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { buildMetadata, SITE_URL, localBusinessLd } from "@/lib/seo";
import { categoryLabel, type DirectoryClinic, type ClinicCategoryValue } from "@/lib/directory/types";
import { getPublicReviews } from "@/lib/reviews/service";
import { ReserveButton } from "@/components/directory/ReserveButton";
import { BookingPopupController } from "@/components/directory/BookingPopupController";
import { ReviewStars } from "@/components/reviews/ReviewStars";
import { ProfileReviews } from "@/components/reviews/ProfileReviews";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import "@/components/public/landing/sales/sales.css";

// ─────────────────────────────────────────────────────────────────────────────
// /descubre/clinica/[slug] — perfil público de una clínica (estilo Doctoralia).
// Blanco + violeta (.mfh). Hero, servicios con precios, doctores, horarios,
// reseñas verificadas y botón Reservar que reutiliza el popup del directorio.
// ─────────────────────────────────────────────────────────────────────────────

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const dynamic = "force-dynamic";

const DAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const visibilityWhere = (slug: string) => ({
  slug,
  isPublic: true,
  AND: [{ OR: [{ subscriptionStatus: null }, { subscriptionStatus: { notIn: ["cancelled"] } }] }],
});

interface PublicService {
  name: string;
  price: number | null;
  description: string | null;
}

function parseServices(landingServices: unknown): PublicService[] {
  if (!Array.isArray(landingServices)) return [];
  const out: PublicService[] = [];
  for (const entry of landingServices) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name) out.push({ name, price: null, description: null });
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const e = entry as Record<string, unknown>;
      const name = String(e.name ?? "").trim();
      if (!name) continue;
      let price: number | null = null;
      if (typeof e.price === "number" && Number.isFinite(e.price)) price = e.price;
      else if (typeof e.price === "string" && e.price.trim() && !Number.isNaN(Number(e.price))) price = Number(e.price);
      const description = e.description ? String(e.description).trim() : null;
      out.push({ name, price, description });
    }
  }
  return out.slice(0, 24);
}

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const clinic = await prisma.clinic.findFirst({
    where: visibilityWhere(params.slug),
    select: { name: true, city: true, state: true, category: true, description: true, landingTagline: true, logoUrl: true, landingCoverUrl: true },
  });
  if (!clinic) {
    return buildMetadata({ title: "Clínica no encontrada | DaleControl", description: "Esta clínica no está disponible.", path: `/descubre/clinica/${params.slug}` });
  }
  const place = [clinic.city, clinic.state].filter(Boolean).join(", ");
  const cat = categoryLabel(clinic.category);
  return buildMetadata({
    title: `${clinic.name}${place ? ` en ${place}` : ""} | Reserva en línea`,
    description:
      (clinic.landingTagline || clinic.description || `${cat} en ${place || "México"}. Reseñas verificadas y agenda en línea con DaleControl.`).slice(0, 160),
    path: `/descubre/clinica/${params.slug}`,
    ogImage: clinic.landingCoverUrl || clinic.logoUrl || undefined,
  });
}

export default async function ClinicProfilePage({ params }: { params: { slug: string } }) {
  const clinic = await prisma.clinic.findFirst({
    where: visibilityWhere(params.slug),
    select: {
      id: true, name: true, slug: true, category: true, city: true, state: true, address: true,
      phone: true, logoUrl: true, description: true, mapsUrl: true,
      landingCoverUrl: true, landingTagline: true, landingThemeColor: true, landingActive: true,
      landingServices: true, landingGallery: true, landingYearsExperience: true, landingPatients: true,
      landingInstagram: true, landingFacebook: true,
      schedules: { select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true } },
      users: {
        where: { isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
        select: { id: true, firstName: true, lastName: true, specialty: true, color: true, avatarUrl: true, services: true },
        orderBy: { firstName: "asc" },
      },
    },
  });
  if (!clinic) notFound();

  const reviews = await getPublicReviews(clinic.id, 1);
  const theme = clinic.landingThemeColor || "#7c3aed";
  const services = parseServices(clinic.landingServices);
  const place = [clinic.city, clinic.state].filter(Boolean).join(", ");
  const initial = clinic.name.trim().charAt(0).toUpperCase() || "C";

  // Servicios destacados para el popup (nombres de doctores ∪ servicios).
  const seen = new Set<string>();
  const featuredServices: string[] = [];
  for (const n of [...clinic.users.flatMap((u) => u.services ?? []), ...services.map((s) => s.name)]) {
    const name = (n ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || featuredServices.length >= 12) continue;
    seen.add(key);
    featuredServices.push(name);
  }

  const dirClinic: DirectoryClinic = {
    id: clinic.id,
    name: clinic.name,
    slug: clinic.slug,
    category: clinic.category as ClinicCategoryValue,
    city: clinic.city,
    state: clinic.state,
    address: clinic.address,
    phone: clinic.phone,
    logoUrl: clinic.logoUrl,
    coverUrl: clinic.landingCoverUrl,
    description: clinic.description,
    tagline: clinic.landingTagline,
    themeColor: clinic.landingThemeColor,
    landingActive: clinic.landingActive,
    featuredServices,
    doctors: clinic.users.map((u) => ({
      id: u.id, firstName: u.firstName, lastName: u.lastName, specialty: u.specialty,
      color: u.color, avatarUrl: u.avatarUrl, services: Array.isArray(u.services) ? u.services : [],
    })),
    schedules: clinic.schedules.map((s) => ({
      dayOfWeek: s.dayOfWeek, enabled: s.enabled, openTime: s.openTime, closeTime: s.closeTime,
    })),
    ratingAvg: reviews.summary.avg,
    ratingCount: reviews.summary.count,
  };

  const jsonLd = localBusinessLd({
    name: clinic.name,
    description: clinic.landingTagline || clinic.description || `${categoryLabel(clinic.category)} en ${place || "México"}`,
    url: `${SITE_URL}/descubre/clinica/${clinic.slug}`,
    image: clinic.landingCoverUrl || clinic.logoUrl || undefined,
    telephone: clinic.phone,
    address: { street: clinic.address, city: clinic.city, state: clinic.state },
    rating: reviews.summary.count > 0 ? { value: reviews.summary.avg, count: reviews.summary.count } : null,
    priceRange: "$$",
  });

  const gallery = Array.isArray(clinic.landingGallery) ? clinic.landingGallery.filter(Boolean).slice(0, 6) : [];
  const scheduleByDay = new Map(clinic.schedules.map((s) => [s.dayOfWeek, s]));

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />
      <main>
        {/* ─── Hero ─── */}
        <section className="mfh-band--violet" style={{ paddingTop: 28, paddingBottom: 28 }}>
          <div className="mfh-container">
            <nav className="mb-4 text-[13px]" style={{ color: "var(--muted, #64748b)" }} aria-label="Ruta">
              <Link href="/descubre" className="hover:underline">Directorio</Link>
              <span className="mx-1.5">/</span>
              <span>{categoryLabel(clinic.category)}</span>
            </nav>

            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              {/* Logo */}
              {clinic.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={clinic.logoUrl} alt="" className="h-20 w-20 shrink-0 rounded-2xl border-2 border-white bg-white object-cover shadow-lg" />
              ) : (
                <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-2 border-white text-3xl font-extrabold text-white shadow-lg" style={{ background: theme }} aria-hidden="true">
                  {initial}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-0.5 text-[12px] font-semibold" style={{ color: "var(--b-ink, #5b21b6)" }}>
                  {categoryLabel(clinic.category)}
                </span>
                <h1 className="mt-2 text-2xl font-extrabold leading-tight sm:text-3xl" style={{ color: "var(--ink, #0f172a)" }}>
                  {clinic.name}
                </h1>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px]" style={{ color: "var(--body, #475569)" }}>
                  {place && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={15} style={{ color: theme }} aria-hidden="true" /> {place}
                    </span>
                  )}
                  {reviews.summary.count > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <ReviewStars value={reviews.summary.avg} size={15} />
                      <span className="font-bold" style={{ color: "var(--ink, #0f172a)" }}>{reviews.summary.avg.toFixed(1)}</span>
                      <span style={{ color: "var(--muted, #64748b)" }}>({reviews.summary.count})</span>
                    </span>
                  )}
                  {clinic.landingYearsExperience ? (
                    <span className="inline-flex items-center gap-1.5">
                      <BadgeCheck size={15} style={{ color: theme }} aria-hidden="true" /> {clinic.landingYearsExperience} años de experiencia
                    </span>
                  ) : null}
                </div>

                {(clinic.landingTagline || clinic.description) && (
                  <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--body, #475569)" }}>
                    {clinic.landingTagline || clinic.description}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <ReserveButton clinic={dirClinic} />
                  {clinic.phone && (
                    <a href={`tel:${clinic.phone}`} className="inline-flex items-center gap-2 rounded-2xl border bg-white px-5 py-3 text-sm font-semibold transition hover:bg-[var(--tint2,#faf8ff)]" style={{ borderColor: "var(--line, #e9e7f3)", color: "var(--ink, #0f172a)" }}>
                      <Phone size={16} aria-hidden="true" /> Llamar
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mfh-container" style={{ paddingTop: 28, paddingBottom: 40 }}>
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            {/* Columna principal */}
            <div className="min-w-0 space-y-10">
              {/* Sobre la clínica */}
              {clinic.description && clinic.landingTagline && (
                <Section title="Sobre la clínica">
                  <p className="text-[15px] leading-relaxed" style={{ color: "var(--body, #475569)" }}>{clinic.description}</p>
                </Section>
              )}

              {/* Servicios con precios */}
              {services.length > 0 && (
                <Section title="Servicios y precios">
                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {services.map((s, i) => (
                      <li key={`${s.name}-${i}`} className="flex items-start justify-between gap-3 rounded-2xl border bg-white p-3.5" style={{ borderColor: "var(--line, #e9e7f3)" }}>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <Stethoscope size={15} className="shrink-0" style={{ color: theme }} aria-hidden="true" />
                            <span className="truncate font-semibold" style={{ color: "var(--ink, #0f172a)" }}>{s.name}</span>
                          </div>
                          {s.description && <p className="mt-1 text-[13px]" style={{ color: "var(--muted, #64748b)" }}>{s.description}</p>}
                        </div>
                        <span className="shrink-0 text-sm font-bold" style={{ color: s.price != null ? theme : "var(--muted, #64748b)" }}>
                          {s.price != null ? mxn.format(s.price) : "Consultar"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Doctores */}
              {clinic.users.length > 0 && (
                <Section title={clinic.users.length === 1 ? "Profesional" : "Profesionales"}>
                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {clinic.users.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 rounded-2xl border bg-white p-3.5" style={{ borderColor: "var(--line, #e9e7f3)" }}>
                        {d.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                        ) : (
                          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-base font-bold text-white" style={{ background: d.color || theme }} aria-hidden="true">
                            {(d.firstName?.[0] ?? "").toUpperCase()}{(d.lastName?.[0] ?? "").toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-semibold" style={{ color: "var(--ink, #0f172a)" }}>Dr/a. {d.firstName} {d.lastName}</div>
                          {d.specialty && <div className="text-[13px] font-semibold" style={{ color: theme }}>{d.specialty}</div>}
                          {d.services.length > 0 && <div className="truncate text-[12px]" style={{ color: "var(--muted, #64748b)" }}>{d.services.slice(0, 3).join(" · ")}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Galería */}
              {gallery.length > 0 && (
                <Section title="Galería">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {gallery.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={src} alt="" loading="lazy" className="aspect-square w-full rounded-2xl object-cover" style={{ border: "1px solid var(--line, #e9e7f3)" }} />
                    ))}
                  </div>
                </Section>
              )}

              {/* Reseñas */}
              <Section title="Reseñas verificadas">
                <ProfileReviews clinicSlug={clinic.slug} initial={reviews} theme={theme} />
              </Section>
            </div>

            {/* Columna lateral: horarios + contacto + reservar */}
            <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              <div className="rounded-2xl border bg-white p-5" style={{ borderColor: "var(--line, #e9e7f3)" }}>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold" style={{ color: "var(--ink, #0f172a)" }}>
                  <Clock size={16} style={{ color: theme }} aria-hidden="true" /> Horario
                </h3>
                <ul className="space-y-1.5 text-[13px]">
                  {DAYS_ES.map((label, idx) => {
                    const s = scheduleByDay.get(idx);
                    const open = s?.enabled;
                    return (
                      <li key={idx} className="flex items-center justify-between">
                        <span style={{ color: "var(--body, #475569)" }}>{label}</span>
                        <span style={{ color: open ? "var(--ink, #0f172a)" : "var(--muted, #94a3b8)", fontWeight: open ? 600 : 400 }}>
                          {open ? `${s!.openTime} – ${s!.closeTime}` : "Cerrado"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {(clinic.address || clinic.phone || clinic.landingInstagram || clinic.landingFacebook) && (
                <div className="rounded-2xl border bg-white p-5" style={{ borderColor: "var(--line, #e9e7f3)" }}>
                  <h3 className="mb-3 text-sm font-bold" style={{ color: "var(--ink, #0f172a)" }}>Contacto</h3>
                  {clinic.address && (
                    <a href={clinic.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clinic.address)}`} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-[13px] hover:underline" style={{ color: "var(--body, #475569)" }}>
                      <MapPin size={15} className="mt-0.5 shrink-0" style={{ color: theme }} aria-hidden="true" /> {clinic.address}
                    </a>
                  )}
                  {clinic.phone && (
                    <a href={`tel:${clinic.phone}`} className="mt-2 flex items-center gap-2 text-[13px] hover:underline" style={{ color: "var(--body, #475569)" }}>
                      <Phone size={15} className="shrink-0" style={{ color: theme }} aria-hidden="true" /> {clinic.phone}
                    </a>
                  )}
                  {(clinic.landingInstagram || clinic.landingFacebook) && (
                    <div className="mt-3 flex gap-2">
                      {clinic.landingInstagram && (
                        <a href={normalizeSocial(clinic.landingInstagram, "instagram")} target="_blank" rel="noreferrer" aria-label="Instagram" className="grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: "var(--line, #e9e7f3)", color: theme }}>
                          <Instagram size={16} />
                        </a>
                      )}
                      {clinic.landingFacebook && (
                        <a href={normalizeSocial(clinic.landingFacebook, "facebook")} target="_blank" rel="noreferrer" aria-label="Facebook" className="grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: "var(--line, #e9e7f3)", color: theme }}>
                          <Facebook size={16} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-2xl border p-5" style={{ borderColor: `${theme}30`, background: `${theme}0c` }}>
                <p className="mb-3 text-sm font-semibold" style={{ color: "var(--ink, #0f172a)" }}>Agenda tu cita en línea</p>
                <ReserveButton clinic={dirClinic} full label="Reservar cita" />
              </div>
            </aside>
          </div>
        </div>
      </main>
      <SalesFooter />

      {/* Popup de reserva (montado una sola vez) + restauración ?reservar= */}
      <BookingPopupController />

      {/* JSON-LD: < escapado para evitar breakout de </script> con datos de la clínica. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold" style={{ color: "var(--ink, #0f172a)" }}>{title}</h2>
      {children}
    </section>
  );
}

function normalizeSocial(handle: string, network: "instagram" | "facebook"): string {
  const h = handle.trim();
  if (/^https?:\/\//i.test(h)) return h;
  const user = h.replace(/^@/, "");
  return network === "instagram" ? `https://instagram.com/${user}` : `https://facebook.com/${user}`;
}
