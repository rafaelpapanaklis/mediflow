export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InventoryClient } from "./inventory-client";

export const metadata: Metadata = { title: "Inventario — MediFlow" };

// Full dental inventory list — seeded server-side on first visit
const DENTAL_SEED = [
  // Instrumental básico
  { name:"Espejo dental",              category:"Instrumental básico",        description:"Para visualizar áreas de difícil acceso en la boca" },
  { name:"Explorador",                 category:"Instrumental básico",        description:"Detecta caries y anomalías en el esmalte" },
  { name:"Pinza algodonera",           category:"Instrumental básico",        description:"Para colocar y retirar rollos de algodón" },
  { name:"Sonda periodontal",          category:"Instrumental básico",        description:"Mide la profundidad de bolsas periodontales" },
  { name:"Excavador",                  category:"Instrumental básico",        description:"Elimina tejido cariado y material blando" },
  { name:"Curetas",                    category:"Instrumental básico",        description:"Raspado y alisado radicular" },
  { name:"Elevadores",                 category:"Instrumental básico",        description:"Para luxar piezas dentales antes de extracción" },
  { name:"Fórceps de extracción",      category:"Instrumental básico",        description:"Extracción de piezas dentales" },
  { name:"Porta agujas",               category:"Instrumental básico",        description:"Para suturar tejidos" },
  { name:"Tijeras quirúrgicas",        category:"Instrumental básico",        description:"Corte de suturas y tejidos blandos" },
  { name:"Separadores",                category:"Instrumental básico",        description:"Separar tejidos blandos durante procedimientos" },
  { name:"Retractores",                category:"Instrumental básico",        description:"Retracción de labios y mejillas" },
  { name:"Espátulas para cemento",     category:"Instrumental básico",        description:"Mezcla y aplicación de cementos dentales" },
  { name:"Jeringa carpule",            category:"Instrumental básico",        description:"Aplicación de anestesia local" },
  { name:"Limas endodónticas",         category:"Instrumental básico",        description:"Limpieza y conformación de conductos radiculares" },
  { name:"Localizador de ápice",       category:"Instrumental básico",        description:"Determina la longitud del conducto radicular" },
  { name:"Instrumentos de ortodoncia", category:"Instrumental básico",        description:"Set de instrumentos para ortodoncia" },
  // Fresas
  { name:"Fresa redonda de carburo",        category:"Fresas dentales", description:"Remoción de tejido cariado" },
  { name:"Fresa redonda diamantada",        category:"Fresas dentales", description:"Desgaste de estructuras dentales duras" },
  { name:"Fresa pera",                      category:"Fresas dentales", description:"Preparación de cavidades clase I y II" },
  { name:"Fresa cilíndrica",                category:"Fresas dentales", description:"Preparación de paredes paralelas" },
  { name:"Fresa troncocónica",              category:"Fresas dentales", description:"Preparación de cavidades" },
  { name:"Fresa de fisura recta",           category:"Fresas dentales", description:"Corte de esmalte y dentina" },
  { name:"Fresa de fisura cruzada",         category:"Fresas dentales", description:"Retención en preparaciones cavitarias" },
  { name:"Fresa llama",                     category:"Fresas dentales", description:"Acabado de márgenes en coronas" },
  { name:"Fresa cono invertido",            category:"Fresas dentales", description:"Preparación de cajas proximales" },
  { name:"Fresa balón",                     category:"Fresas dentales", description:"Cavidades de retención y terminación" },
  { name:"Fresa de acabado",                category:"Fresas dentales", description:"Alisado superficial de restauraciones" },
  { name:"Fresa de pulido",                 category:"Fresas dentales", description:"Pulido final de resinas y acrílicos" },
  { name:"Fresa para zirconia",             category:"Fresas dentales", description:"Desgaste de coronas de zirconia" },
  { name:"Fresa para metal",                category:"Fresas dentales", description:"Ajuste de restauraciones metálicas" },
  { name:"Fresa para resina",               category:"Fresas dentales", description:"Acabado de restauraciones en resina" },
  { name:"Fresa para acrílico",             category:"Fresas dentales", description:"Ajuste de prótesis acrílicas" },
  { name:"Fresa quirúrgica larga",          category:"Fresas dentales", description:"Cirugías de implantes y extracciones complejas" },
  { name:"Fresa quirúrgica de implantes",   category:"Fresas dentales", description:"Osteotomía para colocación de implantes" },
  { name:"Fresa Gates",                     category:"Fresas dentales", description:"Apertura cameral en endodoncia" },
  { name:"Fresa Peeso",                     category:"Fresas dentales", description:"Desgaste intracanal para postes" },
  { name:"Fresa endo-Z",                    category:"Fresas dentales", description:"Acceso endodóntico seguro" },
  { name:"Fresa multilaminada",             category:"Fresas dentales", description:"Acabado y alisado de metal y resina" },
  { name:"Fresa de diamante grano grueso",  category:"Fresas dentales", description:"Desgaste inicial de estructuras duras" },
  { name:"Fresa de diamante grano fino",    category:"Fresas dentales", description:"Acabado y detallado de preparaciones" },
  { name:"Fresa de diamante grano extrafino",category:"Fresas dentales",description:"Pulido final de cerámicas y esmalte" },
  // Materiales
  { name:"Resina compuesta A1",        category:"Materiales de restauración", description:"Color A1 para restauraciones anteriores muy claras" },
  { name:"Resina compuesta A2",        category:"Materiales de restauración", description:"Color A2 estándar más utilizado" },
  { name:"Resina compuesta A3",        category:"Materiales de restauración", description:"Color A3 para dientes más oscuros" },
  { name:"Resina compuesta A3.5",      category:"Materiales de restauración", description:"Color A3.5 para oscurecimiento severo" },
  { name:"Resina compuesta B1",        category:"Materiales de restauración", description:"Color B1 muy claro con tono amarillo" },
  { name:"Resina compuesta B2",        category:"Materiales de restauración", description:"Color B2 para tonos amarillentos" },
  { name:"Ionómero de vidrio",         category:"Materiales de restauración", description:"Restauraciones temporales y cementación" },
  { name:"Cemento temporal",           category:"Materiales de restauración", description:"Cementación provisional de coronas" },
  { name:"Cemento definitivo",         category:"Materiales de restauración", description:"Cementación permanente de restauraciones" },
  { name:"Cemento para coronas",       category:"Materiales de restauración", description:"Cementación específica para coronas" },
  { name:"Cemento para brackets",      category:"Materiales de restauración", description:"Adhesión de brackets al esmalte" },
  { name:"Selladores",                 category:"Materiales de restauración", description:"Prevención de caries en fosas y fisuras" },
  { name:"Adhesivo dental",            category:"Materiales de restauración", description:"Unión de resina a estructura dental" },
  { name:"Ácido grabador",             category:"Materiales de restauración", description:"Acondicionamiento del esmalte" },
  { name:"Amalgama",                   category:"Materiales de restauración", description:"Restauraciones posteriores de alta resistencia" },
  { name:"Composite fluido",           category:"Materiales de restauración", description:"Restauraciones de baja tensión y sellado" },
  { name:"Composite bulk fill",        category:"Materiales de restauración", description:"Relleno en masa para cavidades profundas" },
  { name:"Material para provisionales",category:"Materiales de restauración", description:"Coronas y puentes temporales" },
  { name:"Acrílico autocurable",       category:"Materiales de restauración", description:"Provisionales y reparaciones de prótesis" },
  { name:"Acrílico termocurable",      category:"Materiales de restauración", description:"Prótesis removibles definitivas" },
  // Ortodoncia
  { name:"Brackets metálicos",    category:"Ortodoncia", description:"Brackets de acero inoxidable estándar" },
  { name:"Brackets cerámicos",    category:"Ortodoncia", description:"Brackets estéticos color diente" },
  { name:"Brackets autoligables", category:"Ortodoncia", description:"Sin ligaduras, menor fricción" },
  { name:"Tubos molares",         category:"Ortodoncia", description:"Para molares en tratamiento de ortodoncia" },
  { name:"Bandas",                category:"Ortodoncia", description:"Anillos metálicos para molares" },
  { name:"Arcos NiTi",            category:"Ortodoncia", description:"Arcos de níquel titanio, fase inicial" },
  { name:"Arcos acero",           category:"Ortodoncia", description:"Arcos de acero para fase de detallado" },
  { name:"Ligaduras metálicas",   category:"Ortodoncia", description:"Sujeción de arco al bracket" },
  { name:"Ligaduras elásticas",   category:"Ortodoncia", description:"Ligaduras de colores para brackets" },
  { name:"Cadenas elásticas",     category:"Ortodoncia", description:"Cierre de espacios en ortodoncia" },
  { name:"Retenedores",           category:"Ortodoncia", description:"Mantenimiento de resultados post-tratamiento" },
  { name:"Alambre ortodóntico",   category:"Ortodoncia", description:"Alambre de diferentes calibres" },
  { name:"Microtornillos",        category:"Ortodoncia", description:"Anclaje óseo temporal" },
  { name:"Cera ortodóntica",      category:"Ortodoncia", description:"Protección de mucosa ante brackets" },
  // Endodoncia
  { name:"Limas manuales",       category:"Endodoncia", description:"Instrumentación manual de conductos" },
  { name:"Limas rotatorias",     category:"Endodoncia", description:"Instrumentación mecanizada de conductos" },
  { name:"Conos de gutapercha",  category:"Endodoncia", description:"Obturación de conductos radiculares" },
  { name:"Sellador endodóntico", category:"Endodoncia", description:"Sello hermético del sistema de conductos" },
  { name:"Hipoclorito",          category:"Endodoncia", description:"Irrigación y desinfección de conductos" },
  { name:"EDTA",                 category:"Endodoncia", description:"Quelación para remoción de barro dentinario" },
  { name:"Clorhexidina",         category:"Endodoncia", description:"Desinfectante endodóntico" },
  { name:"Puntas de papel",      category:"Endodoncia", description:"Secado de conductos radiculares" },
  { name:"Puntas de gutapercha", category:"Endodoncia", description:"Obturación con técnica de condensación" },
  { name:"Motor endodóntico",    category:"Endodoncia", description:"Accionamiento de limas rotatorias" },
  { name:"Irrigadores",          category:"Endodoncia", description:"Irrigación controlada de conductos" },
  // Cirugía
  { name:"Suturas absorbibles",        category:"Cirugía e implantes", description:"Para tejidos internos, se reabsorben solas" },
  { name:"Suturas no absorbibles",     category:"Cirugía e implantes", description:"Para tejidos externos, se retiran a los 7 días" },
  { name:"Implantes dentales",         category:"Cirugía e implantes", description:"Titanio para rehabilitación de piezas perdidas" },
  { name:"Tornillos de cicatrización", category:"Cirugía e implantes", description:"Cierre de implante durante osteointegración" },
  { name:"Membranas",                  category:"Cirugía e implantes", description:"Regeneración ósea guiada" },
  { name:"Injerto óseo",               category:"Cirugía e implantes", description:"Relleno de defectos óseos" },
  { name:"Elevador de seno",           category:"Cirugía e implantes", description:"Para levantamiento de seno maxilar" },
  { name:"Kit de implantes",           category:"Cirugía e implantes", description:"Instrumental quirúrgico para implantes" },
  { name:"Piezas de mano quirúrgicas", category:"Cirugía e implantes", description:"Motor quirúrgico para implantología" },
  // Consumibles
  { name:"Guantes",                       category:"Consumibles", description:"Protección para el profesional y el paciente" },
  { name:"Cubrebocas",                    category:"Consumibles", description:"Barrera contra aerosoles y salpicaduras" },
  { name:"Gasas",                         category:"Consumibles", description:"Control de sangrado y limpieza del campo" },
  { name:"Algodón",                       category:"Consumibles", description:"Aislamiento y limpieza" },
  { name:"Rollos de algodón",             category:"Consumibles", description:"Aislamiento de cuadrantes" },
  { name:"Baberos",                       category:"Consumibles", description:"Protección de ropa del paciente" },
  { name:"Vasos desechables",             category:"Consumibles", description:"Para enjuagues del paciente" },
  { name:"Jeringas",                      category:"Consumibles", description:"Administración de medicamentos e irrigación" },
  { name:"Agujas cortas",                 category:"Consumibles", description:"Anestesia infiltrativa en paladar" },
  { name:"Agujas largas",                 category:"Consumibles", description:"Bloqueos mandibulares" },
  { name:"Servilletas",                   category:"Consumibles", description:"Uso general en el área de trabajo" },
  { name:"Bolsas de esterilización",      category:"Consumibles", description:"Empaque de instrumental para autoclave" },
  { name:"Indicadores de esterilización", category:"Consumibles", description:"Verifican el correcto proceso de esterilización" },
];

export default async function InventoryPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  // Auto-seed dental inventory if empty
  let items = await prisma.inventoryItem.findMany({
    where: { clinicId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  if (items.length === 0 && ((user.clinic as any).category === "DENTAL" || user.clinic.specialty === "Odontología")) {
    const existing = new Set(items.map((i: any) => i.name));
    const toCreate = DENTAL_SEED.filter(d => !existing.has(d.name));
    if (toCreate.length > 0) {
      await prisma.inventoryItem.createMany({
        data: toCreate.map(d => ({
          clinicId,
          name:        d.name,
          description: d.description,
          category:    d.category,
          emoji:       "📦",
          quantity:    0,
          minQuantity: 5,
          unit:        "pza",
        })),
        skipDuplicates: true,
      });
      items = await prisma.inventoryItem.findMany({
        where: { clinicId },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });
    }
  }

  return <InventoryClient initialItems={items as any} specialty={user.clinic.specialty} />;
}
