/**
 * CUMS essentials — medicamentos más usados en odontología y medicina
 * general en MX. Las claves siguen formato "MX-XXXX" (interno MediFlow)
 * porque el catálogo CUMS oficial cambia trimestralmente y debe importarse
 * vía POST /api/admin/seed-cums con el archivo oficial cuando esté
 * disponible. La tabla soporta las claves oficiales sin cambios.
 *
 * COFEPRIS groups (sustancias controladas):
 *  - I:   Estupefacientes (morfina, oxicodona, fentanilo)
 *  - II:  Psicotrópicos (BZD, metilfenidato, opioides débiles)
 *  - III: Antidepresivos / antipsicóticos
 *  - IV:  Otros que requieren receta
 *  - V:   Venta libre / OTC
 *  - VI:  Productos especiales
 *
 * Se incluyen ~180 entradas. El catálogo es global (sin clinicId).
 */

export interface CumsSeed {
  clave: string;
  descripcion: string;
  presentacion: string;
  formaFarmaceutica?: string;
  grupoTerapeutico?: string;
  cofeprisGroup?: string;
}

const ANALGESIC = "Analgésicos y antiinflamatorios";
const ANTIBIOTIC = "Antibióticos";
const ANTIVIRAL = "Antivirales";
const ANTIFUNGAL = "Antifúngicos";
const ANTIPARASITIC = "Antiparasitarios";
const ANTIHISTAMINE = "Antihistamínicos";
const GI = "Gastrointestinales";
const RESPIRATORY = "Respiratorios";
const CARDIO = "Cardiovasculares";
const DIABETES = "Antidiabéticos";
const LIPID = "Hipolipemiantes";
const PSYCH = "Psicotrópicos";
const NEURO = "Neurológicos";
const OPHTHAL = "Oftálmicos";
const DERM = "Dermatológicos";
const HORMONAL = "Hormonales";
const VITAMINS = "Vitaminas y suplementos";
const ANESTHETIC = "Anestésicos locales";
const ORAL_DENTAL = "Salud bucal y dental";
const VACCINE = "Vacunas";

export const CUMS_ESSENTIALS: CumsSeed[] = [
  // ── Analgésicos / antiinflamatorios ────────────────────────────────
  { clave: "MX-0001", descripcion: "Paracetamol",                presentacion: "500 mg, caja c/10 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0002", descripcion: "Paracetamol",                presentacion: "100 mg/mL gotas, frasco 15 mL", formaFarmaceutica: "Solución",   grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0003", descripcion: "Paracetamol",                presentacion: "120 mg/5 mL suspensión, frasco 60 mL", formaFarmaceutica: "Suspensión", grupoTerapeutico: ANALGESIC, cofeprisGroup: "V" },
  { clave: "MX-0004", descripcion: "Ibuprofeno",                 presentacion: "400 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0005", descripcion: "Ibuprofeno",                 presentacion: "200 mg/5 mL suspensión, frasco 60 mL", formaFarmaceutica: "Suspensión", grupoTerapeutico: ANALGESIC, cofeprisGroup: "V" },
  { clave: "MX-0006", descripcion: "Naproxeno",                  presentacion: "250 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0007", descripcion: "Naproxeno sódico",           presentacion: "275 mg, caja c/24 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0008", descripcion: "Diclofenaco sódico",         presentacion: "100 mg, caja c/20 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0009", descripcion: "Diclofenaco gel 1%",         presentacion: "Tubo 60 g",                    formaFarmaceutica: "Gel tópico",  grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0010", descripcion: "Ketorolaco",                 presentacion: "10 mg, caja c/10 tabletas sublinguales", formaFarmaceutica: "Tableta sublingual", grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0011", descripcion: "Ketorolaco",                 presentacion: "30 mg/mL solución inyectable, ampolleta", formaFarmaceutica: "Inyectable", grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0012", descripcion: "Meloxicam",                  presentacion: "15 mg, caja c/20 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0013", descripcion: "Celecoxib",                  presentacion: "200 mg, caja c/20 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0014", descripcion: "Etoricoxib",                 presentacion: "90 mg, caja c/14 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0015", descripcion: "Ácido acetilsalicílico",     presentacion: "500 mg, caja c/20 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0016", descripcion: "Aspirina protect",           presentacion: "100 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta entérica", grupoTerapeutico: ANALGESIC, cofeprisGroup: "V" },
  { clave: "MX-0017", descripcion: "Tramadol",                   presentacion: "50 mg, caja c/10 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANALGESIC, cofeprisGroup: "III" },
  { clave: "MX-0018", descripcion: "Tramadol + Paracetamol",     presentacion: "37.5/325 mg, caja c/10 tabletas", formaFarmaceutica: "Tableta",  grupoTerapeutico: ANALGESIC, cofeprisGroup: "III" },
  { clave: "MX-0019", descripcion: "Codeína + Paracetamol",      presentacion: "30/500 mg, caja c/20 tabletas", formaFarmaceutica: "Tableta",   grupoTerapeutico: ANALGESIC, cofeprisGroup: "II" },
  { clave: "MX-0020", descripcion: "Morfina sulfato",            presentacion: "10 mg/mL inyectable, ampolleta", formaFarmaceutica: "Inyectable", grupoTerapeutico: ANALGESIC, cofeprisGroup: "I" },
  { clave: "MX-0021", descripcion: "Buprenorfina parche",        presentacion: "5 mcg/h transdérmico, caja c/4", formaFarmaceutica: "Parche",   grupoTerapeutico: ANALGESIC, cofeprisGroup: "I" },
  { clave: "MX-0022", descripcion: "Fentanilo parche",           presentacion: "25 mcg/h transdérmico, caja c/5", formaFarmaceutica: "Parche",  grupoTerapeutico: ANALGESIC, cofeprisGroup: "I" },

  // ── Antibióticos ───────────────────────────────────────────────────
  { clave: "MX-0030", descripcion: "Amoxicilina",                 presentacion: "500 mg, caja c/12 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0031", descripcion: "Amoxicilina + ácido clavulánico", presentacion: "500/125 mg, caja c/15 tabletas", formaFarmaceutica: "Tableta", grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0032", descripcion: "Amoxicilina suspensión",      presentacion: "250 mg/5 mL, frasco 60 mL",    formaFarmaceutica: "Suspensión",  grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0033", descripcion: "Ampicilina",                  presentacion: "500 mg, caja c/20 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0034", descripcion: "Penicilina G benzatínica",    presentacion: "1,200,000 UI inyectable, frasco ámpula", formaFarmaceutica: "Inyectable", grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0035", descripcion: "Cefalexina",                  presentacion: "500 mg, caja c/20 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0036", descripcion: "Cefadroxilo",                 presentacion: "500 mg, caja c/12 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0037", descripcion: "Cefuroxima",                  presentacion: "500 mg, caja c/10 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0038", descripcion: "Ceftriaxona",                 presentacion: "1 g inyectable, frasco ámpula", formaFarmaceutica: "Inyectable", grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0039", descripcion: "Azitromicina",                presentacion: "500 mg, caja c/3 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0040", descripcion: "Claritromicina",              presentacion: "500 mg, caja c/14 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0041", descripcion: "Eritromicina",                presentacion: "500 mg, caja c/20 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0042", descripcion: "Clindamicina",                presentacion: "300 mg, caja c/16 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0043", descripcion: "Metronidazol",                presentacion: "500 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0044", descripcion: "Trimetoprim/Sulfametoxazol",  presentacion: "160/800 mg, caja c/20 tabletas", formaFarmaceutica: "Tableta",   grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0045", descripcion: "Doxiciclina",                 presentacion: "100 mg, caja c/14 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0046", descripcion: "Tetraciclina",                presentacion: "500 mg, caja c/20 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0047", descripcion: "Levofloxacino",               presentacion: "500 mg, caja c/7 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0048", descripcion: "Ciprofloxacino",              presentacion: "500 mg, caja c/10 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0049", descripcion: "Moxifloxacino",               presentacion: "400 mg, caja c/5 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0050", descripcion: "Nitrofurantoína",             presentacion: "100 mg, caja c/30 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0051", descripcion: "Vancomicina",                 presentacion: "500 mg inyectable, frasco ámpula", formaFarmaceutica: "Inyectable", grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0052", descripcion: "Linezolid",                   presentacion: "600 mg, caja c/10 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0053", descripcion: "Gentamicina",                 presentacion: "80 mg/2 mL inyectable, ampolleta", formaFarmaceutica: "Inyectable", grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },

  // ── Antivirales ────────────────────────────────────────────────────
  { clave: "MX-0070", descripcion: "Aciclovir",                   presentacion: "200 mg, caja c/25 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIVIRAL, cofeprisGroup: "IV" },
  { clave: "MX-0071", descripcion: "Aciclovir crema 5%",          presentacion: "Tubo 5 g",                     formaFarmaceutica: "Crema tópica", grupoTerapeutico: ANTIVIRAL, cofeprisGroup: "V" },
  { clave: "MX-0072", descripcion: "Valaciclovir",                presentacion: "500 mg, caja c/10 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIVIRAL, cofeprisGroup: "IV" },
  { clave: "MX-0073", descripcion: "Oseltamivir",                 presentacion: "75 mg, caja c/10 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIVIRAL, cofeprisGroup: "IV" },

  // ── Antifúngicos ───────────────────────────────────────────────────
  { clave: "MX-0080", descripcion: "Fluconazol",                  presentacion: "150 mg, caja c/1 cápsula",     formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },
  { clave: "MX-0081", descripcion: "Itraconazol",                 presentacion: "100 mg, caja c/15 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },
  { clave: "MX-0082", descripcion: "Ketoconazol crema 2%",        presentacion: "Tubo 30 g",                    formaFarmaceutica: "Crema tópica", grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "V" },
  { clave: "MX-0083", descripcion: "Nistatina suspensión",        presentacion: "100,000 UI/mL, frasco 24 mL",  formaFarmaceutica: "Suspensión",  grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },
  { clave: "MX-0084", descripcion: "Clotrimazol crema 1%",        presentacion: "Tubo 30 g",                    formaFarmaceutica: "Crema tópica", grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "V" },
  { clave: "MX-0085", descripcion: "Terbinafina",                 presentacion: "250 mg, caja c/14 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },

  // ── Antiparasitarios ───────────────────────────────────────────────
  { clave: "MX-0090", descripcion: "Albendazol",                  presentacion: "400 mg, caja c/2 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIPARASITIC, cofeprisGroup: "IV" },
  { clave: "MX-0091", descripcion: "Mebendazol",                  presentacion: "100 mg, caja c/6 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIPARASITIC, cofeprisGroup: "IV" },
  { clave: "MX-0092", descripcion: "Metronidazol suspensión",     presentacion: "250 mg/5 mL, frasco 100 mL",   formaFarmaceutica: "Suspensión",  grupoTerapeutico: ANTIPARASITIC, cofeprisGroup: "IV" },
  { clave: "MX-0093", descripcion: "Praziquantel",                presentacion: "600 mg, caja c/4 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIPARASITIC, cofeprisGroup: "IV" },
  { clave: "MX-0094", descripcion: "Nitazoxanida",                presentacion: "500 mg, caja c/6 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIPARASITIC, cofeprisGroup: "IV" },
  { clave: "MX-0095", descripcion: "Permetrina loción 1%",        presentacion: "Frasco 60 mL",                 formaFarmaceutica: "Loción",      grupoTerapeutico: ANTIPARASITIC, cofeprisGroup: "V" },

  // ── Antihistamínicos ───────────────────────────────────────────────
  { clave: "MX-0100", descripcion: "Loratadina",                  presentacion: "10 mg, caja c/10 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIHISTAMINE, cofeprisGroup: "V" },
  { clave: "MX-0101", descripcion: "Cetirizina",                  presentacion: "10 mg, caja c/10 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIHISTAMINE, cofeprisGroup: "V" },
  { clave: "MX-0102", descripcion: "Desloratadina",               presentacion: "5 mg, caja c/10 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIHISTAMINE, cofeprisGroup: "V" },
  { clave: "MX-0103", descripcion: "Fexofenadina",                presentacion: "120 mg, caja c/10 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIHISTAMINE, cofeprisGroup: "V" },
  { clave: "MX-0104", descripcion: "Difenhidramina",              presentacion: "50 mg, caja c/20 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: ANTIHISTAMINE, cofeprisGroup: "V" },
  { clave: "MX-0105", descripcion: "Clorfenamina",                presentacion: "4 mg, caja c/20 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIHISTAMINE, cofeprisGroup: "V" },
  { clave: "MX-0106", descripcion: "Hidroxizina",                 presentacion: "25 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: ANTIHISTAMINE, cofeprisGroup: "IV" },

  // ── Gastrointestinales ─────────────────────────────────────────────
  { clave: "MX-0110", descripcion: "Omeprazol",                   presentacion: "20 mg, caja c/14 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0111", descripcion: "Pantoprazol",                 presentacion: "40 mg, caja c/14 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0112", descripcion: "Esomeprazol",                 presentacion: "40 mg, caja c/14 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0113", descripcion: "Lansoprazol",                 presentacion: "30 mg, caja c/14 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0114", descripcion: "Ranitidina",                  presentacion: "150 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0115", descripcion: "Famotidina",                  presentacion: "20 mg, caja c/20 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0116", descripcion: "Hidróxido de aluminio + magnesio", presentacion: "Suspensión, frasco 240 mL", formaFarmaceutica: "Suspensión", grupoTerapeutico: GI, cofeprisGroup: "V" },
  { clave: "MX-0117", descripcion: "Butilhioscina",               presentacion: "10 mg, caja c/10 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0118", descripcion: "Trimebutina",                 presentacion: "200 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0119", descripcion: "Loperamida",                  presentacion: "2 mg, caja c/12 cápsulas",     formaFarmaceutica: "Cápsula",     grupoTerapeutico: GI, cofeprisGroup: "V" },
  { clave: "MX-0120", descripcion: "Bismuto subsalicilato",       presentacion: "Suspensión, frasco 240 mL",    formaFarmaceutica: "Suspensión",  grupoTerapeutico: GI, cofeprisGroup: "V" },
  { clave: "MX-0121", descripcion: "Polietilenglicol",            presentacion: "17 g sobres, caja c/30",       formaFarmaceutica: "Polvo",       grupoTerapeutico: GI, cofeprisGroup: "V" },
  { clave: "MX-0122", descripcion: "Lactulosa",                   presentacion: "Solución 65%, frasco 240 mL",  formaFarmaceutica: "Solución",    grupoTerapeutico: GI, cofeprisGroup: "V" },
  { clave: "MX-0123", descripcion: "Senósidos A y B",             presentacion: "8.6 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "V" },
  { clave: "MX-0124", descripcion: "Ondansetrón",                 presentacion: "8 mg, caja c/10 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0125", descripcion: "Metoclopramida",              presentacion: "10 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0126", descripcion: "Sulfasalazina",               presentacion: "500 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },
  { clave: "MX-0127", descripcion: "Mesalazina",                  presentacion: "500 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: GI, cofeprisGroup: "IV" },

  // ── Respiratorios ──────────────────────────────────────────────────
  { clave: "MX-0140", descripcion: "Salbutamol inhalador",        presentacion: "100 mcg/puff, frasco 200 dosis", formaFarmaceutica: "Aerosol",   grupoTerapeutico: RESPIRATORY, cofeprisGroup: "IV" },
  { clave: "MX-0141", descripcion: "Salbutamol nebulizador",      presentacion: "0.5% solución, frasco 20 mL",  formaFarmaceutica: "Solución",    grupoTerapeutico: RESPIRATORY, cofeprisGroup: "IV" },
  { clave: "MX-0142", descripcion: "Salmeterol + Fluticasona",    presentacion: "50/250 mcg, inhalador 60 dosis", formaFarmaceutica: "Polvo inh.", grupoTerapeutico: RESPIRATORY, cofeprisGroup: "IV" },
  { clave: "MX-0143", descripcion: "Formoterol + Budesonida",     presentacion: "4.5/160 mcg, inhalador 120 dosis", formaFarmaceutica: "Polvo inh.", grupoTerapeutico: RESPIRATORY, cofeprisGroup: "IV" },
  { clave: "MX-0144", descripcion: "Tiotropio",                   presentacion: "18 mcg, inhalador 30 cápsulas", formaFarmaceutica: "Polvo inh.", grupoTerapeutico: RESPIRATORY, cofeprisGroup: "IV" },
  { clave: "MX-0145", descripcion: "Bromuro de ipratropio",       presentacion: "20 mcg/puff, inhalador",       formaFarmaceutica: "Aerosol",     grupoTerapeutico: RESPIRATORY, cofeprisGroup: "IV" },
  { clave: "MX-0146", descripcion: "Montelukast",                 presentacion: "10 mg, caja c/10 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: RESPIRATORY, cofeprisGroup: "IV" },
  { clave: "MX-0147", descripcion: "Ambroxol",                    presentacion: "30 mg, caja c/20 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: RESPIRATORY, cofeprisGroup: "V"  },
  { clave: "MX-0148", descripcion: "Acetilcisteína",              presentacion: "600 mg, caja c/10 sobres efervescentes", formaFarmaceutica: "Sobre", grupoTerapeutico: RESPIRATORY, cofeprisGroup: "V" },
  { clave: "MX-0149", descripcion: "Bromhexina",                  presentacion: "Jarabe 4 mg/5 mL, frasco 120 mL", formaFarmaceutica: "Jarabe",   grupoTerapeutico: RESPIRATORY, cofeprisGroup: "V" },
  { clave: "MX-0150", descripcion: "Dextrometorfano",             presentacion: "15 mg/5 mL jarabe, frasco 120 mL", formaFarmaceutica: "Jarabe",  grupoTerapeutico: RESPIRATORY, cofeprisGroup: "V" },

  // ── Cardiovasculares ───────────────────────────────────────────────
  { clave: "MX-0160", descripcion: "Enalapril",                   presentacion: "10 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0161", descripcion: "Captopril",                   presentacion: "25 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0162", descripcion: "Lisinopril",                  presentacion: "10 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0163", descripcion: "Ramipril",                    presentacion: "5 mg, caja c/30 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0164", descripcion: "Losartán",                    presentacion: "50 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0165", descripcion: "Telmisartán",                 presentacion: "80 mg, caja c/14 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0166", descripcion: "Valsartán",                   presentacion: "160 mg, caja c/28 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0167", descripcion: "Irbesartán",                  presentacion: "150 mg, caja c/14 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0168", descripcion: "Atenolol",                    presentacion: "50 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0169", descripcion: "Metoprolol",                  presentacion: "100 mg, caja c/20 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0170", descripcion: "Bisoprolol",                  presentacion: "5 mg, caja c/30 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0171", descripcion: "Carvedilol",                  presentacion: "12.5 mg, caja c/30 tabletas",  formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0172", descripcion: "Propranolol",                 presentacion: "40 mg, caja c/20 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0173", descripcion: "Amlodipino",                  presentacion: "5 mg, caja c/30 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0174", descripcion: "Nifedipino",                  presentacion: "30 mg, caja c/30 tabletas LP", formaFarmaceutica: "Tableta LP",  grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0175", descripcion: "Diltiazem",                   presentacion: "120 mg, caja c/30 cápsulas LP", formaFarmaceutica: "Cápsula LP", grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0176", descripcion: "Verapamilo",                  presentacion: "80 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0177", descripcion: "Furosemida",                  presentacion: "40 mg, caja c/20 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0178", descripcion: "Hidroclorotiazida",           presentacion: "25 mg, caja c/20 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0179", descripcion: "Espironolactona",             presentacion: "25 mg, caja c/20 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0180", descripcion: "Indapamida",                  presentacion: "1.5 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0181", descripcion: "Digoxina",                    presentacion: "0.25 mg, caja c/30 tabletas",  formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0182", descripcion: "Amiodarona",                  presentacion: "200 mg, caja c/20 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0183", descripcion: "Warfarina",                   presentacion: "5 mg, caja c/30 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0184", descripcion: "Rivaroxabán",                 presentacion: "20 mg, caja c/28 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0185", descripcion: "Apixabán",                    presentacion: "5 mg, caja c/60 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0186", descripcion: "Dabigatrán",                  presentacion: "150 mg, caja c/60 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },
  { clave: "MX-0187", descripcion: "Clopidogrel",                 presentacion: "75 mg, caja c/28 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: CARDIO, cofeprisGroup: "IV" },

  // ── Hipolipemiantes ────────────────────────────────────────────────
  { clave: "MX-0200", descripcion: "Atorvastatina",               presentacion: "20 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: LIPID, cofeprisGroup: "IV" },
  { clave: "MX-0201", descripcion: "Rosuvastatina",               presentacion: "10 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: LIPID, cofeprisGroup: "IV" },
  { clave: "MX-0202", descripcion: "Simvastatina",                presentacion: "20 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: LIPID, cofeprisGroup: "IV" },
  { clave: "MX-0203", descripcion: "Pravastatina",                presentacion: "40 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: LIPID, cofeprisGroup: "IV" },
  { clave: "MX-0204", descripcion: "Ezetimiba",                   presentacion: "10 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: LIPID, cofeprisGroup: "IV" },
  { clave: "MX-0205", descripcion: "Fenofibrato",                 presentacion: "200 mg, caja c/30 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: LIPID, cofeprisGroup: "IV" },
  { clave: "MX-0206", descripcion: "Bezafibrato",                 presentacion: "400 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: LIPID, cofeprisGroup: "IV" },

  // ── Antidiabéticos ─────────────────────────────────────────────────
  { clave: "MX-0220", descripcion: "Metformina",                  presentacion: "850 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0221", descripcion: "Metformina LP",               presentacion: "1000 mg, caja c/60 tabletas LP", formaFarmaceutica: "Tableta LP", grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0222", descripcion: "Glibenclamida",               presentacion: "5 mg, caja c/50 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0223", descripcion: "Glimepirida",                 presentacion: "4 mg, caja c/30 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0224", descripcion: "Gliclazida",                  presentacion: "60 mg LP, caja c/30 tabletas", formaFarmaceutica: "Tableta LP",  grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0225", descripcion: "Pioglitazona",                presentacion: "30 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0226", descripcion: "Sitagliptina",                presentacion: "100 mg, caja c/28 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0227", descripcion: "Linagliptina",                presentacion: "5 mg, caja c/30 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0228", descripcion: "Empagliflozina",              presentacion: "25 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0229", descripcion: "Dapagliflozina",              presentacion: "10 mg, caja c/28 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0230", descripcion: "Canagliflozina",              presentacion: "300 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0231", descripcion: "Insulina humana NPH",         presentacion: "100 UI/mL, frasco 10 mL",      formaFarmaceutica: "Inyectable",  grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0232", descripcion: "Insulina humana regular",     presentacion: "100 UI/mL, frasco 10 mL",      formaFarmaceutica: "Inyectable",  grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0233", descripcion: "Insulina glargina",           presentacion: "100 UI/mL, pluma 3 mL",        formaFarmaceutica: "Inyectable",  grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0234", descripcion: "Insulina detemir",            presentacion: "100 UI/mL, pluma 3 mL",        formaFarmaceutica: "Inyectable",  grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0235", descripcion: "Insulina aspart",             presentacion: "100 UI/mL, pluma 3 mL",        formaFarmaceutica: "Inyectable",  grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },
  { clave: "MX-0236", descripcion: "Insulina lispro",             presentacion: "100 UI/mL, pluma 3 mL",        formaFarmaceutica: "Inyectable",  grupoTerapeutico: DIABETES, cofeprisGroup: "IV" },

  // ── Psicotrópicos / antidepresivos ─────────────────────────────────
  { clave: "MX-0260", descripcion: "Diazepam",                    presentacion: "5 mg, caja c/30 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "II" },
  { clave: "MX-0261", descripcion: "Lorazepam",                   presentacion: "1 mg, caja c/40 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "II" },
  { clave: "MX-0262", descripcion: "Alprazolam",                  presentacion: "0.5 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "II" },
  { clave: "MX-0263", descripcion: "Clonazepam",                  presentacion: "0.5 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "II" },
  { clave: "MX-0264", descripcion: "Bromazepam",                  presentacion: "3 mg, caja c/30 cápsulas",     formaFarmaceutica: "Cápsula",     grupoTerapeutico: PSYCH, cofeprisGroup: "II" },
  { clave: "MX-0265", descripcion: "Fluoxetina",                  presentacion: "20 mg, caja c/30 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0266", descripcion: "Sertralina",                  presentacion: "50 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0267", descripcion: "Paroxetina",                  presentacion: "20 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0268", descripcion: "Escitalopram",                presentacion: "10 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0269", descripcion: "Citalopram",                  presentacion: "20 mg, caja c/28 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0270", descripcion: "Venlafaxina",                 presentacion: "75 mg LP, caja c/30 cápsulas", formaFarmaceutica: "Cápsula LP",  grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0271", descripcion: "Duloxetina",                  presentacion: "60 mg, caja c/28 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0272", descripcion: "Mirtazapina",                 presentacion: "30 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0273", descripcion: "Bupropion",                   presentacion: "150 mg LP, caja c/30 tabletas", formaFarmaceutica: "Tableta LP", grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0274", descripcion: "Trazodona",                   presentacion: "100 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0275", descripcion: "Quetiapina",                  presentacion: "100 mg, caja c/60 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0276", descripcion: "Risperidona",                 presentacion: "2 mg, caja c/20 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0277", descripcion: "Olanzapina",                  presentacion: "10 mg, caja c/28 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0278", descripcion: "Aripiprazol",                 presentacion: "10 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0279", descripcion: "Litio carbonato",             presentacion: "300 mg, caja c/50 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: PSYCH, cofeprisGroup: "III" },
  { clave: "MX-0280", descripcion: "Metilfenidato",               presentacion: "10 mg, caja c/30 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "II" },
  { clave: "MX-0281", descripcion: "Zolpidem",                    presentacion: "10 mg, caja c/14 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: PSYCH, cofeprisGroup: "II" },

  // ── Neurológicos / antiepilépticos ─────────────────────────────────
  { clave: "MX-0300", descripcion: "Carbamazepina",               presentacion: "200 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: NEURO, cofeprisGroup: "IV" },
  { clave: "MX-0301", descripcion: "Fenitoína",                   presentacion: "100 mg, caja c/50 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: NEURO, cofeprisGroup: "IV" },
  { clave: "MX-0302", descripcion: "Ácido valproico",             presentacion: "500 mg, caja c/30 tabletas LP", formaFarmaceutica: "Tableta LP", grupoTerapeutico: NEURO, cofeprisGroup: "IV" },
  { clave: "MX-0303", descripcion: "Lamotrigina",                 presentacion: "100 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: NEURO, cofeprisGroup: "IV" },
  { clave: "MX-0304", descripcion: "Levetiracetam",               presentacion: "500 mg, caja c/60 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: NEURO, cofeprisGroup: "IV" },
  { clave: "MX-0305", descripcion: "Topiramato",                  presentacion: "100 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: NEURO, cofeprisGroup: "IV" },
  { clave: "MX-0306", descripcion: "Pregabalina",                 presentacion: "75 mg, caja c/14 cápsulas",    formaFarmaceutica: "Cápsula",     grupoTerapeutico: NEURO, cofeprisGroup: "IV" },
  { clave: "MX-0307", descripcion: "Gabapentina",                 presentacion: "300 mg, caja c/30 cápsulas",   formaFarmaceutica: "Cápsula",     grupoTerapeutico: NEURO, cofeprisGroup: "IV" },

  // ── Hormonales ─────────────────────────────────────────────────────
  { clave: "MX-0330", descripcion: "Levotiroxina",                presentacion: "100 mcg, caja c/100 tabletas", formaFarmaceutica: "Tableta",     grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0331", descripcion: "Metimazol",                   presentacion: "5 mg, caja c/50 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0332", descripcion: "Etinilestradiol + Levonorgestrel", presentacion: "0.03/0.15 mg, blister c/21+7", formaFarmaceutica: "Tableta", grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0333", descripcion: "Drospirenona + Etinilestradiol", presentacion: "3/0.03 mg, blister c/21+7", formaFarmaceutica: "Tableta",   grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0334", descripcion: "Levonorgestrel emergencia",   presentacion: "1.5 mg, caja c/1 tableta",     formaFarmaceutica: "Tableta",     grupoTerapeutico: HORMONAL, cofeprisGroup: "V" },
  { clave: "MX-0335", descripcion: "Medroxiprogesterona",         presentacion: "10 mg, caja c/10 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0336", descripcion: "Estradiol parche",            presentacion: "50 mcg/24h, caja c/8 parches", formaFarmaceutica: "Parche",      grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0337", descripcion: "Prednisona",                  presentacion: "5 mg, caja c/30 tabletas",     formaFarmaceutica: "Tableta",     grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0338", descripcion: "Prednisolona",                presentacion: "5 mg/5 mL solución, frasco 60 mL", formaFarmaceutica: "Solución", grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0339", descripcion: "Dexametasona",                presentacion: "0.5 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0340", descripcion: "Hidrocortisona crema 1%",     presentacion: "Tubo 30 g",                    formaFarmaceutica: "Crema tópica", grupoTerapeutico: HORMONAL, cofeprisGroup: "V" },

  // ── Vitaminas y suplementos ────────────────────────────────────────
  { clave: "MX-0360", descripcion: "Ácido fólico",                presentacion: "5 mg, caja c/100 tabletas",    formaFarmaceutica: "Tableta",     grupoTerapeutico: VITAMINS, cofeprisGroup: "V" },
  { clave: "MX-0361", descripcion: "Sulfato ferroso",             presentacion: "200 mg, caja c/30 tabletas",   formaFarmaceutica: "Tableta",     grupoTerapeutico: VITAMINS, cofeprisGroup: "V" },
  { clave: "MX-0362", descripcion: "Vitamina B12 (cianocobalamina)", presentacion: "1 mg/mL inyectable, ampolleta", formaFarmaceutica: "Inyectable", grupoTerapeutico: VITAMINS, cofeprisGroup: "V" },
  { clave: "MX-0363", descripcion: "Vitamina D3",                 presentacion: "2000 UI, caja c/60 cápsulas",  formaFarmaceutica: "Cápsula",     grupoTerapeutico: VITAMINS, cofeprisGroup: "V" },
  { clave: "MX-0364", descripcion: "Calcio + Vitamina D3",        presentacion: "600/200 mg/UI, caja c/60 tabletas", formaFarmaceutica: "Tableta", grupoTerapeutico: VITAMINS, cofeprisGroup: "V" },
  { clave: "MX-0365", descripcion: "Multivitamínico adulto",      presentacion: "Caja c/30 tabletas",           formaFarmaceutica: "Tableta",     grupoTerapeutico: VITAMINS, cofeprisGroup: "V" },
  { clave: "MX-0366", descripcion: "Multivitamínico prenatal",    presentacion: "Caja c/30 tabletas",           formaFarmaceutica: "Tableta",     grupoTerapeutico: VITAMINS, cofeprisGroup: "V" },
  { clave: "MX-0367", descripcion: "Omega 3 (EPA + DHA)",         presentacion: "1000 mg, caja c/60 cápsulas",  formaFarmaceutica: "Cápsula",     grupoTerapeutico: VITAMINS, cofeprisGroup: "V" },

  // ── Anestésicos locales ────────────────────────────────────────────
  { clave: "MX-0400", descripcion: "Lidocaína 2% con epinefrina", presentacion: "Cartucho dental 1.8 mL",       formaFarmaceutica: "Inyectable",  grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0401", descripcion: "Lidocaína 2% sin epinefrina", presentacion: "Cartucho dental 1.8 mL",       formaFarmaceutica: "Inyectable",  grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0402", descripcion: "Articaína 4% con epinefrina", presentacion: "Cartucho dental 1.7 mL",       formaFarmaceutica: "Inyectable",  grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0403", descripcion: "Mepivacaína 3%",              presentacion: "Cartucho dental 1.8 mL",       formaFarmaceutica: "Inyectable",  grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0404", descripcion: "Benzocaína gel tópico 20%",   presentacion: "Tubo 15 g",                    formaFarmaceutica: "Gel",         grupoTerapeutico: ANESTHETIC, cofeprisGroup: "V" },
  { clave: "MX-0405", descripcion: "Lidocaína gel 2%",            presentacion: "Tubo 30 g",                    formaFarmaceutica: "Gel",         grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },

  // ── Salud bucal y dental ───────────────────────────────────────────
  { clave: "MX-0420", descripcion: "Clorhexidina enjuague 0.12%", presentacion: "Frasco 240 mL",                formaFarmaceutica: "Solución",    grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V" },
  { clave: "MX-0421", descripcion: "Fluoruro de sodio gel 1.23%", presentacion: "Tubo 60 mL",                   formaFarmaceutica: "Gel",         grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V" },
  { clave: "MX-0422", descripcion: "Pasta dental con flúor",      presentacion: "Tubo 130 g",                   formaFarmaceutica: "Pasta",       grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V" },
  { clave: "MX-0423", descripcion: "Triamcinolona crema oral",    presentacion: "0.1% tubo 5 g",                formaFarmaceutica: "Crema",       grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "IV" },
  { clave: "MX-0424", descripcion: "Nistatina enjuague",          presentacion: "100,000 UI/mL, frasco 60 mL",  formaFarmaceutica: "Suspensión",  grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "IV" },
  { clave: "MX-0425", descripcion: "Bencidamina enjuague 0.15%",  presentacion: "Frasco 240 mL",                formaFarmaceutica: "Solución",    grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V" },

  // ── Oftálmicos ─────────────────────────────────────────────────────
  { clave: "MX-0440", descripcion: "Tobramicina gotas 0.3%",      presentacion: "Frasco 5 mL",                  formaFarmaceutica: "Solución oftálmica", grupoTerapeutico: OPHTHAL, cofeprisGroup: "IV" },
  { clave: "MX-0441", descripcion: "Cloranfenicol gotas 0.5%",    presentacion: "Frasco 5 mL",                  formaFarmaceutica: "Solución oftálmica", grupoTerapeutico: OPHTHAL, cofeprisGroup: "IV" },
  { clave: "MX-0442", descripcion: "Diclofenaco gotas 0.1%",      presentacion: "Frasco 5 mL",                  formaFarmaceutica: "Solución oftálmica", grupoTerapeutico: OPHTHAL, cofeprisGroup: "IV" },
  { clave: "MX-0443", descripcion: "Lágrimas artificiales",       presentacion: "Frasco 15 mL",                 formaFarmaceutica: "Solución oftálmica", grupoTerapeutico: OPHTHAL, cofeprisGroup: "V" },
  { clave: "MX-0444", descripcion: "Timolol gotas 0.5%",          presentacion: "Frasco 5 mL",                  formaFarmaceutica: "Solución oftálmica", grupoTerapeutico: OPHTHAL, cofeprisGroup: "IV" },
  { clave: "MX-0445", descripcion: "Latanoprost gotas 0.005%",    presentacion: "Frasco 2.5 mL",                formaFarmaceutica: "Solución oftálmica", grupoTerapeutico: OPHTHAL, cofeprisGroup: "IV" },

  // ── Dermatológicos ─────────────────────────────────────────────────
  { clave: "MX-0460", descripcion: "Mupirocina pomada 2%",        presentacion: "Tubo 15 g",                    formaFarmaceutica: "Pomada",      grupoTerapeutico: DERM, cofeprisGroup: "IV" },
  { clave: "MX-0461", descripcion: "Sulfadiazina argéntica 1%",   presentacion: "Tubo 50 g",                    formaFarmaceutica: "Crema",       grupoTerapeutico: DERM, cofeprisGroup: "IV" },
  { clave: "MX-0462", descripcion: "Tretinoína crema 0.05%",      presentacion: "Tubo 30 g",                    formaFarmaceutica: "Crema",       grupoTerapeutico: DERM, cofeprisGroup: "IV" },
  { clave: "MX-0463", descripcion: "Adapaleno gel 0.1%",          presentacion: "Tubo 30 g",                    formaFarmaceutica: "Gel",         grupoTerapeutico: DERM, cofeprisGroup: "IV" },
  { clave: "MX-0464", descripcion: "Peróxido de benzoilo 5%",     presentacion: "Tubo 60 g",                    formaFarmaceutica: "Gel",         grupoTerapeutico: DERM, cofeprisGroup: "V"  },
  { clave: "MX-0465", descripcion: "Calcipotriol crema 0.005%",   presentacion: "Tubo 30 g",                    formaFarmaceutica: "Crema",       grupoTerapeutico: DERM, cofeprisGroup: "IV" },
  { clave: "MX-0466", descripcion: "Betametasona crema 0.05%",    presentacion: "Tubo 30 g",                    formaFarmaceutica: "Crema",       grupoTerapeutico: DERM, cofeprisGroup: "IV" },

  // ── Vacunas (referencias comunes) ──────────────────────────────────
  { clave: "MX-0480", descripcion: "Vacuna influenza estacional", presentacion: "Jeringa prellenada 0.5 mL",    formaFarmaceutica: "Inyectable",  grupoTerapeutico: VACCINE, cofeprisGroup: "IV" },
  { clave: "MX-0481", descripcion: "Vacuna tétanos-difteria",     presentacion: "Frasco ámpula 0.5 mL",         formaFarmaceutica: "Inyectable",  grupoTerapeutico: VACCINE, cofeprisGroup: "IV" },
  { clave: "MX-0482", descripcion: "Vacuna hepatitis B",          presentacion: "Frasco ámpula 1 mL adulto",    formaFarmaceutica: "Inyectable",  grupoTerapeutico: VACCINE, cofeprisGroup: "IV" },
  { clave: "MX-0483", descripcion: "Vacuna VPH bivalente",        presentacion: "Jeringa prellenada 0.5 mL",    formaFarmaceutica: "Inyectable",  grupoTerapeutico: VACCINE, cofeprisGroup: "IV" },
];
