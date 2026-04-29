/**
 * CIE-10 essentials — TOP ~210 códigos más usados en odontología y medicina
 * general en México. Cargados vía POST /api/admin/seed-cie10 con
 * createMany skipDuplicates: true (idempotente).
 *
 * Fuentes: OMS CIE-10 + listas oficiales SSA. Si tu especialidad necesita
 * más códigos, extendé este array — la tabla cie10_codes es global.
 */

export interface Cie10Seed {
  code: string;
  description: string;
  chapter: string;
}

const CAVIDAD_ORAL = "Enfermedades de la cavidad oral, glándulas salivales y maxilares";
const CIRCULATORIO = "Enfermedades del sistema circulatorio";
const ENDOCRINO = "Enfermedades endocrinas, nutricionales y metabólicas";
const MENTAL = "Trastornos mentales y del comportamiento";
const NERVIOSO = "Enfermedades del sistema nervioso";
const RESPIRATORIO = "Enfermedades del sistema respiratorio";
const DIGESTIVO = "Enfermedades del sistema digestivo";
const PIEL = "Enfermedades de la piel y tejido subcutáneo";
const MUSCULOESQUELETICO = "Enfermedades del sistema osteomuscular y del tejido conjuntivo";
const GENITOURINARIO = "Enfermedades del sistema genitourinario";
const SINTOMAS = "Síntomas, signos y hallazgos anormales";
const FACTORES = "Factores que influyen en el estado de salud y contacto con servicios";
const EMBARAZO = "Embarazo, parto y puerperio";

export const CIE10_ESSENTIALS: Cie10Seed[] = [
  // ── K00 Trastornos del desarrollo y erupción dentaria ─────────────
  { code: "K00.0", description: "Anodoncia",                                 chapter: CAVIDAD_ORAL },
  { code: "K00.1", description: "Dientes supernumerarios",                   chapter: CAVIDAD_ORAL },
  { code: "K00.2", description: "Anomalías del tamaño y forma de los dientes", chapter: CAVIDAD_ORAL },
  { code: "K00.3", description: "Dientes moteados",                          chapter: CAVIDAD_ORAL },
  { code: "K00.4", description: "Alteraciones en la formación de los dientes", chapter: CAVIDAD_ORAL },
  { code: "K00.5", description: "Alteraciones hereditarias estructura dentaria", chapter: CAVIDAD_ORAL },
  { code: "K00.6", description: "Alteraciones en la erupción dentaria",      chapter: CAVIDAD_ORAL },
  { code: "K00.7", description: "Síndrome de la erupción dentaria",          chapter: CAVIDAD_ORAL },
  { code: "K00.8", description: "Otros trastornos del desarrollo dentario",  chapter: CAVIDAD_ORAL },
  { code: "K00.9", description: "Trastorno del desarrollo dentario, no especificado", chapter: CAVIDAD_ORAL },

  // ── K01 Dientes incluidos e impactados ────────────────────────────
  { code: "K01.0", description: "Dientes incluidos",                         chapter: CAVIDAD_ORAL },
  { code: "K01.1", description: "Dientes impactados",                        chapter: CAVIDAD_ORAL },

  // ── K02 Caries dental ─────────────────────────────────────────────
  { code: "K02.0", description: "Caries limitada al esmalte",                chapter: CAVIDAD_ORAL },
  { code: "K02.1", description: "Caries de la dentina",                      chapter: CAVIDAD_ORAL },
  { code: "K02.2", description: "Caries del cemento",                        chapter: CAVIDAD_ORAL },
  { code: "K02.3", description: "Caries dental detenida",                    chapter: CAVIDAD_ORAL },
  { code: "K02.4", description: "Odontoclasia",                              chapter: CAVIDAD_ORAL },
  { code: "K02.5", description: "Caries dental con exposición pulpar",       chapter: CAVIDAD_ORAL },
  { code: "K02.8", description: "Otras caries dentales",                     chapter: CAVIDAD_ORAL },
  { code: "K02.9", description: "Caries dental, no especificada",            chapter: CAVIDAD_ORAL },

  // ── K03 Otras enfermedades de los tejidos duros ───────────────────
  { code: "K03.0", description: "Atrición excesiva de los dientes",          chapter: CAVIDAD_ORAL },
  { code: "K03.1", description: "Abrasión de los dientes",                   chapter: CAVIDAD_ORAL },
  { code: "K03.2", description: "Erosión de los dientes",                    chapter: CAVIDAD_ORAL },
  { code: "K03.3", description: "Resorción patológica dentaria",             chapter: CAVIDAD_ORAL },
  { code: "K03.4", description: "Hipercementosis",                           chapter: CAVIDAD_ORAL },
  { code: "K03.5", description: "Anquilosis dental",                         chapter: CAVIDAD_ORAL },
  { code: "K03.6", description: "Depósitos en los dientes",                  chapter: CAVIDAD_ORAL },
  { code: "K03.7", description: "Cambios postemision en color tejidos duros", chapter: CAVIDAD_ORAL },
  { code: "K03.8", description: "Otras enfermedades especificadas tejidos duros", chapter: CAVIDAD_ORAL },
  { code: "K03.9", description: "Enfermedad de los tejidos duros, no especificada", chapter: CAVIDAD_ORAL },

  // ── K04 Pulpa y tejidos periapicales ──────────────────────────────
  { code: "K04.0", description: "Pulpitis",                                  chapter: CAVIDAD_ORAL },
  { code: "K04.1", description: "Necrosis de la pulpa",                      chapter: CAVIDAD_ORAL },
  { code: "K04.2", description: "Degeneración pulpar",                       chapter: CAVIDAD_ORAL },
  { code: "K04.3", description: "Formación anormal tejido duro pulpa",       chapter: CAVIDAD_ORAL },
  { code: "K04.4", description: "Periodontitis apical aguda",                chapter: CAVIDAD_ORAL },
  { code: "K04.5", description: "Periodontitis apical crónica",              chapter: CAVIDAD_ORAL },
  { code: "K04.6", description: "Absceso periapical con fístula",            chapter: CAVIDAD_ORAL },
  { code: "K04.7", description: "Absceso periapical sin fístula",            chapter: CAVIDAD_ORAL },
  { code: "K04.8", description: "Quiste radicular",                          chapter: CAVIDAD_ORAL },
  { code: "K04.9", description: "Otras enf. pulpa y periapicales",           chapter: CAVIDAD_ORAL },

  // ── K05 Gingivitis y enfermedades periodontales ───────────────────
  { code: "K05.0", description: "Gingivitis aguda",                          chapter: CAVIDAD_ORAL },
  { code: "K05.1", description: "Gingivitis crónica",                        chapter: CAVIDAD_ORAL },
  { code: "K05.2", description: "Periodontitis aguda",                       chapter: CAVIDAD_ORAL },
  { code: "K05.3", description: "Periodontitis crónica",                     chapter: CAVIDAD_ORAL },
  { code: "K05.4", description: "Periodontosis",                             chapter: CAVIDAD_ORAL },
  { code: "K05.5", description: "Otras enfermedades periodontales",          chapter: CAVIDAD_ORAL },
  { code: "K05.6", description: "Enfermedad periodontal, no especificada",   chapter: CAVIDAD_ORAL },

  // ── K06 Encía y reborde alveolar ──────────────────────────────────
  { code: "K06.0", description: "Recesión gingival",                         chapter: CAVIDAD_ORAL },
  { code: "K06.1", description: "Hiperplasia gingival",                      chapter: CAVIDAD_ORAL },
  { code: "K06.2", description: "Lesiones gingivales/reborde por traumatismo", chapter: CAVIDAD_ORAL },
  { code: "K06.8", description: "Otros trastornos especificados encía/reborde", chapter: CAVIDAD_ORAL },
  { code: "K06.9", description: "Trastorno encía/reborde, no especificado",  chapter: CAVIDAD_ORAL },

  // ── K07 Anomalías dentofaciales / maloclusión ─────────────────────
  { code: "K07.0", description: "Anomalías mayores tamaño maxilar",          chapter: CAVIDAD_ORAL },
  { code: "K07.1", description: "Anomalías relación maxilo-craneal",         chapter: CAVIDAD_ORAL },
  { code: "K07.2", description: "Anomalías de la relación entre arcadas",    chapter: CAVIDAD_ORAL },
  { code: "K07.3", description: "Anomalías de la posición dentaria",         chapter: CAVIDAD_ORAL },
  { code: "K07.4", description: "Maloclusión, no especificada",              chapter: CAVIDAD_ORAL },
  { code: "K07.5", description: "Trastornos funcionales maxilofaciales",     chapter: CAVIDAD_ORAL },
  { code: "K07.6", description: "Trastornos articulación temporomandibular", chapter: CAVIDAD_ORAL },
  { code: "K07.8", description: "Otras anomalías dentofaciales",             chapter: CAVIDAD_ORAL },
  { code: "K07.9", description: "Anomalía dentofacial, no especificada",     chapter: CAVIDAD_ORAL },

  // ── K08 Otros trastornos dientes y estructuras ────────────────────
  { code: "K08.0", description: "Exfoliación dentaria por causas sistémicas", chapter: CAVIDAD_ORAL },
  { code: "K08.1", description: "Pérdida de dientes por accidente, extracción", chapter: CAVIDAD_ORAL },
  { code: "K08.2", description: "Atrofia del reborde alveolar desdentado",   chapter: CAVIDAD_ORAL },
  { code: "K08.3", description: "Raíz dentaria retenida",                    chapter: CAVIDAD_ORAL },
  { code: "K08.8", description: "Otros trastornos especificados dientes/estructuras", chapter: CAVIDAD_ORAL },
  { code: "K08.9", description: "Trastorno dientes/estructuras, no especificado", chapter: CAVIDAD_ORAL },

  // ── K09 Quistes orales ────────────────────────────────────────────
  { code: "K09.0", description: "Quistes del desarrollo odontogénicos",      chapter: CAVIDAD_ORAL },
  { code: "K09.1", description: "Quistes del desarrollo no odontogénicos",   chapter: CAVIDAD_ORAL },
  { code: "K09.2", description: "Otros quistes maxilares",                   chapter: CAVIDAD_ORAL },
  { code: "K09.8", description: "Otros quistes región oral",                 chapter: CAVIDAD_ORAL },
  { code: "K09.9", description: "Quiste región oral, no especificado",       chapter: CAVIDAD_ORAL },

  // ── K10 Otras enfermedades maxilares ──────────────────────────────
  { code: "K10.0", description: "Trastornos del desarrollo de los maxilares", chapter: CAVIDAD_ORAL },
  { code: "K10.1", description: "Granuloma central de células gigantes",     chapter: CAVIDAD_ORAL },
  { code: "K10.2", description: "Afecciones inflamatorias de los maxilares", chapter: CAVIDAD_ORAL },
  { code: "K10.3", description: "Alveolitis seca",                           chapter: CAVIDAD_ORAL },
  { code: "K10.8", description: "Otras enfermedades especificadas maxilares", chapter: CAVIDAD_ORAL },
  { code: "K10.9", description: "Enfermedad de los maxilares, no especificada", chapter: CAVIDAD_ORAL },

  // ── K11 Glándulas salivales ───────────────────────────────────────
  { code: "K11.0", description: "Atrofia de glándula salival",               chapter: CAVIDAD_ORAL },
  { code: "K11.1", description: "Hipertrofia de glándula salival",           chapter: CAVIDAD_ORAL },
  { code: "K11.2", description: "Sialoadenitis",                             chapter: CAVIDAD_ORAL },
  { code: "K11.3", description: "Absceso de glándula salival",               chapter: CAVIDAD_ORAL },
  { code: "K11.4", description: "Fístula de glándula salival",               chapter: CAVIDAD_ORAL },
  { code: "K11.5", description: "Sialolitiasis",                             chapter: CAVIDAD_ORAL },
  { code: "K11.6", description: "Mucocele de glándula salival",              chapter: CAVIDAD_ORAL },
  { code: "K11.7", description: "Trastorno secreción glándula salival",      chapter: CAVIDAD_ORAL },
  { code: "K11.8", description: "Otras enfermedades glándulas salivales",    chapter: CAVIDAD_ORAL },
  { code: "K11.9", description: "Enfermedad glándula salival, no especificada", chapter: CAVIDAD_ORAL },

  // ── K12 Estomatitis y lesiones afines ─────────────────────────────
  { code: "K12.0", description: "Aftas bucales recidivantes",                chapter: CAVIDAD_ORAL },
  { code: "K12.1", description: "Otras formas de estomatitis",               chapter: CAVIDAD_ORAL },
  { code: "K12.2", description: "Celulitis y absceso de la boca",            chapter: CAVIDAD_ORAL },
  { code: "K12.3", description: "Mucositis oral (ulcerosa)",                 chapter: CAVIDAD_ORAL },

  // ── K13 Labios y mucosa oral ──────────────────────────────────────
  { code: "K13.0", description: "Enfermedades de los labios",                chapter: CAVIDAD_ORAL },
  { code: "K13.1", description: "Mordedura de mejilla y labio",              chapter: CAVIDAD_ORAL },
  { code: "K13.2", description: "Leucoplasia y otras alteraciones epitelio oral", chapter: CAVIDAD_ORAL },
  { code: "K13.3", description: "Leucoplasia pilosa",                        chapter: CAVIDAD_ORAL },
  { code: "K13.4", description: "Granuloma y lesiones similares mucosa oral", chapter: CAVIDAD_ORAL },
  { code: "K13.5", description: "Fibrosis submucosa oral",                   chapter: CAVIDAD_ORAL },
  { code: "K13.6", description: "Hiperplasia irritativa de mucosa oral",     chapter: CAVIDAD_ORAL },
  { code: "K13.7", description: "Otras lesiones especificadas mucosa oral",  chapter: CAVIDAD_ORAL },

  // ── K14 Lengua ────────────────────────────────────────────────────
  { code: "K14.0", description: "Glositis",                                  chapter: CAVIDAD_ORAL },
  { code: "K14.1", description: "Lengua geográfica",                         chapter: CAVIDAD_ORAL },
  { code: "K14.2", description: "Glositis romboidea mediana",                chapter: CAVIDAD_ORAL },
  { code: "K14.3", description: "Hipertrofia papilas linguales",             chapter: CAVIDAD_ORAL },
  { code: "K14.4", description: "Atrofia papilas linguales",                 chapter: CAVIDAD_ORAL },
  { code: "K14.5", description: "Lengua plegada",                            chapter: CAVIDAD_ORAL },
  { code: "K14.6", description: "Glosodinia",                                chapter: CAVIDAD_ORAL },
  { code: "K14.8", description: "Otras enfermedades de la lengua",           chapter: CAVIDAD_ORAL },
  { code: "K14.9", description: "Enfermedad de la lengua, no especificada",  chapter: CAVIDAD_ORAL },

  // ── Cardiovascular ────────────────────────────────────────────────
  { code: "I10",   description: "Hipertensión esencial (primaria)",          chapter: CIRCULATORIO },
  { code: "I11.0", description: "Cardiopatía hipertensiva con insuficiencia cardiaca", chapter: CIRCULATORIO },
  { code: "I11.9", description: "Cardiopatía hipertensiva sin insuficiencia", chapter: CIRCULATORIO },
  { code: "I20.0", description: "Angina inestable",                          chapter: CIRCULATORIO },
  { code: "I20.9", description: "Angina de pecho, no especificada",          chapter: CIRCULATORIO },
  { code: "I21.0", description: "Infarto agudo del miocardio anterior",      chapter: CIRCULATORIO },
  { code: "I21.9", description: "Infarto agudo del miocardio, no especificado", chapter: CIRCULATORIO },
  { code: "I25.1", description: "Enfermedad aterosclerótica del corazón",    chapter: CIRCULATORIO },
  { code: "I25.9", description: "Enfermedad isquémica crónica del corazón",  chapter: CIRCULATORIO },
  { code: "I50.0", description: "Insuficiencia cardiaca congestiva",         chapter: CIRCULATORIO },
  { code: "I50.9", description: "Insuficiencia cardiaca, no especificada",   chapter: CIRCULATORIO },
  { code: "I63.9", description: "Infarto cerebral, no especificado",         chapter: CIRCULATORIO },
  { code: "I64",   description: "Accidente vascular encefálico no especificado", chapter: CIRCULATORIO },
  { code: "I83.9", description: "Várices miembros inferiores sin úlcera ni inflamación", chapter: CIRCULATORIO },

  // ── Endocrino / metabólico ────────────────────────────────────────
  { code: "E03.9", description: "Hipotiroidismo, no especificado",           chapter: ENDOCRINO },
  { code: "E05.0", description: "Tirotoxicosis con bocio difuso",            chapter: ENDOCRINO },
  { code: "E05.9", description: "Tirotoxicosis, no especificada",            chapter: ENDOCRINO },
  { code: "E10.9", description: "Diabetes mellitus tipo 1 sin complicaciones", chapter: ENDOCRINO },
  { code: "E11.0", description: "Diabetes mellitus tipo 2 con coma",         chapter: ENDOCRINO },
  { code: "E11.2", description: "Diabetes mellitus tipo 2 con complicaciones renales", chapter: ENDOCRINO },
  { code: "E11.3", description: "Diabetes mellitus tipo 2 con complicaciones oftálmicas", chapter: ENDOCRINO },
  { code: "E11.4", description: "Diabetes mellitus tipo 2 con complicaciones neurológicas", chapter: ENDOCRINO },
  { code: "E11.6", description: "Diabetes mellitus tipo 2 con otras complicaciones especificadas", chapter: ENDOCRINO },
  { code: "E11.9", description: "Diabetes mellitus tipo 2 sin complicaciones", chapter: ENDOCRINO },
  { code: "E66.0", description: "Obesidad debida a exceso de calorías",      chapter: ENDOCRINO },
  { code: "E66.9", description: "Obesidad, no especificada",                 chapter: ENDOCRINO },
  { code: "E78.0", description: "Hipercolesterolemia pura",                  chapter: ENDOCRINO },
  { code: "E78.5", description: "Dislipidemia, no especificada",             chapter: ENDOCRINO },
  { code: "E86",   description: "Depleción del volumen (deshidratación)",    chapter: ENDOCRINO },

  // ── Mental / comportamiento ───────────────────────────────────────
  { code: "F32.0", description: "Episodio depresivo leve",                   chapter: MENTAL },
  { code: "F32.1", description: "Episodio depresivo moderado",               chapter: MENTAL },
  { code: "F32.2", description: "Episodio depresivo grave sin síntomas psicóticos", chapter: MENTAL },
  { code: "F32.9", description: "Episodio depresivo, no especificado",       chapter: MENTAL },
  { code: "F33.1", description: "Trastorno depresivo recurrente, episodio actual moderado", chapter: MENTAL },
  { code: "F33.9", description: "Trastorno depresivo recurrente, no especificado", chapter: MENTAL },
  { code: "F40.0", description: "Agorafobia",                                chapter: MENTAL },
  { code: "F40.1", description: "Fobias sociales",                           chapter: MENTAL },
  { code: "F41.0", description: "Trastorno de pánico",                       chapter: MENTAL },
  { code: "F41.1", description: "Trastorno de ansiedad generalizada",        chapter: MENTAL },
  { code: "F41.9", description: "Trastorno de ansiedad, no especificado",    chapter: MENTAL },
  { code: "F43.0", description: "Reacción al estrés agudo",                  chapter: MENTAL },
  { code: "F43.1", description: "Trastorno de estrés postraumático",         chapter: MENTAL },
  { code: "F43.2", description: "Trastornos de adaptación",                  chapter: MENTAL },

  // ── Sistema nervioso ──────────────────────────────────────────────
  { code: "G43.0", description: "Migraña sin aura",                          chapter: NERVIOSO },
  { code: "G43.1", description: "Migraña con aura",                          chapter: NERVIOSO },
  { code: "G43.9", description: "Migraña, no especificada",                  chapter: NERVIOSO },
  { code: "G44.2", description: "Cefalea de tipo tensión",                   chapter: NERVIOSO },
  { code: "G47.0", description: "Trastornos del inicio y mantenimiento del sueño (insomnio)", chapter: NERVIOSO },
  { code: "G47.1", description: "Hipersomnio",                               chapter: NERVIOSO },
  { code: "G47.3", description: "Apnea del sueño",                           chapter: NERVIOSO },

  // ── Respiratorio ──────────────────────────────────────────────────
  { code: "J00",   description: "Rinofaringitis aguda (resfriado común)",    chapter: RESPIRATORIO },
  { code: "J01.9", description: "Sinusitis aguda, no especificada",          chapter: RESPIRATORIO },
  { code: "J02.0", description: "Faringitis estreptocócica",                 chapter: RESPIRATORIO },
  { code: "J02.9", description: "Faringitis aguda, no especificada",         chapter: RESPIRATORIO },
  { code: "J03.0", description: "Amigdalitis estreptocócica",                chapter: RESPIRATORIO },
  { code: "J03.9", description: "Amigdalitis aguda, no especificada",        chapter: RESPIRATORIO },
  { code: "J04.0", description: "Laringitis aguda",                          chapter: RESPIRATORIO },
  { code: "J11.1", description: "Influenza con manifestaciones respiratorias", chapter: RESPIRATORIO },
  { code: "J18.0", description: "Bronconeumonía, no especificada",           chapter: RESPIRATORIO },
  { code: "J18.9", description: "Neumonía, no especificada",                 chapter: RESPIRATORIO },
  { code: "J20.9", description: "Bronquitis aguda, no especificada",         chapter: RESPIRATORIO },
  { code: "J30.4", description: "Rinitis alérgica, no especificada",         chapter: RESPIRATORIO },
  { code: "J40",   description: "Bronquitis, no especificada como aguda o crónica", chapter: RESPIRATORIO },
  { code: "J42",   description: "Bronquitis crónica, no especificada",       chapter: RESPIRATORIO },
  { code: "J45.0", description: "Asma predominantemente alérgica",           chapter: RESPIRATORIO },
  { code: "J45.9", description: "Asma, no especificada",                     chapter: RESPIRATORIO },

  // ── Digestivo ─────────────────────────────────────────────────────
  { code: "K20",   description: "Esofagitis",                                chapter: DIGESTIVO },
  { code: "K21.0", description: "Enf. reflujo gastroesofágico con esofagitis", chapter: DIGESTIVO },
  { code: "K21.9", description: "Enf. reflujo gastroesofágico sin esofagitis", chapter: DIGESTIVO },
  { code: "K25.9", description: "Úlcera gástrica, no especificada",          chapter: DIGESTIVO },
  { code: "K26.9", description: "Úlcera duodenal, no especificada",          chapter: DIGESTIVO },
  { code: "K29.0", description: "Gastritis aguda hemorrágica",               chapter: DIGESTIVO },
  { code: "K29.7", description: "Gastritis, no especificada",                chapter: DIGESTIVO },
  { code: "K30",   description: "Dispepsia",                                 chapter: DIGESTIVO },
  { code: "K58.0", description: "Síndrome del colon irritable con diarrea",  chapter: DIGESTIVO },
  { code: "K58.9", description: "Síndrome del colon irritable sin diarrea",  chapter: DIGESTIVO },
  { code: "K59.0", description: "Estreñimiento",                             chapter: DIGESTIVO },
  { code: "K59.1", description: "Diarrea funcional",                         chapter: DIGESTIVO },
  { code: "K80.2", description: "Cálculo de la vesícula biliar sin colecistitis", chapter: DIGESTIVO },

  // ── Piel ──────────────────────────────────────────────────────────
  { code: "L20.9", description: "Dermatitis atópica, no especificada",       chapter: PIEL },
  { code: "L23.9", description: "Dermatitis alérgica de contacto, causa no especificada", chapter: PIEL },
  { code: "L30.9", description: "Dermatitis, no especificada",               chapter: PIEL },
  { code: "L40.0", description: "Psoriasis vulgar",                          chapter: PIEL },
  { code: "L40.9", description: "Psoriasis, no especificada",                chapter: PIEL },
  { code: "L70.0", description: "Acné vulgar",                               chapter: PIEL },
  { code: "L70.9", description: "Acné, no especificado",                     chapter: PIEL },

  // ── Musculoesquelético ────────────────────────────────────────────
  { code: "M16.9", description: "Coxartrosis, no especificada",              chapter: MUSCULOESQUELETICO },
  { code: "M17.9", description: "Gonartrosis, no especificada",              chapter: MUSCULOESQUELETICO },
  { code: "M19.9", description: "Artrosis, no especificada",                 chapter: MUSCULOESQUELETICO },
  { code: "M25.5", description: "Dolor articular",                           chapter: MUSCULOESQUELETICO },
  { code: "M51.1", description: "Trastornos disco intervertebral lumbar y otros con radiculopatía", chapter: MUSCULOESQUELETICO },
  { code: "M54.2", description: "Cervicalgia",                               chapter: MUSCULOESQUELETICO },
  { code: "M54.4", description: "Lumbago con ciática",                       chapter: MUSCULOESQUELETICO },
  { code: "M54.5", description: "Lumbago no especificado",                   chapter: MUSCULOESQUELETICO },
  { code: "M62.6", description: "Distensión muscular",                       chapter: MUSCULOESQUELETICO },

  // ── Genitourinario ────────────────────────────────────────────────
  { code: "N18.9", description: "Insuficiencia renal crónica, no especificada", chapter: GENITOURINARIO },
  { code: "N20.0", description: "Cálculo del riñón",                         chapter: GENITOURINARIO },
  { code: "N20.9", description: "Cálculo urinario, no especificado",         chapter: GENITOURINARIO },
  { code: "N30.0", description: "Cistitis aguda",                            chapter: GENITOURINARIO },
  { code: "N30.9", description: "Cistitis, no especificada",                 chapter: GENITOURINARIO },
  { code: "N39.0", description: "Infección de vías urinarias, sitio no especificado", chapter: GENITOURINARIO },

  // ── Embarazo ──────────────────────────────────────────────────────
  { code: "O10.0", description: "Hipertensión esencial preexistente complicando embarazo", chapter: EMBARAZO },
  { code: "O14.0", description: "Preeclampsia moderada",                     chapter: EMBARAZO },
  { code: "O60.0", description: "Trabajo de parto pretérmino sin parto",     chapter: EMBARAZO },
  { code: "Z34.0", description: "Supervisión de embarazo normal",            chapter: EMBARAZO },

  // ── Síntomas / signos ─────────────────────────────────────────────
  { code: "R05",   description: "Tos",                                       chapter: SINTOMAS },
  { code: "R06.0", description: "Disnea",                                    chapter: SINTOMAS },
  { code: "R07.4", description: "Dolor en el pecho, no especificado",        chapter: SINTOMAS },
  { code: "R10.0", description: "Abdomen agudo",                             chapter: SINTOMAS },
  { code: "R10.4", description: "Otros dolores abdominales",                 chapter: SINTOMAS },
  { code: "R11",   description: "Náusea y vómito",                           chapter: SINTOMAS },
  { code: "R42",   description: "Mareo y desvanecimiento",                   chapter: SINTOMAS },
  { code: "R50.9", description: "Fiebre, no especificada",                   chapter: SINTOMAS },
  { code: "R51",   description: "Cefalea",                                   chapter: SINTOMAS },
  { code: "R52.0", description: "Dolor agudo",                               chapter: SINTOMAS },
  { code: "R52.2", description: "Otro dolor crónico",                        chapter: SINTOMAS },
  { code: "R52.9", description: "Dolor, no especificado",                    chapter: SINTOMAS },
  { code: "R53",   description: "Malestar y fatiga",                         chapter: SINTOMAS },
  { code: "R63.0", description: "Anorexia",                                  chapter: SINTOMAS },

  // ── Factores / contacto con servicios ─────────────────────────────
  { code: "Z00.0", description: "Examen general de salud (rutinario)",       chapter: FACTORES },
  { code: "Z00.1", description: "Examen pediátrico de control rutinario",    chapter: FACTORES },
  { code: "Z01.2", description: "Examen y consulta odontológica",            chapter: FACTORES },
  { code: "Z01.3", description: "Examen de la presión arterial",             chapter: FACTORES },
  { code: "Z02.0", description: "Examen para admisión a institución educativa", chapter: FACTORES },
  { code: "Z23.9", description: "Necesidad de inmunización contra una sola enfermedad", chapter: FACTORES },
  { code: "Z51.1", description: "Sesión de quimioterapia por neoplasia",     chapter: FACTORES },
  { code: "Z71.3", description: "Consejo dietético y vigilancia",            chapter: FACTORES },
  { code: "Z76.0", description: "Emisión de receta repetida",                chapter: FACTORES },
];
