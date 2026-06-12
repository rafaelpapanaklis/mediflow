/**
 * Plantillas de indicaciones generales para el paciente.
 *
 * Se ofrecen como punto de partida editable en el modal de receta: al elegir
 * una, su texto PRELLENA el campo `indications` (que se imprime tal cual en el
 * PDF de la receta). El doctor puede editarlas y combinar varias.
 *
 * El texto usa saltos de línea reales (`\n`) y viñetas `•`; ambos se renderizan
 * correctamente en el PDF (Helvetica, react-pdf respeta `\n`). Español neutro,
 * dirigido al paciente de tú, sin tecnicismos.
 *
 * NOTA: son indicaciones generales de referencia. NO sustituyen el criterio del
 * doctor; siempre revisa y ajusta al caso de cada paciente.
 */

export interface IndicationTemplate {
  id: string;
  label: string;
  /** Texto que prellena el campo de indicaciones (editable). */
  text: string;
}

export const INDICATION_TEMPLATES: IndicationTemplate[] = [
  {
    id: "post-extraccion",
    label: "Post-extracción",
    text: [
      "Cuidados después de la extracción:",
      "• Muerde la gasa con firmeza durante 30 a 45 minutos. Cámbiala solo si se llena de sangre.",
      "• Durante las primeras 24 horas no escupas, no uses popote ni te enjuagues con fuerza: podrías desprender el coágulo.",
      "• Aplica frío en la mejilla del lado tratado: 15 minutos con frío y 15 sin frío, durante las primeras horas.",
      "• El primer día come alimentos blandos y fríos o tibios. Evita lo caliente, duro, picante o crujiente.",
      "• No fumes ni tomes bebidas alcohólicas por al menos 72 horas.",
      "• A partir del segundo día enjuágate suavemente con agua tibia y sal (media cucharadita en un vaso) después de cada comida.",
      "• Cepilla tus dientes con cuidado, evitando la zona de la herida los primeros días.",
      "• Toma los medicamentos tal como se te indicaron.",
      "• Acude o llama a la clínica si hay sangrado abundante que no cede, dolor que aumenta después del tercer día, inflamación importante o fiebre.",
    ].join("\n"),
  },
  {
    id: "post-endodoncia",
    label: "Post-endodoncia (tratamiento de conducto)",
    text: [
      "Cuidados después del tratamiento de conducto:",
      "• Es normal sentir molestia o sensibilidad al morder durante los primeros días; suele disminuir de manera gradual.",
      "• No mastiques con el diente tratado hasta que se coloque su restauración o corona definitiva: el diente está más frágil y puede fracturarse.",
      "• Toma los analgésicos indicados a sus horas, sin esperar a que el dolor sea fuerte.",
      "• Mantén tu higiene habitual: cepillado y limpieza entre los dientes.",
      "• No suspendas el tratamiento: es indispensable colocar la restauración definitiva en el tiempo indicado para proteger el diente.",
      "• Llama a la clínica si el dolor es intenso y no cede con el medicamento, si notas inflamación que crece o si aparece un abultamiento en la encía.",
    ].join("\n"),
  },
  {
    id: "post-cirugia-implante",
    label: "Post-cirugía / implante",
    text: [
      "Cuidados después de la cirugía / colocación de implante:",
      "• Mantén la gasa con presión sobre la zona el tiempo que se te indicó. Un sangrado ligero las primeras horas es normal.",
      "• Aplica frío en la cara del lado operado las primeras 24 a 48 horas (15 minutos sí, 15 minutos no) para reducir la inflamación.",
      "• Descansa el resto del día y evita esfuerzo físico, agacharte o cargar peso durante 2 a 3 días.",
      "• Duerme con la cabeza un poco elevada los primeros días.",
      "• Dieta blanda y fría o tibia. Evita alimentos calientes, duros, picantes y no uses popote.",
      "• No fumes ni tomes alcohol mientras dure la cicatrización: retrasan la integración del implante.",
      "• No toques la herida ni los puntos con la lengua o los dedos.",
      "• Toma el antibiótico completo y los analgésicos tal como se te indicaron. No suspendas el antibiótico aunque te sientas bien.",
      "• A partir del día siguiente, enjuágate con suavidad con el enjuague o el agua con sal indicados.",
      "• Acude a la clínica si hay sangrado que no cede, dolor que aumenta, inflamación importante, pus o fiebre. Asiste a tu cita de revisión y retiro de puntos.",
    ].join("\n"),
  },
  {
    id: "manejo-dolor",
    label: "Manejo del dolor / analgesia",
    text: [
      "Indicaciones para el control del dolor:",
      "• Toma el analgésico a sus horas durante los primeros días, sin esperar a que el dolor sea fuerte: es más fácil prevenirlo que calmarlo.",
      "• Respeta la dosis y el intervalo indicados. No tomes más cantidad ni más seguido de lo señalado.",
      "• Toma el medicamento con algo de alimento para cuidar tu estómago, salvo que se te indique lo contrario.",
      "• No combines por tu cuenta con otros analgésicos ni con remedios sin avisar a la clínica.",
      "• Aplicar frío en la zona las primeras horas también ayuda a disminuir la molestia.",
      "• Si el dolor no cede con el medicamento, aumenta con el paso de los días o se acompaña de inflamación o fiebre, comunícate con la clínica.",
    ].join("\n"),
  },
  {
    id: "antibiotico",
    label: "Antibiótico (terminar el esquema completo)",
    text: [
      "Indicaciones para el antibiótico:",
      "• Toma el antibiótico exactamente a las horas indicadas para mantener un nivel constante en tu cuerpo.",
      "• TERMINA TODO EL ESQUEMA, aunque te sientas mejor antes. Suspenderlo antes de tiempo hace que la infección regrese y que el medicamento deje de funcionar.",
      "• Si olvidas una toma, tómala en cuanto lo recuerdes; si ya casi es hora de la siguiente, omite la olvidada y continúa normal. Nunca tomes doble dosis.",
      "• Tómalo con un vaso de agua. Sigue la indicación de tomarlo con o sin alimentos.",
      "• Evita el alcohol mientras dure el tratamiento.",
      "• Suspende y avisa de inmediato a la clínica si presentas ronchas, comezón, hinchazón de labios o cara, o dificultad para respirar: podría ser una reacción alérgica.",
      "• Avísanos si tienes diarrea intensa o que no cede.",
    ].join("\n"),
  },
  {
    id: "ortodoncia-molestias",
    label: "Molestias de ortodoncia",
    text: [
      "Indicaciones para las molestias de ortodoncia:",
      "• Después de colocar o ajustar tus brackets es normal sentir presión o que los dientes están sensibles durante 2 a 4 días. Cede solo.",
      "• Prefiere alimentos blandos los primeros días (sopas, purés, huevo, pasta, yogurt) y come a bocados pequeños.",
      "• Si una parte del aparato te lastima la mejilla o el labio, coloca un poco de cera de ortodoncia sobre esa zona.",
      "• Toma el analgésico indicado si la molestia te incomoda.",
      "• Enjuágate con agua tibia con sal si tienes alguna llaguita; suele sanar en pocos días.",
      "• Evita alimentos duros, pegajosos o muy crujientes (chicle, caramelos, hielo, nueces) para no despegar o doblar el aparato.",
      "• Mantén una limpieza cuidadosa después de cada comida.",
      "• Llama a la clínica si se despega un bracket, se zafa o sale un alambre que te lastima y no puedes acomodarlo con la cera.",
    ].join("\n"),
  },
];
