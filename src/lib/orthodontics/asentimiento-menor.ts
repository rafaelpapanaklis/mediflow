// H64: texto del asentimiento del menor en ortodoncia. El consentimiento legal lo
// firma el representante (NOM-004 10.1.1.3); esto deja constancia de que al
// menor se le explicó, con palabras sencillas, lo que va a pasar y que está de
// acuerdo. Es una BASE: el doctor puede editarla antes de entregarla.

export function textoAsentimientoMenor(nombreDelMenor: string): string {
  return [
    "ASENTIMIENTO DEL MENOR — TRATAMIENTO DE ORTODONCIA",
    "",
    `Yo, ${nombreDelMenor || "el paciente"}, he platicado con mi doctor y con mi representante sobre mi tratamiento de ortodoncia.`,
    "",
    "Me explicaron, con palabras que entiendo:",
    "• Que me van a poner aparatos en los dientes para acomodarlos y que mi mordida quede mejor.",
    "• Que al principio pueden dolerme los dientes o molestarme los aparatos, y que es normal.",
    "• Que tengo que cepillarme con cuidado, usar los elásticos y los retenedores como me indiquen, y venir a todas mis citas.",
    "• Que puedo hacer preguntas cuando quiera y avisar si algo me molesta o se me despega.",
    "",
    "Entiendo que mi representante es quien autoriza legalmente el tratamiento, y yo estoy de acuerdo en hacerlo.",
  ].join("\n");
}
