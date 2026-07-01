'use client';

/**
 * DaleControl — Sección de Precios (Planes)
 * Next.js 14 (App Router) + React + TypeScript. Sin dependencias externas.
 * Estilos: PricingSection.module.css (colócalo junto a este archivo).
 *
 * Uso:  <PricingSection />
 * CTA → /signup?plan=basic|pro|clinic&billing=monthly|annual
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './PricingSection.module.css';

type Period = 'mensual' | 'anual';

interface Feature {
  text: string;
  included: boolean;
  value?: string; // valor a la derecha (p. ej. "200 mil")
}

interface FeatureGroup {
  title: string;
  items: Feature[];
}

interface Plan {
  key: 'basico' | 'profesional' | 'clinica';
  name: string;
  tagline: string;
  monthly: number;       // precio mensual MXN
  yearly: number;        // precio anual MXN (30% off)
  yearlyPerMonth: number; // equivalente mensual del anual
  yearlySavings: number;
  recommended?: boolean;
  addendumLabel?: string; // "Todo lo de Básico, y además:"
  capacity: { text: string; value: string }[];
  highlights: Feature[]; // lista corta visible por default
}

const PLANS: Plan[] = [
  {
    key: 'basico',
    name: 'Básico',
    tagline: 'Para ordenar tu clínica desde el día uno',
    monthly: 499,
    yearly: 4192,
    yearlyPerMonth: 349,
    yearlySavings: 1796,
    capacity: [
      { text: 'Pacientes', value: '200' },
      { text: 'Usuarios del equipo', value: '2' },
      { text: 'Almacenamiento', value: '5 GB' },
      { text: 'Mensajes de WhatsApp / mes', value: '300+' },
    ],
    highlights: [
      { text: 'Agenda + recordatorios por WhatsApp', included: true },
      { text: 'Expediente clínico + odontograma', included: true },
      { text: 'Recetas digitales y Facturación CFDI 4.0', included: true },
      { text: 'Portal del paciente', included: true },
      { text: 'IA: radiografías y asistente clínico', included: false },
      { text: 'Analytics, reportes y Mi Clínica Visual', included: false },
      { text: 'Varios consultorios y roles avanzados', included: false },
    ],
  },
  {
    key: 'profesional',
    name: 'Profesional',
    tagline: 'La favorita de las clínicas dentales',
    monthly: 999,
    yearly: 8392,
    yearlyPerMonth: 699,
    yearlySavings: 3596,
    recommended: true,
    addendumLabel: 'Todo lo de Básico, y además:',
    capacity: [
      { text: 'Pacientes', value: 'Ilimitados' },
      { text: 'Usuarios del equipo', value: '6' },
      { text: 'Almacenamiento', value: '15 GB' },
      { text: 'Mensajes de WhatsApp / mes', value: '1,500+' },
    ],
    highlights: [
      { text: 'IA: análisis de radiografías', included: true },
      { text: 'IA: asistente clínico · 200 mil tokens/mes', included: true },
      { text: 'Analytics, reportes y Mi Clínica Visual 3D', included: true },
      { text: 'Proveedores, insumos y órdenes a laboratorios', included: true },
      { text: 'Varias clínicas en una cuenta', included: false },
      { text: 'Roles avanzados y soporte prioritario', included: false },
    ],
  },
  {
    key: 'clinica',
    name: 'Clínica',
    tagline: 'Para clínicas con varios consultorios',
    monthly: 1999,
    yearly: 16792,
    yearlyPerMonth: 1399,
    yearlySavings: 7196,
    addendumLabel: 'Todo lo de Profesional, y además:',
    capacity: [
      { text: 'Pacientes', value: 'Ilimitados' },
      { text: 'Usuarios del equipo', value: 'Ilimitados' },
      { text: 'Almacenamiento', value: '75 GB' },
      { text: 'Mensajes de WhatsApp / mes', value: '6,000+' },
    ],
    highlights: [
      { text: 'Varias clínicas en una cuenta', included: true },
      { text: 'Roles y permisos avanzados', included: true },
      { text: 'Soporte prioritario', included: true },
      { text: 'Onboarding y migración dedicados', included: true },
      { text: 'Cumplimiento NOM-024', included: true },
    ],
  },
];

/** Lista completa (~29 funciones). [básico, profesional, clínica] — true/false o valor string. */
type Cell = boolean | string;
const FULL_GROUPS: { title: string; rows: [string, Cell, Cell, Cell][] }[] = [
  {
    title: 'Incluido en todos los planes',
    rows: [
      ['Agenda + recordatorios por WhatsApp', true, true, true],
      ['Expediente clínico + odontograma', true, true, true],
      ['Recetas digitales (QR + cédula)', true, true, true],
      ['Facturación CFDI 4.0', true, true, true],
      ['Portal del paciente', true, true, true],
      ['Inbox / mensajes', true, true, true],
      ['Presupuestos y cotizaciones', true, true, true],
      ['Pagos en línea del paciente', true, true, true],
      ['Importar mi clínica (migración)', true, true, true],
      ['Página web + directorio público', true, true, true],
    ],
  },
  {
    title: 'Inteligencia artificial y herramientas pro',
    rows: [
      ['IA: análisis de radiografías', false, true, true],
      ['IA: asistente clínico', false, true, true],
      ['Tokens de IA / mes', false, '200 mil', '1 millón'],
      ['Analytics y reportes', false, true, true],
      ['Pantallas TV (sala de espera)', false, true, true],
      ['Mi Clínica Visual 3D', false, true, true],
      ['Visor CBCT / 3D dental', false, true, true],
      ['Proveedores e insumos', false, true, true],
      ['Órdenes a laboratorios', false, true, true],
    ],
  },
  {
    title: 'Para clínicas con varios consultorios',
    rows: [
      ['Varias clínicas en una cuenta', false, false, true],
      ['Roles y permisos avanzados', false, false, true],
      ['Soporte prioritario', false, false, true],
      ['Onboarding dedicado', false, false, true],
    ],
  },
  {
    title: 'Tranquilidad',
    rows: [
      ['Garantía de 30 días', true, true, true],
      ['Soporte en español · sin permanencia', true, true, true],
      ['Cumplimiento NOM-024', true, true, true],
    ],
  },
];

/** El signup valida ?plan= contra PlanId (BASIC|PRO|CLINIC) — ver signup-form.tsx. */
const PLAN_TO_SIGNUP: Record<Plan['key'], 'basic' | 'pro' | 'clinic'> = {
  basico: 'basic',
  profesional: 'pro',
  clinica: 'clinic',
};

const fmt = (n: number) => '$' + n.toLocaleString('es-MX');

function CheckIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={styles.check}>
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CrossIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" stroke="#cbd5e1" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function FeatureRow({ f }: { f: Feature }) {
  return (
    <li className={styles.featureRow}>
      <span className={styles.featureIcon}>{f.included ? <CheckIcon /> : <CrossIcon />}</span>
      <span className={styles.srOnly}>{f.included ? 'Incluido:' : 'No incluido:'}</span>
      <span className={f.included ? styles.featureText : styles.featureTextOff}>{f.text}</span>
      {f.value ? <span className={styles.featureValue}>{f.value}</span> : null}
    </li>
  );
}

export default function PricingSection() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('mensual');
  const [expanded, setExpanded] = useState(false); // abre/cierra los 3 planes a la vez

  const handleSelect = (planKey: Plan['key']) => {
    const billing = period === 'anual' ? 'annual' : 'monthly';
    router.push(`/signup?plan=${PLAN_TO_SIGNUP[planKey]}&billing=${billing}`);
  };

  return (
    <section className={styles.section} id="precios" aria-labelledby="planes-title">
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.eyebrow}>Planes y precios</div>
          <h2 id="planes-title" className={styles.title}>Un precio claro, todo incluido</h2>
          <p className={styles.subtitle}>
            Mira exactamente qué incluye —y qué no— cada plan. Sin letras chiquitas, sin permanencia y con instalación gratis.
          </p>
        </div>

        {/* Toggle Mensual / Anual */}
        <div className={styles.toggleWrap} role="group" aria-label="Periodo de facturación">
          <div className={styles.toggle}>
            <button
              type="button"
              onClick={() => setPeriod('mensual')}
              aria-pressed={period === 'mensual'}
              className={`${styles.toggleBtn} ${period === 'mensual' ? styles.toggleBtnActive : ''}`}
            >
              Mensual
            </button>
            <button
              type="button"
              onClick={() => setPeriod('anual')}
              aria-pressed={period === 'anual'}
              className={`${styles.toggleBtn} ${period === 'anual' ? styles.toggleBtnActive : ''}`}
            >
              Anual
              <span className={styles.savingsBadge}>30% de descuento</span>
            </button>
          </div>
        </div>

        {/* Tarjetas */}
        <div className={styles.grid}>
          {PLANS.map((plan, planIdx) => {
            const anual = period === 'anual';
            const big = anual ? plan.yearlyPerMonth : plan.monthly;
            return (
              <article
                key={plan.key}
                className={`${styles.card} ${plan.recommended ? styles.cardRecommended : ''}`}
              >
                {plan.recommended && <div className={styles.badge}>★ Recomendado</div>}

                <div className={styles.planName}>{plan.name}</div>
                <p className={styles.tagline}>{plan.tagline}</p>

                <div className={styles.priceRow}>
                  <span className={styles.priceBig}>{fmt(big)}</span>
                  <span className={styles.priceUnit}>MXN<br />/mes</span>
                </div>
                <div className={styles.priceMeta}>Sin permanencia · cancela cuando quieras</div>
                {anual && (
                  <div className={styles.annualNote}>
                    Facturado anualmente: {fmt(plan.yearly)} ·{' '}
                    <span className={styles.savings}>ahorras {fmt(plan.yearlySavings)}</span>
                  </div>
                )}

                <div className={styles.installChip}>
                  <span className={styles.installCheck}>✓</span>
                  Instalación <s className={styles.strike}>$500</s> incluida sin costo
                </div>

                <div className={styles.divider} />

                {/* Capacidad */}
                <ul className={styles.capacityList}>
                  {plan.capacity.map((c) => (
                    <li key={c.text} className={styles.featureRow}>
                      <span className={styles.featureIcon}><CheckIcon /></span>
                      <span className={styles.featureText} style={{ flex: 1 }}>{c.text}</span>
                      <span className={styles.capacityPill}>{c.value}</span>
                    </li>
                  ))}
                </ul>

                {plan.addendumLabel && <div className={styles.addendum}>{plan.addendumLabel}</div>}

                {/* Highlights ✓/✗ */}
                <ul className={styles.featureList}>
                  {plan.highlights.map((f) => <FeatureRow key={f.text} f={f} />)}
                </ul>

                {/* Expandir lista completa (abre los 3 planes) */}
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                  className={styles.expandBtn}
                >
                  {expanded ? 'Ocultar beneficios' : 'Ver todos los beneficios'}
                  <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}>▾</span>
                </button>

                {expanded && (
                  <div className={styles.fullList}>
                    {FULL_GROUPS.map((grp) => (
                      <div key={grp.title}>
                        <div className={styles.groupTitle}>{grp.title}</div>
                        <ul className={styles.featureList}>
                          {grp.rows.map((row) => {
                            const cell = row[planIdx + 1] as Cell;
                            const f: Feature =
                              typeof cell === 'string'
                                ? { text: row[0], included: true, value: cell }
                                : { text: row[0], included: cell };
                            return <FeatureRow key={row[0]} f={f} />;
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleSelect(plan.key)}
                  className={plan.recommended ? styles.ctaPrimary : styles.ctaSecondary}
                >
                  ¡Empieza ya!
                </button>
              </article>
            );
          })}
        </div>

        {/* Trust chips */}
        <div className={styles.trustRow}>
          <div className={styles.trustChip}><CheckIcon /> Instalación $500 incluida sin costo</div>
          <div className={styles.trustChip}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={styles.check}>
              <path d="M12 3l7 3v5c0 4.4-3 8.5-7 10-4-1.5-7-5.6-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            Garantía de 30 días
          </div>
          <div className={styles.trustChip}><CheckIcon /> Sin permanencia</div>
        </div>

        <p className={styles.footnote}>
          Incluye migración de tus datos, soporte en español y cumplimiento CFDI 4.0 / NOM-024. Precios en pesos mexicanos + IVA.
        </p>
      </div>
    </section>
  );
}
