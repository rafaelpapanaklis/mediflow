// Implants — textos legales de consentimiento informado. Spec §10.4, §10.5.
//
// IMPORTANTE: No cambiar el texto sin coordinación legal. Cualquier
// modificación afecta retroactivamente la trazabilidad legal de
// consentimientos previos. Spec §10.

/**
 * Texto del consentimiento informado quirúrgico. Spec §10.4.
 * El placeholder {nombre} se reemplaza al renderizar. SignaturePad de
 * pediatría se usa para la firma (Spec §1.18, reuso obligatorio).
 */
export const SURGERY_CONSENT_TEXT = `
CONSENTIMIENTO INFORMADO PARA TRATAMIENTO IMPLANTOLÓGICO

Yo, {nombre}, declaro haber sido informado por el Dr./Dra. {doctor}
(Cédula Profesional {cedula}) sobre el tratamiento implantológico
recomendado y comprendo lo siguiente:

1. EN QUÉ CONSISTE EL TRATAMIENTO
El procedimiento consiste en colocar uno o más implantes dentales
(tornillos de titanio) en mi hueso maxilar o mandibular. Tras un
periodo de cicatrización (osteointegración), se colocará una corona,
puente o prótesis sobre los implantes.

2. POR QUÉ SE ME REALIZA
Para reemplazar uno o más dientes ausentes, recuperando la función
masticatoria, la estética y la salud del sistema masticatorio.

3. ALTERNATIVAS
Comprendo que existen alternativas: puente fijo sobre dientes vecinos,
prótesis removible parcial o total, o no realizar tratamiento. Cada
alternativa tiene ventajas y desventajas que me han sido explicadas.

4. RIESGOS Y POSIBLES COMPLICACIONES
Acepto que todo procedimiento quirúrgico conlleva riesgos. Entre las
posibles complicaciones específicas del tratamiento implantológico se
encuentran:
- Quirúrgicas inmediatas: hemorragia, infección, inflamación, dolor
  posoperatorio.
- Específicas del implante: parestesia (alteración de sensibilidad)
  transitoria o permanente del nervio dentario inferior, perforación
  del seno maxilar, fracaso en la osteointegración (5-10% de los casos),
  fractura del implante, fractura de la prótesis o de tornillos.
- Biológicas a largo plazo: mucositis y peri-implantitis (inflamación
  alrededor del implante con posible pérdida ósea).
- Mecánicas: aflojamiento o fractura del tornillo, desgaste o fractura
  de la prótesis.

5. FACTORES QUE AUMENTAN MIS RIESGOS PERSONALES
Reconozco que los siguientes factores aumentan el riesgo de
complicaciones y declaro a mi doctor mi situación actual:
- Tabaquismo (reduce significativamente la tasa de éxito).
- Diabetes (debe estar controlada con HbA1c <7% para cirugía electiva).
- Tratamiento con bifosfonatos o medicamentos antirresortivos (riesgo
  de osteonecrosis maxilar — MRONJ).
- Radioterapia previa de cabeza/cuello.
- Higiene oral deficiente o falta de cumplimiento del mantenimiento.

6. COSTOS
Recibí el detalle de los costos por fase del tratamiento, los
honorarios profesionales, los costos de los componentes y de
laboratorio. Los acepto y entiendo que pueden modificarse si surgen
imprevistos clínicos que serán informados antes de continuar.

7. PLAN DE MANTENIMIENTO DE POR VIDA
Me comprometo a mantener una excelente higiene oral diaria, asistir
a controles profesionales cada 6 meses (o con la cadencia que indique
mi doctor) y cumplir con los controles radiográficos a los 6, 12 y
24 meses, y posteriormente con la frecuencia indicada. Entiendo que
el incumplimiento del mantenimiento es una de las principales causas
de fracaso a largo plazo.

8. LO QUE NO SE GARANTIZA
Comprendo que ningún tratamiento médico-odontológico ofrece garantía
absoluta de éxito. La tasa de éxito reportada para implantes
dentales es del 90-95% a 10 años bajo condiciones óptimas. Acepto
que el resultado depende de factores biológicos individuales, mi
cumplimiento del plan de mantenimiento, y otras variables fuera del
control del equipo tratante.

DECLARACIÓN
He tenido la oportunidad de hacer todas las preguntas que consideré
necesarias y han sido respondidas a mi entera satisfacción. Acepto
voluntariamente someterme al tratamiento implantológico descrito.

Firmas: paciente y doctor con cédula profesional. Si menor de edad
o representación legal: padre, madre o tutor.
`.trim();

/**
 * Texto de consentimiento para aumento óseo (v1.1). Diferenciado por
 * origen del biomaterial. Spec §10.5. En MVP solo se documenta — la
 * función v1.1 BoneAugmentation lo activará.
 */
export function boneAugmentationConsentText(
  graftSource:
    | "AUTOLOGOUS"
    | "ALLOGRAFT_HUMAN"
    | "XENOGRAFT_BOVINE"
    | "XENOGRAFT_PORCINE"
    | "SYNTHETIC_BIOACTIVE_GLASS"
    | "SYNTHETIC_HYDROXYAPATITE"
    | "SYNTHETIC_TCP"
    | "OTRO",
): string {
  const SOURCE_DESCRIPTION: Record<string, string> = {
    AUTOLOGOUS:
      "Hueso propio del paciente, tomado de zona donante (mentón, " +
      "rama mandibular, cresta ilíaca según el caso).",
    ALLOGRAFT_HUMAN:
      "Hueso de banco de tejidos humanos certificado, procesado y " +
      "esterilizado conforme a normativa internacional.",
    XENOGRAFT_BOVINE:
      "Hueso de origen bovino procesado (típicamente Bio-Oss). " +
      "Más de 30 años de respaldo clínico documentado.",
    XENOGRAFT_PORCINE:
      "Hueso de origen porcino procesado. ALERTA: si por motivos " +
      "religiosos no aceptas materiales de origen porcino, " +
      "comunícalo para usar una alternativa.",
    SYNTHETIC_BIOACTIVE_GLASS:
      "Material 100% sintético — vidrio bioactivo.",
    SYNTHETIC_HYDROXYAPATITE:
      "Material 100% sintético — hidroxiapatita.",
    SYNTHETIC_TCP:
      "Material 100% sintético — fosfato tricálcico (TCP).",
    OTRO: "Material adicional descrito en notas clínicas.",
  };

  return `
CONSENTIMIENTO INFORMADO — AUMENTO ÓSEO

ORIGEN DEL BIOMATERIAL
${SOURCE_DESCRIPTION[graftSource] ?? SOURCE_DESCRIPTION.OTRO}

RIESGOS ESPECÍFICOS DEL AUMENTO ÓSEO
- Reabsorción parcial del injerto (típicamente 20%).
- Fracaso del injerto (5-15%).
- Exposición de membrana barrera durante cicatrización.
- Reacción a biomateriales (raro).

CONSIDERACIONES RELIGIOSAS Y ÉTICAS
Si tienes preferencias religiosas o éticas relacionadas con el
origen del biomaterial, comunícalo previo al procedimiento. Toda
discusión queda documentada en mi expediente clínico.
`.trim();
}

/**
 * Texto del consentimiento para activar el QR público del carnet
 * implantológico. LFPDPPP — opt-in explícito. Spec §10.3, §1.16.
 */
export const QR_PUBLIC_CONSENT_TEXT = `
CONSENTIMIENTO PARA ACTIVAR QR PÚBLICO DEL CARNET DEL IMPLANTE

Autorizo activar un código QR público en mi carnet del implante.
El QR enlazará a una vista pública con datos NO identificables
del implante (marca, modelo, lote, fecha de colocación, doctor
responsable y teléfono de la clínica) destinada a uso en
emergencias médicas.

Comprendo que:
- El QR es OPCIONAL y puedo solicitar su desactivación en cualquier
  momento.
- La vista pública NO incluye mi nombre, dirección ni datos
  personales identificables, conforme a la LFPDPPP.
- Si decido desactivarlo, el QR del PDF descargado previamente
  dejará de funcionar dentro de las 24 h posteriores a la solicitud.
`.trim();
