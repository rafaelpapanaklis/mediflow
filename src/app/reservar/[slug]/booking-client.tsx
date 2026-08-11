"use client";
/* ============================================================
   /reservar/[slug] — la MISMA reserva que las mini-webs y el
   directorio, con la piel oscura de esta página.

   Todo el flujo (doctor → fecha → hora → procedimiento →
   identificarse, "cualquier disponible", las dos vías) vive en
   src/app/[slug]/_shared/booking-flow.tsx. Aquí solo queda el
   encabezado de la página y el fondo.
   ============================================================ */
import { useEffect, useState } from "react";
import { MapPin, Phone } from "lucide-react";
import {
  BookingFlow,
  normalizeServices,
  type BookingFlowService,
} from "@/app/[slug]/_shared/booking-flow";
import {
  currentBookingNext,
  useBookingReopen,
  type PendingBooking,
} from "@/lib/patient-portal/booking-auth";

interface Doctor {
  id: string; firstName: string; lastName: string;
  specialty: string | null; color: string; avatarUrl?: string | null; services: string[];
}
interface Clinic {
  id: string; name: string; slug: string; specialty: string;
  phone: string | null; address: string | null; city: string | null;
  logoUrl: string | null; description: string | null;
  landingServices?: unknown;
  landingWhatsapp?: string | null;
  landingThemeColor?: string | null;
  schedules: { dayOfWeek: number; enabled: boolean; openTime: string; closeTime: string }[];
  users: Doctor[];
}

export function BookingClient({
  clinic,
  preselectedService,
  categoryServices,
}: {
  clinic: Clinic;
  preselectedService: string | null;
  categoryServices?: string[];
}) {
  const theme = clinic.landingThemeColor || "#2563eb";

  // Los servicios con precio y duración mandan; si la clínica no configuró su
  // mini-web, quedan los nombres por categoría que ya venían de la página.
  const services: BookingFlowService[] = (() => {
    const propios = normalizeServices(clinic.landingServices);
    if (propios.length > 0) return propios;
    return normalizeServices(categoryServices ?? []);
  })();

  // Al volver del login/registro se reabre en el hueco que ya había elegido.
  const [restore, setRestore] = useState<PendingBooking | null>(null);
  useBookingReopen(clinic.slug, (pending) => { if (pending) setRestore(pending); });

  /** ?next= de vuelta: en el cliente conserva el querystring (?service=…). */
  const [next, setNext] = useState(`/reservar/${clinic.slug}`);
  useEffect(() => { setNext(currentBookingNext(`/reservar/${clinic.slug}`)); }, [clinic.slug]);

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", fontFamily: "system-ui,-apple-system,sans-serif" }}>
      <header style={{ background: "#1e293b", borderBottom: "1px solid #334155", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 580, margin: "0 auto", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          {clinic.logoUrl ? (
            <img src={clinic.logoUrl} alt={clinic.name} style={{ height: 36, objectFit: "contain", flexShrink: 0 }} />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: 12, background: theme, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 16, flexShrink: 0 }}>
              {clinic.name[0]}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9" }}>{clinic.name}</div>
            {clinic.city && (
              <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 3 }}>
                <MapPin size={11} /> {clinic.city}
              </div>
            )}
          </div>
          {clinic.phone && (
            <a href={`tel:${clinic.phone}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: theme, fontWeight: 600, textDecoration: "none", flexShrink: 0 }}>
              <Phone size={14} /> {clinic.phone}
            </a>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 580, margin: "0 auto", padding: "20px 16px 48px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", marginBottom: 4 }}>Agenda tu cita</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
          {clinic.description || `Reserva en línea con ${clinic.name}.`}
        </p>

        <BookingFlow
          clinic={{
            name: clinic.name,
            slug: clinic.slug,
            phone: clinic.phone,
            whatsapp: clinic.landingWhatsapp ?? null,
            address: clinic.address,
            doctors: clinic.users,
            schedules: clinic.schedules,
            services,
          }}
          theme={theme}
          surface="dark"
          preselectedService={preselectedService}
          restore={restore}
          nextPath={next}
        />
      </main>

      <style>{`input::placeholder, textarea::placeholder { color:#475569 }`}</style>
    </div>
  );
}
