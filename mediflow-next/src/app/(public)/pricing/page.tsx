import type { Metadata } from "next";
import { Check } from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";
import { PricingCards } from "@/components/public/pricing-cards";
import { FAQ } from "@/components/public/faq";
import { CTABanner } from "@/components/public/cta-banner";

export const metadata: Metadata = {
  title: "Precios — MediFlow",
  description: "Planes simples y transparentes para clínicas de todos los tamaños.",
};

const addons = [
  { name: "WhatsApp Business adicional",   price: "$29/mes",  desc: "Línea adicional de WhatsApp para un segundo consultorio." },
  { name: "Telemedicina HD",               price: "$39/mes",  desc: "Videoconsultas en alta definición con sala de espera virtual." },
  { name: "Firma digital de documentos",   price: "$19/mes",  desc: "Firma de consentimientos y recetas directamente en el sistema." },
  { name: "Multi-sucursal (+1 sucursal)",  price: "$49/mes",  desc: "Agrega una sucursal adicional con su propia agenda y personal." },
  { name: "SMS recordatorios",             price: "$15/mes",  desc: "Recordatorios por SMS para pacientes sin WhatsApp." },
  { name: "CFDI / Factura electrónica",    price: "$25/mes",  desc: "Emisión de comprobantes fiscales certificados para México." },
];

const comparisonsRows = [
  { feature: "Profesionales",         basic: "1",        pro: "3",           clinic: "Ilimitados" },
  { feature: "Pacientes",             basic: "200",      pro: "Ilimitados",  clinic: "Ilimitados" },
  { feature: "Agenda y citas",        basic: true,       pro: true,          clinic: true         },
  { feature: "Expediente clínico",    basic: "Básico",   pro: "Completo",    clinic: "Completo"   },
  { feature: "Facturación",           basic: true,       pro: true,          clinic: true         },
  { feature: "WhatsApp Business",     basic: false,      pro: true,          clinic: true         },
  { feature: "Notas con IA",          basic: false,      pro: true,          clinic: true         },
  { feature: "Portal del paciente",   basic: false,      pro: true,          clinic: true         },
  { feature: "Reportes avanzados",    basic: false,      pro: true,          clinic: true         },
  { feature: "Multi-sucursal",        basic: false,      pro: false,         clinic: true         },
  { feature: "Telemedicina",          basic: false,      pro: false,         clinic: true         },
  { feature: "API REST",              basic: false,      pro: false,         clinic: true         },
  { feature: "Soporte",               basic: "Email",    pro: "Chat + Email",clinic: "Dedicado"   },
];

function CellValue({ value }: { value: boolean | string }) {
  if (typeof value === "boolean") {
    return value
      ? <Check className="w-4 h-4 text-emerald-600 mx-auto" />
      : <span className="text-muted-foreground/30 block text-center">—</span>;
  }
  return <span className="text-sm text-foreground text-center block">{value}</span>;
}

export default function PricingPage() {
  return (
    <>
      {/* Hero */}
      <section className="hero-bg pt-20 pb-16 px-6 text-center">
        <div className="container-tight">
          <SectionHeader
            eyebrow="Precios simples y transparentes"
            title="Sin sorpresas ni costos ocultos"
            subtitle="Empieza gratis 14 días. Sin tarjeta de crédito. Cancela cuando quieras."
            centered
            className="mb-12"
          />
          <PricingCards />
        </div>
      </section>

      {/* Comparison table */}
      <section className="py-16 px-6 bg-white">
        <div className="container-tight">
          <h2 className="text-2xl font-extrabold text-center mb-10">Comparación completa de planes</h2>
          <div className="rounded-2xl border border-border overflow-hidden shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-5 py-4 text-muted-foreground font-semibold">Funcionalidad</th>
                  <th className="px-5 py-4 text-center font-bold text-foreground">Básico</th>
                  <th className="px-5 py-4 text-center font-bold text-brand-600 bg-brand-50">Profesional</th>
                  <th className="px-5 py-4 text-center font-bold text-foreground">Clínica</th>
                </tr>
              </thead>
              <tbody>
                {comparisonsRows.map((row, i) => (
                  <tr key={row.feature} className={`border-t border-border ${i % 2 === 0 ? "bg-white" : "bg-muted/20"}`}>
                    <td className="px-5 py-3.5 font-medium text-foreground">{row.feature}</td>
                    <td className="px-5 py-3.5"><CellValue value={row.basic} /></td>
                    <td className="px-5 py-3.5 bg-brand-50/50"><CellValue value={row.pro} /></td>
                    <td className="px-5 py-3.5"><CellValue value={row.clinic} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Add-ons */}
      <section className="py-16 px-6 bg-slate-50">
        <div className="container-tight">
          <SectionHeader
            eyebrow="Módulos adicionales"
            title="Amplía según tus necesidades"
            subtitle="Agrega funcionalidades específicas a cualquier plan sin cambiar de suscripción."
            className="mb-10"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {addons.map((addon) => (
              <div key={addon.name} className="rounded-xl border border-border bg-white p-5 flex gap-4 items-start">
                <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-brand-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-bold text-foreground">{addon.name}</span>
                    <span className="text-xs font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">{addon.price}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{addon.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FAQ />
      <CTABanner />
    </>
  );
}
