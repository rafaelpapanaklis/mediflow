import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import type { BlogFaqItem } from "@/lib/blog/types";
import { getHerramientaBySlug } from "@/lib/herramientas/data";
import { toolOgUrl } from "@/lib/herramientas/json-ld";
import { ToolPageShell } from "@/components/herramientas/page-shell";
import { CONSENT_PROCEDURES } from "@/lib/herramientas/consent-procedures";
import { ConsentFormTool } from "./tool";

// ─────────────────────────────────────────────────────────────────────────────
// /herramientas/generador-consentimiento-informado
//
// Página estática (data en el repo). El único cliente es <ConsentFormTool />.
// El disclaimer clínico va en la intro, dentro de la herramienta (arriba y
// abajo) y en el documento generado: es un formato que se imprime y se firma.
// ─────────────────────────────────────────────────────────────────────────────

const tool = getHerramientaBySlug("generador-consentimiento-informado")!;

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: tool.metaTitle,
  description: tool.metaDescription,
  path: `/herramientas/${tool.slug}`,
  ogImage: toolOgUrl(tool.headline),
  keywords: tool.keywords,
});

const FAQ: BlogFaqItem[] = [
  {
    q: "¿Qué debe incluir un consentimiento informado en odontología?",
    a: "Como mínimo: quién es el paciente y quién el doctor tratante, en qué consiste el procedimiento explicado en lenguaje claro, los riesgos y molestias que cabe esperar, las alternativas disponibles —incluida la de no tratarse y sus consecuencias—, la constancia de que se resolvieron las dudas del paciente, y la firma de ambos con fecha y lugar. Si el paciente es menor de edad o no puede otorgar su consentimiento, firma el padre, la madre, el tutor o el representante legal. Un consentimiento genérico firmado sin explicación no cumple su función: lo que protege es la conversación, y el documento es la constancia de que existió.",
  },
  {
    q: "¿Basta con un solo consentimiento para todo el tratamiento del paciente?",
    a: "No es lo recomendable. Cada procedimiento con riesgos propios merece su propio consentimiento: una extracción, una endodoncia y un implante no tienen las mismas complicaciones ni las mismas alternativas. Un documento único al abrir el expediente sirve para la atención general, pero no cubre un procedimiento invasivo que se decide meses después. La práctica más segura es firmar el consentimiento específico antes de cada procedimiento y guardar la copia en el expediente clínico del paciente.",
  },
  {
    q: "¿Puedo usar este formato tal como sale del generador?",
    a: "No sin revisarlo. Lo que obtienes es un formato base con la estructura completa y los riesgos frecuentes del procedimiento que elegiste, redactados en términos generales. El doctor tratante tiene que revisarlo, ajustar el contenido clínico al caso concreto —qué diente, qué hallazgos, qué particularidades tiene ese paciente— y completar el apartado de observaciones. También conviene que un asesor legal revise el formato una vez antes de adoptarlo en el consultorio.",
  },
];

const FEATURES = [
  `Formato base para ${CONSENT_PROCEDURES.length} procedimientos dentales`,
  "Riesgos y molestias frecuentes del procedimiento elegido",
  "Alternativas, incluida la de no tratarse",
  "Apartado de dudas resueltas y campos de firma",
  "Copia el texto o imprime el formato en una hoja limpia",
];

export default function GeneradorConsentimientoInformadoPage() {
  return (
    <ToolPageShell
      tool={tool}
      lede={`Elige el procedimiento entre ${CONSENT_PROCEDURES.length} opciones, pon el nombre de la clínica y del doctor, y obtén un formato base de consentimiento informado con riesgos, alternativas y campos de firma, listo para revisar e imprimir.`}
      faq={FAQ}
      featureList={FEATURES}
      ctaTitle="Los consentimientos, dentro del expediente del paciente"
      ctaText="Sube el documento firmado al expediente digital y déjalo junto a la historia clínica, las radiografías y las notas de cada consulta. Cuando alguien lo necesita dos años después, aparece en segundos."
    >
      <div className="blog-prose">
        <p>
          Este <strong>generador de consentimiento informado</strong> arma un formato base por
          procedimiento para tu consultorio dental. Eliges entre {CONSENT_PROCEDURES.length}{" "}
          procedimientos frecuentes —extracción, tercer molar, endodoncia, resina, corona, implante,
          limpieza profunda, ortodoncia y blanqueamiento—, pones el nombre de la clínica y del
          doctor tratante, y obtienes el documento con sus apartados completos para copiarlo o
          imprimirlo.
        </p>
        <p>
          Conviene decir para qué sirve de verdad este documento, porque suele malentenderse. El
          consentimiento informado no es un papel para librarse de responsabilidad: es la constancia
          de que hubo una conversación en la que el paciente entendió qué se le va a hacer, qué
          molestias puede esperar, qué alternativas tenía y qué pasa si no se trata. Un formato
          firmado sin esa plática no protege a nadie; una plática buena sin constancia escrita
          tampoco, porque dos años después nadie recuerda los detalles. Lo que funciona es tener las
          dos cosas.
        </p>
        <p>
          Por eso el formato incluye un apartado de observaciones del caso y otro de dudas
          resueltas. Ahí es donde el documento deja de ser genérico: el doctor anota en qué diente o
          zona se hará el procedimiento, qué se encontró en la radiografía y qué particularidades
          tiene ese paciente. Los riesgos que el generador incluye son los frecuentes y ampliamente
          documentados del procedimiento elegido, redactados con prudencia y en términos generales,
          precisamente para que el criterio del doctor sea el que complete el resto.
        </p>
        <p>
          Tres recomendaciones prácticas. Primera: un consentimiento por procedimiento, no uno para
          todo el plan de tratamiento; los riesgos de una limpieza profunda y de un implante no se
          parecen. Segunda: fírmalo antes del procedimiento, nunca con el paciente ya en el sillón y
          anestesiado. Tercera: guarda la copia firmada en el{" "}
          <Link href="/blog/expediente-clinico-electronico-dental">expediente clínico</Link>, junto
          a la historia y las imágenes del caso, porque el consentimiento que no se encuentra vale
          lo mismo que el que no se firmó.
        </p>
        <p>
          Y la advertencia que no queremos que se pierda: esto es un formato base orientativo. El
          contenido clínico debe revisarlo, completarlo y validarlo el doctor tratante; no sustituye
          su criterio ni asesoría legal.
        </p>
      </div>

      <div style={{ marginTop: 26 }}>
        <ConsentFormTool />
      </div>
    </ToolPageShell>
  );
}
