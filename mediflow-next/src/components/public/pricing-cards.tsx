"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const plans = [
  {
    id: "basic",
    name: "Básico",
    monthlyPrice: 49,
    annualPrice: 39,
    description: "Perfecto para empezar. Un profesional, todo lo esencial.",
    highlighted: false,
    badge: null,
    features: [
      "1 profesional",
      "Hasta 200 pacientes",
      "Agenda y citas",
      "Expediente clínico básico",
      "Facturación simple",
      "Email de soporte",
      "Recordatorios por email",
    ],
    notIncluded: [
      "WhatsApp Business",
      "Notas con IA",
      "Portal del paciente",
      "Reportes avanzados",
      "Multi-sucursal",
    ],
    cta: "Empieza gratis 14 días",
    ctaVariant: "outline" as const,
  },
  {
    id: "pro",
    name: "Profesional",
    monthlyPrice: 99,
    annualPrice: 79,
    description: "El plan más popular. Equipos pequeños con todo incluido.",
    highlighted: true,
    badge: "⭐ Más popular",
    features: [
      "Hasta 3 profesionales",
      "Pacientes ilimitados",
      "Agenda y citas avanzada",
      "Expediente clínico completo",
      "Facturación completa",
      "WhatsApp Business integrado",
      "Notas clínicas con IA",
      "Portal del paciente",
      "Reportes avanzados",
      "Soporte chat en vivo",
    ],
    notIncluded: [
      "Multi-sucursal",
      "API personalizada",
    ],
    cta: "Empieza gratis 14 días",
    ctaVariant: "default" as const,
  },
  {
    id: "clinic",
    name: "Clínica",
    monthlyPrice: 249,
    annualPrice: 199,
    description: "Para clínicas con múltiples doctores y sucursales.",
    highlighted: false,
    badge: null,
    features: [
      "Profesionales ilimitados",
      "Pacientes ilimitados",
      "Todo del plan Profesional",
      "Multi-sucursal",
      "Telemedicina integrada",
      "Firma digital de documentos",
      "API REST acceso completo",
      "Soporte dedicado 24/7",
      "Onboarding personalizado",
      "SLA garantizado",
    ],
    notIncluded: [],
    cta: "Hablar con ventas",
    ctaVariant: "outline" as const,
  },
];

interface PricingCardsProps {
  compact?: boolean;
}

export function PricingCards({ compact = false }: PricingCardsProps) {
  const [annual, setAnnual] = useState(false);

  return (
    <div>
      {/* Toggle */}
      <div className="flex items-center justify-center gap-3 mb-10">
        <span className={cn("text-sm font-medium", !annual ? "text-foreground" : "text-muted-foreground")}>
          Mensual
        </span>
        <button
          onClick={() => setAnnual((v) => !v)}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors",
            annual ? "bg-brand-600" : "bg-muted-foreground/30"
          )}
        >
          <div
            className={cn(
              "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform",
              annual ? "translate-x-5.5 left-0" : "left-0.5"
            )}
          />
        </button>
        <span className={cn("text-sm font-medium flex items-center gap-1.5", annual ? "text-foreground" : "text-muted-foreground")}>
          Anual
          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            −20%
          </span>
        </span>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "relative rounded-2xl border p-7 flex flex-col transition-all duration-200",
              plan.highlighted
                ? "border-brand-300 bg-gradient-to-b from-brand-50 to-white shadow-card-md scale-[1.02]"
                : "border-border bg-card hover:shadow-card-md"
            )}
          >
            {plan.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="bg-brand-600 text-white text-xs font-bold px-4 py-1 rounded-full shadow-sm">
                  {plan.badge}
                </div>
              </div>
            )}

            <div className="mb-6">
              <div className="text-base font-bold text-foreground mb-1">{plan.name}</div>
              <div className="flex items-end gap-1 mb-2">
                <span className="text-4xl font-extrabold text-foreground tracking-tight">
                  ${annual ? plan.annualPrice : plan.monthlyPrice}
                </span>
                <span className="text-muted-foreground text-sm mb-1.5">USD/mes</span>
              </div>
              {annual && (
                <div className="text-xs text-emerald-600 font-semibold">
                  Ahorras ${(plan.monthlyPrice - plan.annualPrice) * 12}/año
                </div>
              )}
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                {plan.description}
              </p>
            </div>

            <Button
              variant={plan.highlighted ? "default" : plan.ctaVariant}
              className="w-full mb-6"
              asChild
            >
              <Link href="/register">{plan.cta}</Link>
            </Button>

            {!compact && (
              <>
                <div className="space-y-2.5 flex-1">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-center gap-2.5 text-sm">
                      <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-foreground">{f}</span>
                    </div>
                  ))}
                  {plan.notIncluded.map((f) => (
                    <div key={f} className="flex items-center gap-2.5 text-sm opacity-40">
                      <span className="w-4 h-4 flex-shrink-0 text-center leading-none">—</span>
                      <span className="text-muted-foreground line-through">{f}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground mt-6">
        Sin tarjeta de crédito · Cancela en cualquier momento · Soporte en español incluido
      </p>
    </div>
  );
}
