/**
 * CIE-9-MC essentials — procedimientos clínicos comunes en odontología y
 * medicina general en MX. ~100 entradas. Tabla GLOBAL.
 */

export interface Cie9Seed {
  code: string;
  description: string;
  category: string;
}

const DENTAL = "Procedimientos dentales y orales";
const GENERAL = "Procedimientos generales";
const RADIOLOGIA = "Imagen y radiología";
const QUIRURGICOS = "Procedimientos quirúrgicos";
const REHABILITACION = "Rehabilitación física";
const OTROS = "Otros procedimientos";

export const CIE9_ESSENTIALS: Cie9Seed[] = [
  // ── Procedimientos dentales (23.x extracciones / restauraciones) ───
  { code: "23.01", description: "Extracción dental con fórceps",                              category: DENTAL },
  { code: "23.09", description: "Extracción dental, otras técnicas",                          category: DENTAL },
  { code: "23.11", description: "Extracción quirúrgica de raíz residual",                     category: DENTAL },
  { code: "23.19", description: "Extracción quirúrgica de diente, otra",                      category: DENTAL },
  { code: "23.20", description: "Restauración dental con amalgama",                           category: DENTAL },
  { code: "23.30", description: "Restauración dental con corona prefabricada",                category: DENTAL },
  { code: "23.41", description: "Aplicación de selladores dentales",                          category: DENTAL },
  { code: "23.42", description: "Restauraciones múltiples (resina)",                          category: DENTAL },
  { code: "23.43", description: "Aplicación de carillas (carilla estética)",                  category: DENTAL },
  { code: "23.49", description: "Otras restauraciones dentales",                              category: DENTAL },
  { code: "23.5",  description: "Inserción de implante dental",                               category: DENTAL },
  { code: "23.70", description: "Tratamiento endodóntico, no especificado",                   category: DENTAL },
  { code: "23.71", description: "Apicoformación",                                             category: DENTAL },
  { code: "23.72", description: "Apicectomía",                                                category: DENTAL },
  { code: "23.73", description: "Tratamiento de conductos radiculares",                       category: DENTAL },
  { code: "23.79", description: "Otra terapia endodóntica",                                   category: DENTAL },
  { code: "24.00", description: "Profilaxis dental adulto",                                   category: DENTAL },
  { code: "24.01", description: "Profilaxis dental pediátrica",                               category: DENTAL },
  { code: "24.10", description: "Curetaje gingival y cierre",                                 category: DENTAL },
  { code: "24.31", description: "Gingivectomía",                                              category: DENTAL },
  { code: "24.32", description: "Gingivoplastía",                                             category: DENTAL },
  { code: "24.40", description: "Curetaje subgingival",                                       category: DENTAL },
  { code: "24.7",  description: "Aplicación de aparato dentario fijo (ortodoncia)",           category: DENTAL },
  { code: "24.8",  description: "Otros tratamientos ortodónticos",                            category: DENTAL },
  { code: "25.01", description: "Biopsia de la lengua",                                       category: DENTAL },
  { code: "25.4",  description: "Glosectomía radical",                                        category: DENTAL },
  { code: "26.0",  description: "Drenaje quiste glándula salival",                            category: DENTAL },
  { code: "27.43", description: "Cierre quirúrgico de fístula oral",                          category: DENTAL },
  { code: "27.49", description: "Otra reparación de boca",                                    category: DENTAL },
  { code: "27.51", description: "Reparación de hendidura labial",                             category: DENTAL },
  { code: "27.52", description: "Reparación de hendidura paladar",                            category: DENTAL },
  { code: "27.7",  description: "Operación sobre úvula",                                      category: DENTAL },

  // ── Imagen / radiología ─────────────────────────────────────────────
  { code: "87.11", description: "Radiografía periapical (dental)",                            category: RADIOLOGIA },
  { code: "87.12", description: "Radiografía panorámica dental",                              category: RADIOLOGIA },
  { code: "87.13", description: "Radiografía cefalométrica",                                  category: RADIOLOGIA },
  { code: "87.16", description: "Radiografía oclusal",                                        category: RADIOLOGIA },
  { code: "87.17", description: "Radiografía de huesos faciales",                             category: RADIOLOGIA },
  { code: "87.41", description: "TAC tórax",                                                  category: RADIOLOGIA },
  { code: "87.49", description: "Otra radiografía de tórax",                                  category: RADIOLOGIA },
  { code: "88.01", description: "TAC abdomen",                                                category: RADIOLOGIA },
  { code: "88.38", description: "Otra TAC",                                                   category: RADIOLOGIA },
  { code: "88.71", description: "Ultrasonido cabeza/cuello",                                  category: RADIOLOGIA },
  { code: "88.72", description: "Ecocardiograma",                                             category: RADIOLOGIA },
  { code: "88.74", description: "Ultrasonido digestivo (abdominal)",                          category: RADIOLOGIA },
  { code: "88.75", description: "Ultrasonido renal",                                          category: RADIOLOGIA },
  { code: "88.76", description: "Ultrasonido obstétrico",                                     category: RADIOLOGIA },
  { code: "88.91", description: "Resonancia magnética cerebral",                              category: RADIOLOGIA },
  { code: "89.52", description: "Electrocardiograma",                                         category: RADIOLOGIA },
  { code: "89.54", description: "Monitoreo Holter 24h",                                       category: RADIOLOGIA },

  // ── Procedimientos quirúrgicos comunes ──────────────────────────────
  { code: "47.01", description: "Apendicectomía laparoscópica",                               category: QUIRURGICOS },
  { code: "47.09", description: "Apendicectomía abierta",                                     category: QUIRURGICOS },
  { code: "51.23", description: "Colecistectomía laparoscópica",                              category: QUIRURGICOS },
  { code: "53.04", description: "Reparación hernia inguinal unilateral",                      category: QUIRURGICOS },
  { code: "53.49", description: "Otra reparación de hernia umbilical",                        category: QUIRURGICOS },
  { code: "65.01", description: "Salpingostomía laparoscópica",                               category: QUIRURGICOS },
  { code: "68.51", description: "Histerectomía supracervical laparoscópica",                  category: QUIRURGICOS },
  { code: "70.71", description: "Sutura laceración vaginal",                                  category: QUIRURGICOS },
  { code: "74.0",  description: "Cesárea clásica",                                            category: QUIRURGICOS },
  { code: "74.4",  description: "Otra cesárea",                                               category: QUIRURGICOS },
  { code: "75.34", description: "Otra monitorización intrauterina del feto",                  category: QUIRURGICOS },
  { code: "76.01", description: "Reducción de fractura de mandíbula",                         category: QUIRURGICOS },
  { code: "78.50", description: "Fijación interna de hueso",                                  category: QUIRURGICOS },
  { code: "79.01", description: "Reducción cerrada fractura húmero",                          category: QUIRURGICOS },
  { code: "79.06", description: "Reducción cerrada fractura tibia/peroné",                    category: QUIRURGICOS },
  { code: "81.51", description: "Artroplastia total de cadera",                               category: QUIRURGICOS },
  { code: "81.54", description: "Artroplastia total de rodilla",                              category: QUIRURGICOS },
  { code: "86.0",  description: "Drenaje incisional piel/tejido subcutáneo",                  category: QUIRURGICOS },
  { code: "86.04", description: "Drenaje absceso piel",                                       category: QUIRURGICOS },
  { code: "86.59", description: "Otra sutura piel/tejido subcutáneo",                         category: QUIRURGICOS },

  // ── Procedimientos generales (consulta/diagnóstico) ─────────────────
  { code: "89.01", description: "Anamnesis y consulta inicial",                               category: GENERAL },
  { code: "89.02", description: "Exploración general adultos",                                category: GENERAL },
  { code: "89.03", description: "Anamnesis y consulta de seguimiento",                        category: GENERAL },
  { code: "89.05", description: "Consulta de control de enfermedad crónica",                  category: GENERAL },
  { code: "89.06", description: "Consulta especializada",                                     category: GENERAL },
  { code: "89.61", description: "Monitoreo de presión arterial",                              category: GENERAL },
  { code: "89.65", description: "Glucemia capilar",                                           category: GENERAL },
  { code: "90.59", description: "Otros procedimientos diagnósticos sangre",                   category: GENERAL },
  { code: "93.94", description: "Aerosolterapia / nebulización",                              category: GENERAL },
  { code: "94.42", description: "Psicoterapia individual",                                    category: GENERAL },
  { code: "94.43", description: "Psicoterapia grupal",                                        category: GENERAL },
  { code: "94.44", description: "Psicoterapia familiar",                                      category: GENERAL },

  // ── Rehabilitación / fisioterapia ───────────────────────────────────
  { code: "93.03", description: "Pruebas de fuerza muscular",                                 category: REHABILITACION },
  { code: "93.11", description: "Ejercicios de rango de movimiento",                          category: REHABILITACION },
  { code: "93.12", description: "Otros ejercicios activos",                                   category: REHABILITACION },
  { code: "93.27", description: "Estiramiento muscular asistido",                             category: REHABILITACION },
  { code: "93.34", description: "Aplicación de calor superficial (compresas)",                category: REHABILITACION },
  { code: "93.35", description: "Aplicación de frío",                                         category: REHABILITACION },
  { code: "93.36", description: "Hidroterapia",                                               category: REHABILITACION },
  { code: "93.39", description: "Otra fisioterapia",                                          category: REHABILITACION },
  { code: "93.81", description: "Terapia manual / masaje",                                    category: REHABILITACION },
  { code: "93.83", description: "Terapia ocupacional",                                        category: REHABILITACION },

  // ── Inyecciones / inmunizaciones / otros ────────────────────────────
  { code: "99.01", description: "Transfusión hemoderivados",                                  category: OTROS },
  { code: "99.10", description: "Inyección o infusión de antibiótico",                        category: OTROS },
  { code: "99.11", description: "Inyección de antitetánica",                                  category: OTROS },
  { code: "99.14", description: "Vacunación influenza",                                       category: OTROS },
  { code: "99.21", description: "Inyección antihipertensivo",                                 category: OTROS },
  { code: "99.23", description: "Inyección de esteroides",                                    category: OTROS },
  { code: "99.29", description: "Inyección/infusión otra sustancia terapéutica",              category: OTROS },
  { code: "99.55", description: "Inmunización profiláctica contra otras enfermedades",        category: OTROS },
  { code: "99.81", description: "Hipotermia inducida",                                        category: OTROS },
  { code: "99.95", description: "Curación de herida quirúrgica",                              category: OTROS },
  { code: "99.99", description: "Otros procedimientos no clasificados",                       category: OTROS },
];
