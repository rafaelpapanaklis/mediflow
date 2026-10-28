/**
 * Ampliación del catálogo para ODONTOLOGÍA (ws1-t10, decisión de Rafael del
 * 28-oct-2026): lo que más se receta en un consultorio dental en México, en
 * todas sus presentaciones y concentraciones habituales. Entra al catálogo
 * global (`CUMS_ESSENTIALS` lo concatena) y a producción con el SQL aditivo
 * `sql/cums-odontologia-2026-10.sql` (INSERT … ON CONFLICT DO NOTHING; las
 * filas que ya existan no se tocan).
 *
 * Claves MX-05xx…MX-06xx: internas, como el resto del catálogo (las claves
 * oficiales del Compendio llegarán con el import masivo; donde una
 * presentación coincide con una clave del Compendio Nacional de Insumos para
 * la Salud / Cuadro Básico IMSS que se pudo verificar, va anotada como
 * comentario, solo de referencia).
 *
 * Grupo COFEPRIS (Ley General de Salud, art. 226, texto vigente al
 * 15-ene-2026): los analgésicos, antibióticos, antivirales, antifúngicos,
 * corticoides y anestésicos de uso dental son fracción IV (receta médica,
 * resurtible); lo de venta libre en farmacia es V. Los únicos controlados de
 * esta lista son los de TRAMADOL: la reforma del 15-ene-2026 lo metió en el
 * grupo III del art. 245 (receta surtible hasta 3 veces), igual que el
 * tramadol que ya existía en el catálogo (MX-0017). No se añade ninguna
 * benzodiazepina ni estupefaciente: para eso están los que ya hay.
 *
 * Las presentaciones (mg, mL, piezas por caja) son las genéricas del mercado
 * mexicano; la caja exacta la decide la farmacia, el doctor receta la
 * concentración y la forma.
 */

import type { CumsSeed } from "./cums-essentials";

// Mismos textos que en cums-essentials.ts: el filtro `group` del buscador y la
// prueba de catálogo exigen que coincidan letra por letra.
const ANALGESIC = "Analgésicos y antiinflamatorios";
const ANTIBIOTIC = "Antibióticos";
const ANTIVIRAL = "Antivirales";
const ANTIFUNGAL = "Antifúngicos";
const HORMONAL = "Hormonales";
const ANESTHETIC = "Anestésicos locales";
const ORAL_DENTAL = "Salud bucal y dental";
/** Grupo nuevo: ácido tranexámico (sangrado en anticoagulados tras extracción). */
const HEMOSTATIC = "Hemostáticos";

export const CUMS_ODONTOLOGIA: CumsSeed[] = [
  // ── Analgésicos / antiinflamatorios ────────────────────────────────────
  { clave: "MX-0500", descripcion: "Paracetamol",                      presentacion: "650 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0501", descripcion: "Paracetamol",                      presentacion: "750 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0502", descripcion: "Paracetamol",                      presentacion: "1 g, caja c/10 tabletas",                            formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0503", descripcion: "Paracetamol",                      presentacion: "325 mg, caja c/20 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0504", descripcion: "Paracetamol",                      presentacion: "160 mg/5 mL jarabe infantil, frasco 120 mL",         formaFarmaceutica: "Jarabe",             grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0505", descripcion: "Ibuprofeno",                       presentacion: "200 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  }, // CNIS 010.000.5940.00
  { clave: "MX-0506", descripcion: "Ibuprofeno",                       presentacion: "600 mg, caja c/20 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0507", descripcion: "Ibuprofeno",                       presentacion: "800 mg, caja c/20 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0508", descripcion: "Ibuprofeno",                       presentacion: "100 mg/5 mL suspensión infantil, frasco 120 mL",     formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0509", descripcion: "Ibuprofeno",                       presentacion: "40 mg/mL gotas pediátricas, frasco 30 mL",           formaFarmaceutica: "Solución",           grupoTerapeutico: ANALGESIC, cofeprisGroup: "V"  },
  { clave: "MX-0510", descripcion: "Ketorolaco",                       presentacion: "10 mg, caja c/10 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0511", descripcion: "Ketorolaco",                       presentacion: "30 mg, caja c/4 tabletas sublinguales",              formaFarmaceutica: "Tableta sublingual", grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0512", descripcion: "Ketorolaco",                       presentacion: "60 mg/2 mL solución inyectable, caja c/3 ampolletas", formaFarmaceutica: "Inyectable",        grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0513", descripcion: "Ketorolaco + Tramadol",            presentacion: "10/25 mg, caja c/10 tabletas",                       formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "III" },
  { clave: "MX-0514", descripcion: "Naproxeno",                        presentacion: "500 mg, caja c/30 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0515", descripcion: "Naproxeno sódico",                 presentacion: "550 mg, caja c/12 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0516", descripcion: "Naproxeno",                        presentacion: "125 mg/5 mL suspensión, frasco 100 mL",              formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0517", descripcion: "Naproxeno sódico + Paracetamol",   presentacion: "275/300 mg, caja c/16 tabletas",                     formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0518", descripcion: "Diclofenaco sódico",               presentacion: "50 mg, caja c/20 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0519", descripcion: "Diclofenaco sódico",               presentacion: "75 mg/3 mL solución inyectable, caja c/2 ampolletas", formaFarmaceutica: "Inyectable",        grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0520", descripcion: "Diclofenaco potásico",             presentacion: "50 mg, caja c/20 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0521", descripcion: "Metamizol sódico",                 presentacion: "500 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" }, // CNIS 010.000.0109.00
  { clave: "MX-0522", descripcion: "Metamizol sódico",                 presentacion: "1 g/2 mL solución inyectable, caja c/3 ampolletas",  formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0523", descripcion: "Metamizol sódico",                 presentacion: "250 mg/5 mL solución oral, frasco 100 mL",           formaFarmaceutica: "Solución",           grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0524", descripcion: "Nimesulida",                       presentacion: "100 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0525", descripcion: "Nimesulida",                       presentacion: "50 mg/5 mL suspensión, frasco 60 mL",                formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0526", descripcion: "Celecoxib",                        presentacion: "100 mg, caja c/20 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0527", descripcion: "Etoricoxib",                       presentacion: "60 mg, caja c/14 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0528", descripcion: "Etoricoxib",                       presentacion: "120 mg, caja c/7 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0529", descripcion: "Meloxicam",                        presentacion: "7.5 mg, caja c/20 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0530", descripcion: "Meloxicam",                        presentacion: "15 mg/1.5 mL solución inyectable, caja c/3 ampolletas", formaFarmaceutica: "Inyectable",      grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0531", descripcion: "Dexketoprofeno",                   presentacion: "25 mg, caja c/10 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0532", descripcion: "Dexketoprofeno",                   presentacion: "50 mg/2 mL solución inyectable, caja c/6 ampolletas", formaFarmaceutica: "Inyectable",        grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0533", descripcion: "Clonixinato de lisina",            presentacion: "125 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0534", descripcion: "Clonixinato de lisina",            presentacion: "100 mg/2 mL solución inyectable, caja c/5 ampolletas", formaFarmaceutica: "Inyectable",       grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0535", descripcion: "Ácido mefenámico",                 presentacion: "500 mg, caja c/12 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0536", descripcion: "Piroxicam",                        presentacion: "20 mg, caja c/20 cápsulas",                          formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0537", descripcion: "Ketoprofeno",                      presentacion: "100 mg, caja c/15 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANALGESIC, cofeprisGroup: "IV" },
  { clave: "MX-0538", descripcion: "Tramadol",                         presentacion: "100 mg/mL solución oral (gotas), frasco 10 mL",      formaFarmaceutica: "Solución",           grupoTerapeutico: ANALGESIC, cofeprisGroup: "III" },
  { clave: "MX-0539", descripcion: "Tramadol",                         presentacion: "100 mg liberación prolongada, caja c/10 tabletas",   formaFarmaceutica: "Tableta LP",         grupoTerapeutico: ANALGESIC, cofeprisGroup: "III" },
  { clave: "MX-0540", descripcion: "Tramadol",                         presentacion: "100 mg/2 mL solución inyectable, caja c/5 ampolletas", formaFarmaceutica: "Inyectable",       grupoTerapeutico: ANALGESIC, cofeprisGroup: "III" },

  // ── Antibióticos ───────────────────────────────────────────────────────
  { clave: "MX-0550", descripcion: "Amoxicilina",                      presentacion: "875 mg, caja c/12 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0551", descripcion: "Amoxicilina",                      presentacion: "1 g, caja c/12 tabletas",                            formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0552", descripcion: "Amoxicilina suspensión",           presentacion: "500 mg/5 mL, frasco 75 mL",                          formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0553", descripcion: "Amoxicilina suspensión",           presentacion: "125 mg/5 mL, frasco 75 mL",                          formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0554", descripcion: "Amoxicilina + ácido clavulánico",  presentacion: "875/125 mg, caja c/14 tabletas",                     formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0555", descripcion: "Amoxicilina + ácido clavulánico",  presentacion: "400/57 mg/5 mL suspensión, frasco 70 mL",            formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0556", descripcion: "Amoxicilina + ácido clavulánico",  presentacion: "250/62.5 mg/5 mL suspensión, frasco 60 mL",          formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0557", descripcion: "Amoxicilina + ácido clavulánico",  presentacion: "125/31.25 mg/5 mL suspensión, frasco 60 mL",         formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0558", descripcion: "Ampicilina suspensión",            presentacion: "250 mg/5 mL, frasco 60 mL",                          formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0559", descripcion: "Dicloxacilina",                    presentacion: "500 mg, caja c/20 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0560", descripcion: "Dicloxacilina suspensión",         presentacion: "250 mg/5 mL, frasco 60 mL",                          formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0561", descripcion: "Penicilina G procaínica",          presentacion: "800,000 UI solución inyectable, frasco ámpula",      formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0562", descripcion: "Clindamicina",                     presentacion: "150 mg, caja c/16 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0563", descripcion: "Clindamicina",                     presentacion: "600 mg/4 mL solución inyectable, caja c/1 ampolleta", formaFarmaceutica: "Inyectable",        grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0564", descripcion: "Clindamicina suspensión pediátrica", presentacion: "75 mg/5 mL, frasco 80 mL",                         formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0565", descripcion: "Metronidazol",                     presentacion: "250 mg, caja c/20 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0566", descripcion: "Espiramicina + Metronidazol",      presentacion: "750,000 UI/125 mg, caja c/20 tabletas",              formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0567", descripcion: "Azitromicina",                     presentacion: "250 mg, caja c/6 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0568", descripcion: "Azitromicina suspensión",          presentacion: "200 mg/5 mL, frasco 15 mL",                          formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0569", descripcion: "Claritromicina",                   presentacion: "250 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0570", descripcion: "Claritromicina suspensión",        presentacion: "125 mg/5 mL, frasco 50 mL",                          formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0571", descripcion: "Cefalexina suspensión",            presentacion: "250 mg/5 mL, frasco 100 mL",                         formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0572", descripcion: "Cefalexina",                       presentacion: "1 g, caja c/12 tabletas",                            formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0573", descripcion: "Cefaclor",                         presentacion: "500 mg, caja c/15 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0574", descripcion: "Cefaclor suspensión",              presentacion: "250 mg/5 mL, frasco 75 mL",                          formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0575", descripcion: "Cefuroxima",                       presentacion: "250 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0576", descripcion: "Lincomicina",                      presentacion: "500 mg, caja c/16 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0577", descripcion: "Lincomicina",                      presentacion: "600 mg/2 mL solución inyectable, caja c/1 ampolleta", formaFarmaceutica: "Inyectable",        grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0578", descripcion: "Minociclina",                      presentacion: "100 mg, caja c/12 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0579", descripcion: "Levofloxacino",                    presentacion: "750 mg, caja c/7 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },
  { clave: "MX-0580", descripcion: "Ceftriaxona",                      presentacion: "500 mg solución inyectable, frasco ámpula",          formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANTIBIOTIC, cofeprisGroup: "IV" },

  // ── Antivirales (herpes labial / gingivoestomatitis) ───────────────────
  { clave: "MX-0590", descripcion: "Aciclovir",                        presentacion: "400 mg, caja c/35 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIVIRAL, cofeprisGroup: "IV" },
  { clave: "MX-0591", descripcion: "Aciclovir",                        presentacion: "800 mg, caja c/35 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIVIRAL, cofeprisGroup: "IV" },
  { clave: "MX-0592", descripcion: "Aciclovir suspensión",             presentacion: "200 mg/5 mL, frasco 125 mL",                         formaFarmaceutica: "Suspensión",         grupoTerapeutico: ANTIVIRAL, cofeprisGroup: "IV" },
  { clave: "MX-0593", descripcion: "Valaciclovir",                     presentacion: "1 g, caja c/21 tabletas",                            formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIVIRAL, cofeprisGroup: "IV" },

  // ── Antifúngicos (candidiasis oral, estomatitis protésica) ─────────────
  { clave: "MX-0600", descripcion: "Fluconazol",                       presentacion: "100 mg, caja c/10 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },
  { clave: "MX-0601", descripcion: "Fluconazol",                       presentacion: "200 mg, caja c/10 cápsulas",                         formaFarmaceutica: "Cápsula",            grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },
  { clave: "MX-0602", descripcion: "Nistatina",                        presentacion: "500,000 UI, caja c/20 grageas",                      formaFarmaceutica: "Gragea",             grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },
  { clave: "MX-0603", descripcion: "Miconazol gel oral 2%",            presentacion: "Tubo 40 g",                                          formaFarmaceutica: "Gel oral",           grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },
  { clave: "MX-0604", descripcion: "Ketoconazol",                      presentacion: "200 mg, caja c/10 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: ANTIFUNGAL, cofeprisGroup: "IV" },

  // ── Corticoides (edema postquirúrgico, pulpitis, lesiones orales) ──────
  { clave: "MX-0610", descripcion: "Dexametasona",                     presentacion: "4 mg, caja c/10 tabletas",                           formaFarmaceutica: "Tableta",            grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0611", descripcion: "Dexametasona fosfato",             presentacion: "8 mg/2 mL solución inyectable, caja c/1 ampolleta",  formaFarmaceutica: "Inyectable",         grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" }, // CNIS 010.000.4241.00
  { clave: "MX-0612", descripcion: "Dexametasona fosfato",             presentacion: "4 mg/1 mL solución inyectable, caja c/1 ampolleta",  formaFarmaceutica: "Inyectable",         grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0613", descripcion: "Prednisona",                       presentacion: "20 mg, caja c/10 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0614", descripcion: "Prednisona",                       presentacion: "50 mg, caja c/20 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0615", descripcion: "Metilprednisolona",                presentacion: "4 mg, caja c/21 tabletas",                           formaFarmaceutica: "Tableta",            grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0616", descripcion: "Deflazacort",                      presentacion: "6 mg, caja c/20 tabletas",                           formaFarmaceutica: "Tableta",            grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },
  { clave: "MX-0617", descripcion: "Deflazacort",                      presentacion: "30 mg, caja c/10 tabletas",                          formaFarmaceutica: "Tableta",            grupoTerapeutico: HORMONAL, cofeprisGroup: "IV" },

  // ── Anestésicos locales (cartuchos dentales y tópicos) ─────────────────
  { clave: "MX-0620", descripcion: "Lidocaína 2% con epinefrina 1:100,000", presentacion: "Caja c/50 cartuchos dentales 1.8 mL",           formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0621", descripcion: "Articaína 4% con epinefrina 1:100,000", presentacion: "Caja c/50 cartuchos dentales 1.7 mL",           formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0622", descripcion: "Articaína 4% con epinefrina 1:200,000", presentacion: "Caja c/50 cartuchos dentales 1.7 mL",           formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0623", descripcion: "Mepivacaína 2% con epinefrina 1:100,000", presentacion: "Caja c/50 cartuchos dentales 1.8 mL",         formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0624", descripcion: "Prilocaína 3% con felipresina",    presentacion: "Caja c/50 cartuchos dentales 1.8 mL",                formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0625", descripcion: "Bupivacaína 0.5% con epinefrina 1:200,000", presentacion: "Caja c/50 cartuchos dentales 1.8 mL",       formaFarmaceutica: "Inyectable",         grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0626", descripcion: "Lidocaína spray 10%",              presentacion: "Frasco atomizador 80 mL",                            formaFarmaceutica: "Solución (spray)",   grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0627", descripcion: "Lidocaína viscosa 2%",             presentacion: "Solución oral, frasco 100 mL",                       formaFarmaceutica: "Solución",           grupoTerapeutico: ANESTHETIC, cofeprisGroup: "IV" },
  { clave: "MX-0628", descripcion: "Benzocaína gel tópico 7.5%",       presentacion: "Tubo 10 g (pediátrico)",                             formaFarmaceutica: "Gel",                grupoTerapeutico: ANESTHETIC, cofeprisGroup: "V"  },
  { clave: "MX-0629", descripcion: "Benzocaína pastillas",             presentacion: "10 mg, caja c/24 pastillas para disolver",           formaFarmaceutica: "Pastilla",           grupoTerapeutico: ANESTHETIC, cofeprisGroup: "V"  },

  // ── Salud bucal y dental ───────────────────────────────────────────────
  { clave: "MX-0640", descripcion: "Clorhexidina enjuague 0.2%",       presentacion: "Frasco 250 mL",                                      formaFarmaceutica: "Solución",           grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0641", descripcion: "Clorhexidina gel 1%",              presentacion: "Tubo 50 g",                                          formaFarmaceutica: "Gel",                grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0642", descripcion: "Clorhexidina spray 0.12%",         presentacion: "Frasco atomizador 60 mL",                            formaFarmaceutica: "Solución (spray)",   grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0643", descripcion: "Clorhexidina 0.12% + cloruro de cetilpiridinio 0.05% enjuague", presentacion: "Frasco 250 mL",         formaFarmaceutica: "Solución",           grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0644", descripcion: "Fluoruro de sodio enjuague 0.05%", presentacion: "Frasco 500 mL",                                      formaFarmaceutica: "Solución",           grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0645", descripcion: "Fluoruro de sodio barniz 5% (22,600 ppm)", presentacion: "Tubo 10 mL",                                 formaFarmaceutica: "Barniz",             grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0646", descripcion: "Fluoruro estañoso gel 0.4%",       presentacion: "Tubo 120 g",                                         formaFarmaceutica: "Gel",                grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0647", descripcion: "Pasta dental fluoruro de sodio 1.1% (5,000 ppm)", presentacion: "Tubo 113 g",                          formaFarmaceutica: "Pasta",              grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0648", descripcion: "Pasta dental desensibilizante (nitrato de potasio 5% + flúor)", presentacion: "Tubo 100 g",            formaFarmaceutica: "Pasta",              grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0649", descripcion: "Peróxido de carbamida 10% (blanqueamiento en casa)", presentacion: "Jeringa 3 mL",                     formaFarmaceutica: "Gel",                grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0650", descripcion: "Peróxido de carbamida 16% (blanqueamiento en casa)", presentacion: "Jeringa 3 mL",                     formaFarmaceutica: "Gel",                grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0651", descripcion: "Peróxido de carbamida 22% (blanqueamiento en casa)", presentacion: "Jeringa 3 mL",                     formaFarmaceutica: "Gel",                grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0652", descripcion: "Saliva artificial (carboximetilcelulosa)", presentacion: "Frasco atomizador 60 mL",                    formaFarmaceutica: "Solución (spray)",   grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0653", descripcion: "Pilocarpina",                      presentacion: "5 mg, caja c/21 tabletas",                           formaFarmaceutica: "Tableta",            grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "IV" },
  { clave: "MX-0654", descripcion: "Ácido hialurónico gel bucal 0.2%", presentacion: "Tubo 15 mL",                                         formaFarmaceutica: "Gel",                grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0655", descripcion: "Povidona yodada bucal 1% enjuague", presentacion: "Frasco 120 mL",                                     formaFarmaceutica: "Solución",           grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },
  { clave: "MX-0656", descripcion: "Peróxido de hidrógeno 3% (agua oxigenada)", presentacion: "Frasco 120 mL",                             formaFarmaceutica: "Solución",           grupoTerapeutico: ORAL_DENTAL, cofeprisGroup: "V"  },

  // ── Hemostáticos (extracciones en anticoagulados) ──────────────────────
  { clave: "MX-0660", descripcion: "Ácido tranexámico",                presentacion: "500 mg, caja c/20 tabletas",                         formaFarmaceutica: "Tableta",            grupoTerapeutico: HEMOSTATIC, cofeprisGroup: "IV" },
  { clave: "MX-0661", descripcion: "Ácido tranexámico",                presentacion: "1 g/10 mL solución inyectable, caja c/3 ampolletas", formaFarmaceutica: "Inyectable",         grupoTerapeutico: HEMOSTATIC, cofeprisGroup: "IV" },
];
