/* eslint-disable no-console */
/**
 * Seed del catálogo de módulos del Marketplace (Sprint 1).
 *
 * Idempotente: usa upsert por `key`, así que se puede correr N veces
 * sin duplicar y se puede usar para actualizar precios o features.
 *
 * Uso:
 *   npx tsx prisma/seed.ts
 *   # o vía npm script:
 *   npm run seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedModule {
  key: string;
  name: string;
  category: string;
  description: string;
  iconKey: string;
  iconBg: string;
  iconColor: string;
  features: string[];
  priceMxnMonthly: number;
}

// Catálogo activo del marketplace. Decisión de Rafael (2026-04-30): por
// ahora solo se exponen los 6 módulos dentales en producción. Los 6
// no-dentales viven en `FUTURE_MODULES` abajo y se reactivan cuando se
// lance la expansión multi-tipo de clínica.
//
// Para ocultar/mostrar manualmente sin re-seedear, usa el campo `is_active`
// en la tabla `modules` directo (ver sql/marketplace-only-dental.sql).
const SEED_MODULES: SeedModule[] = [
  {
    key: "general-dentistry",
    name: "Odontología General",
    category: "Dental",
    description: "Odontograma interactivo y catálogo completo de procedimientos.",
    iconKey: "Smile",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    features: [
      "Odontograma FDI / Universal / Palmer",
      "Histórico por pieza dental",
      "Catálogo de 80+ procedimientos",
    ],
    priceMxnMonthly: 249,
  },
  {
    key: "orthodontics",
    name: "Ortodoncia",
    category: "Dental",
    description: "Suite para ortodoncistas: brackets, autoligado y alineadores.",
    iconKey: "Activity",
    iconBg: "bg-cyan-50",
    iconColor: "text-cyan-600",
    features: [
      "Fases de tratamiento",
      "Tracking de alineadores",
      "Recordatorios automáticos por WhatsApp",
    ],
    priceMxnMonthly: 329,
  },
  {
    key: "periodontics",
    name: "Periodoncia",
    category: "Dental",
    description: "Periodontograma de 6 sitios con índices y comparativos visuales.",
    iconKey: "Layers",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    features: [
      "Sondaje y sangrado",
      "Índices de placa y O'Leary",
      "Programa de mantenimiento",
    ],
    priceMxnMonthly: 279,
  },
  {
    key: "endodontics",
    name: "Endodoncia",
    category: "Dental",
    description: "Diagrama de conductos por diente con protocolo de irrigación.",
    iconKey: "Syringe",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    features: [
      "Conductos por diente",
      "Longitud de trabajo",
      "Protocolos de irrigación",
    ],
    priceMxnMonthly: 279,
  },
  {
    key: "implantology",
    name: "Implantología",
    category: "Dental",
    description: "Registro por implante con timeline de osteointegración.",
    iconKey: "Bone",
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    features: [
      "Marca, modelo, lote y torque",
      "Timeline de osteointegración",
      "Etiqueta de garantía",
    ],
    priceMxnMonthly: 349,
  },
  {
    key: "pediatric-dentistry",
    name: "Odontopediatría",
    category: "Dental",
    description: "Curvas dentales, escala de Frankl y consentimiento parental.",
    iconKey: "Baby",
    iconBg: "bg-pink-50",
    iconColor: "text-pink-600",
    features: [
      "Cronograma de erupción",
      "Escala de Frankl",
      "Consentimiento parental digital",
    ],
    priceMxnMonthly: 249,
  },
];

// Catálogo "guardado para después". NO se itera en el seed — solo vive
// como referencia para cuando MediFlow lance las especialidades médicas y
// estéticas. Para activarlos en su momento:
//   1. Mueve las entradas relevantes de FUTURE_MODULES a SEED_MODULES.
//   2. Corre `npx tsx prisma/seed.ts`.
//   3. (Opcional) Si ya estaban en BD con is_active=false, aplica
//      sql/marketplace-only-dental.sql con la query inversa comentada al
//      final del archivo.
const FUTURE_MODULES: SeedModule[] = [
  {
    key: "pediatrics",
    name: "Pediatría",
    category: "Pediatría",
    description: "Curvas OMS, vacunación mexicana e hitos del desarrollo.",
    iconKey: "Baby",
    iconBg: "bg-pink-50",
    iconColor: "text-pink-600",
    features: [
      "Curvas de crecimiento OMS",
      "Esquema de vacunación MX",
      "Hitos del desarrollo",
    ],
    priceMxnMonthly: 279,
  },
  {
    key: "cardiology",
    name: "Cardiología",
    category: "Cardiología",
    description: "TA con tendencias, ECG, score de riesgo cardiovascular.",
    iconKey: "Heart",
    iconBg: "bg-red-50",
    iconColor: "text-red-600",
    features: [
      "Tensión arterial con gráfico",
      "ECG y Holter",
      "Score Framingham / ASCVD",
    ],
    priceMxnMonthly: 349,
  },
  {
    key: "dermatology",
    name: "Dermatología",
    category: "Dermatología",
    description: "Mapa corporal de lesiones con fotos dermatoscópicas.",
    iconKey: "Sparkles",
    iconBg: "bg-orange-50",
    iconColor: "text-orange-600",
    features: [
      "Mapa corporal interactivo",
      "Fotos dermatoscópicas",
      "Comparativos pre/post",
    ],
    priceMxnMonthly: 329,
  },
  {
    key: "gynecology",
    name: "Ginecología",
    category: "Ginecología",
    description: "Calendario obstétrico, ultrasonidos y plan prenatal.",
    iconKey: "Activity",
    iconBg: "bg-purple-50",
    iconColor: "text-purple-600",
    features: [
      "Edad gestacional automática",
      "Papanicolaou histórico",
      "Plan prenatal estándar",
    ],
    priceMxnMonthly: 329,
  },
  {
    key: "nutrition",
    name: "Nutrición",
    category: "Nutrición",
    description: "Antropometría, plan de alimentación y comparativos.",
    iconKey: "Apple",
    iconBg: "bg-green-50",
    iconColor: "text-green-600",
    features: [
      "Pliegues y perímetros",
      "Plan con porciones",
      "Recordatorios de pesaje",
    ],
    priceMxnMonthly: 229,
  },
  {
    key: "aesthetic-medicine",
    name: "Medicina Estética",
    category: "Estética",
    description: "Antes/después, tracking de toxina y rellenos por lote.",
    iconKey: "Sparkles",
    iconBg: "bg-fuchsia-50",
    iconColor: "text-fuchsia-600",
    features: [
      "Fotos estandarizadas",
      "Toxina: zonas, unidades, lote",
      "Sesiones de láser",
    ],
    priceMxnMonthly: 399,
  },
];

async function main() {
  console.log(
    `Seed marketplace: upsert de ${SEED_MODULES.length} módulos activos ` +
    `(${FUTURE_MODULES.length} reservados en FUTURE_MODULES, no se siembran)…`,
  );

  for (let index = 0; index < SEED_MODULES.length; index++) {
    const mod = SEED_MODULES[index];
    const sortOrder = index + 1;
    await prisma.module.upsert({
      where: { key: mod.key },
      update: {
        name: mod.name,
        category: mod.category,
        description: mod.description,
        iconKey: mod.iconKey,
        iconBg: mod.iconBg,
        iconColor: mod.iconColor,
        features: mod.features,
        priceMxnMonthly: mod.priceMxnMonthly,
        sortOrder,
        isActive: true,
      },
      create: {
        key: mod.key,
        name: mod.name,
        category: mod.category,
        description: mod.description,
        iconKey: mod.iconKey,
        iconBg: mod.iconBg,
        iconColor: mod.iconColor,
        features: mod.features,
        priceMxnMonthly: mod.priceMxnMonthly,
        sortOrder,
      },
    });
    console.log(`  ✓ ${mod.key.padEnd(22)} $${mod.priceMxnMonthly}/mes  (sortOrder=${sortOrder})`);
  }

  const total = await prisma.module.count();
  console.log(`\nListo. Total de módulos en BD: ${total}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
