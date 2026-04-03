"use client";

import { useState, useMemo, useEffect } from "react";
import { Plus, Search, AlertTriangle, Package, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

// Real Unsplash image URLs per item (dental specific)
const ITEM_IMAGES: Record<string, string> = {
  // Instrumental básico
  "Espejo dental":           "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=80&h=80&fit=crop",
  "Explorador":              "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=80&h=80&fit=crop",
  "Pinza algodonera":        "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Sonda periodontal":       "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=80&h=80&fit=crop",
  "Excavador":               "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=80&h=80&fit=crop",
  "Curetas":                 "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=80&h=80&fit=crop",
  "Elevadores":              "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=80&h=80&fit=crop",
  "Fórceps de extracción":   "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=80&h=80&fit=crop",
  "Porta agujas":            "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=80&h=80&fit=crop",
  "Tijeras quirúrgicas":     "https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=80&h=80&fit=crop",
  "Separadores":             "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=80&h=80&fit=crop",
  "Retractores":             "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Espátulas para cemento":  "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=80&h=80&fit=crop",
  "Jeringa carpule":         "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=80&h=80&fit=crop",
  "Limas endodónticas":      "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=80&h=80&fit=crop",
  "Localizador de ápice":    "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=80&h=80&fit=crop",
  // Fresas — use drill/bur images
  "Fresa redonda de carburo": "https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=80&h=80&fit=crop",
  "Fresa redonda diamantada": "https://images.unsplash.com/photo-1612538498456-e861df91d4d0?w=80&h=80&fit=crop",
  "Fresa pera":               "https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=80&h=80&fit=crop",
  "Fresa cilíndrica":         "https://images.unsplash.com/photo-1612538498456-e861df91d4d0?w=80&h=80&fit=crop",
  "Fresa de acabado":         "https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=80&h=80&fit=crop",
  "Fresa de pulido":          "https://images.unsplash.com/photo-1612538498456-e861df91d4d0?w=80&h=80&fit=crop",
  "Fresa Gates":              "https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=80&h=80&fit=crop",
  "Fresa Peeso":              "https://images.unsplash.com/photo-1612538498456-e861df91d4d0?w=80&h=80&fit=crop",
  // Materiales
  "Resina compuesta A1":      "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Resina compuesta A2":      "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Resina compuesta A3":      "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Resina compuesta B2":      "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Ionómero de vidrio":       "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=80&h=80&fit=crop",
  "Cemento temporal":         "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=80&h=80&fit=crop",
  "Cemento definitivo":       "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=80&h=80&fit=crop",
  "Adhesivo dental":          "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Ácido grabador":           "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=80&h=80&fit=crop",
  "Composite fluido":         "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Composite bulk fill":      "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Acrílico autocurable":     "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=80&h=80&fit=crop",
  "Selladores":               "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  // Ortodoncia
  "Brackets metálicos":       "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=80&h=80&fit=crop",
  "Brackets cerámicos":       "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=80&h=80&fit=crop",
  "Brackets autoligables":    "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=80&h=80&fit=crop",
  "Arcos NiTi":               "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=80&h=80&fit=crop",
  "Arcos acero":              "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=80&h=80&fit=crop",
  "Microtornillos":           "https://images.unsplash.com/photo-1612538498456-e861df91d4d0?w=80&h=80&fit=crop",
  "Cera ortodóntica":         "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=80&h=80&fit=crop",
  // Endodoncia
  "Limas manuales":           "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=80&h=80&fit=crop",
  "Limas rotatorias":         "https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=80&h=80&fit=crop",
  "Conos de gutapercha":      "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=80&h=80&fit=crop",
  "Sellador endodóntico":     "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Hipoclorito":              "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=80&h=80&fit=crop",
  "EDTA":                     "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=80&h=80&fit=crop",
  "Clorhexidina":             "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=80&h=80&fit=crop",
  "Puntas de papel":          "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=80&h=80&fit=crop",
  "Motor endodóntico":        "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=80&h=80&fit=crop",
  // Cirugía
  "Suturas absorbibles":      "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=80&h=80&fit=crop",
  "Suturas no absorbibles":   "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=80&h=80&fit=crop",
  "Implantes dentales":       "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=80&h=80&fit=crop",
  "Tornillos de cicatrización":"https://images.unsplash.com/photo-1612538498456-e861df91d4d0?w=80&h=80&fit=crop",
  "Membranas":                "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=80&h=80&fit=crop",
  "Injerto óseo":             "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=80&h=80&fit=crop",
  "Kit de implantes":         "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=80&h=80&fit=crop",
  // Consumibles
  "Guantes":                  "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=80&h=80&fit=crop",
  "Cubrebocas":               "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=80&h=80&fit=crop",
  "Gasas":                    "https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=80&h=80&fit=crop",
  "Algodón":                  "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Rollos de algodón":        "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Baberos":                  "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=80&h=80&fit=crop",
  "Vasos desechables":        "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=80&h=80&fit=crop",
  "Jeringas":                 "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=80&h=80&fit=crop",
  "Agujas cortas":            "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=80&h=80&fit=crop",
  "Agujas largas":            "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?w=80&h=80&fit=crop",
  "Bolsas de esterilización": "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=80&h=80&fit=crop",
  "Indicadores de esterilización": "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=80&h=80&fit=crop",
};

// Category fallback images
const CATEGORY_IMAGES: Record<string, string> = {
  "Instrumental básico":        "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=80&h=80&fit=crop",
  "Fresas dentales":            "https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=80&h=80&fit=crop",
  "Materiales de restauración": "https://images.unsplash.com/photo-1584515933487-779824d29309?w=80&h=80&fit=crop",
  "Ortodoncia":                 "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?w=80&h=80&fit=crop",
  "Endodoncia":                 "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=80&h=80&fit=crop",
  "Cirugía e implantes":        "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=80&h=80&fit=crop",
  "Consumibles":                "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=80&h=80&fit=crop",
};

const DEFAULT_ITEMS: { name: string; category: string; description: string }[] = [
  { name:"Espejo dental",          category:"Instrumental básico",        description:"Para visualizar áreas de difícil acceso en la boca" },
  { name:"Explorador",             category:"Instrumental básico",        description:"Detecta caries y anomalías en el esmalte" },
  { name:"Pinza algodonera",       category:"Instrumental básico",        description:"Para colocar y retirar rollos de algodón" },
  { name:"Sonda periodontal",      category:"Instrumental básico",        description:"Mide la profundidad de bolsas periodontales" },
  { name:"Excavador",              category:"Instrumental básico",        description:"Elimina tejido cariado y material blando" },
  { name:"Curetas",                category:"Instrumental básico",        description:"Raspado y alisado radicular" },
  { name:"Elevadores",             category:"Instrumental básico",        description:"Para luxar piezas dentales antes de extracción" },
  { name:"Fórceps de extracción",  category:"Instrumental básico",        description:"Extracción de piezas dentales" },
  { name:"Porta agujas",           category:"Instrumental básico",        description:"Para suturar tejidos" },
  { name:"Tijeras quirúrgicas",    category:"Instrumental básico",        description:"Corte de suturas y tejidos blandos" },
  { name:"Separadores",            category:"Instrumental básico",        description:"Separar tejidos blandos durante procedimientos" },
  { name:"Retractores",            category:"Instrumental básico",        description:"Retracción de labios y mejillas" },
  { name:"Espátulas para cemento", category:"Instrumental básico",        description:"Mezcla y aplicación de cementos dentales" },
  { name:"Jeringa carpule",        category:"Instrumental básico",        description:"Aplicación de anestesia local" },
  { name:"Limas endodónticas",     category:"Instrumental básico",        description:"Limpieza y conformación de conductos radiculares" },
  { name:"Localizador de ápice",   category:"Instrumental básico",        description:"Determina la longitud del conducto radicular" },
  { name:"Instrumentos de ortodoncia", category:"Instrumental básico",   description:"Set de instrumentos para procedimientos de ortodoncia" },
  { name:"Fresa redonda de carburo",  category:"Fresas dentales",         description:"Remoción de tejido cariado" },
  { name:"Fresa redonda diamantada",  category:"Fresas dentales",         description:"Desgaste de estructuras dentales duras" },
  { name:"Fresa pera",                category:"Fresas dentales",         description:"Preparación de cavidades clase I y II" },
  { name:"Fresa cilíndrica",          category:"Fresas dentales",         description:"Preparación de paredes paralelas" },
  { name:"Fresa troncocónica",        category:"Fresas dentales",         description:"Preparación de cavidades en boca" },
  { name:"Fresa de fisura recta",     category:"Fresas dentales",         description:"Corte de esmalte y dentina" },
  { name:"Fresa de fisura cruzada",   category:"Fresas dentales",         description:"Retención en preparaciones cavitarias" },
  { name:"Fresa llama",               category:"Fresas dentales",         description:"Acabado de márgenes en coronas" },
  { name:"Fresa cono invertido",      category:"Fresas dentales",         description:"Preparación de cajas proximales" },
  { name:"Fresa balón",               category:"Fresas dentales",         description:"Cavidades de retención y terminación" },
  { name:"Fresa de acabado",          category:"Fresas dentales",         description:"Alisado superficial de restauraciones" },
  { name:"Fresa de pulido",           category:"Fresas dentales",         description:"Pulido final de resinas y acrílicos" },
  { name:"Fresa para zirconia",       category:"Fresas dentales",         description:"Desgaste de coronas de zirconia" },
  { name:"Fresa para metal",          category:"Fresas dentales",         description:"Ajuste de restauraciones metálicas" },
  { name:"Fresa para resina",         category:"Fresas dentales",         description:"Acabado de restauraciones en resina" },
  { name:"Fresa para acrílico",       category:"Fresas dentales",         description:"Ajuste de prótesis acrílicas" },
  { name:"Fresa quirúrgica larga",    category:"Fresas dentales",         description:"Cirugías de implantes y extracciones complejas" },
  { name:"Fresa quirúrgica de implantes", category:"Fresas dentales",    description:"Osteotomía para colocación de implantes" },
  { name:"Fresa Gates",               category:"Fresas dentales",         description:"Apertura cameral en endodoncia" },
  { name:"Fresa Peeso",               category:"Fresas dentales",         description:"Desgaste intracanal para postes" },
  { name:"Fresa endo-Z",              category:"Fresas dentales",         description:"Acceso endodóntico seguro" },
  { name:"Fresa multilaminada",       category:"Fresas dentales",         description:"Acabado y alisado de metal y resina" },
  { name:"Fresa de diamante grano grueso",   category:"Fresas dentales",  description:"Desgaste inicial de estructuras duras" },
  { name:"Fresa de diamante grano fino",     category:"Fresas dentales",  description:"Acabado y detallado de preparaciones" },
  { name:"Fresa de diamante grano extrafino",category:"Fresas dentales",  description:"Pulido final de cerámicas y esmalte" },
  { name:"Resina compuesta A1",   category:"Materiales de restauración",  description:"Color A1 para restauraciones anteriores muy claras" },
  { name:"Resina compuesta A2",   category:"Materiales de restauración",  description:"Color A2 estándar más utilizado" },
  { name:"Resina compuesta A3",   category:"Materiales de restauración",  description:"Color A3 para dientes más oscuros" },
  { name:"Resina compuesta A3.5", category:"Materiales de restauración",  description:"Color A3.5 para casos de oscurecimiento severo" },
  { name:"Resina compuesta B1",   category:"Materiales de restauración",  description:"Color B1 muy claro con tono amarillo" },
  { name:"Resina compuesta B2",   category:"Materiales de restauración",  description:"Color B2 para tonos amarillentos" },
  { name:"Ionómero de vidrio",    category:"Materiales de restauración",  description:"Restauraciones temporales y cementación" },
  { name:"Cemento temporal",      category:"Materiales de restauración",  description:"Cementación provisional de coronas" },
  { name:"Cemento definitivo",    category:"Materiales de restauración",  description:"Cementación permanente de restauraciones" },
  { name:"Cemento para coronas",  category:"Materiales de restauración",  description:"Cementación específica para coronas" },
  { name:"Cemento para brackets", category:"Materiales de restauración",  description:"Adhesión de brackets al esmalte" },
  { name:"Selladores",            category:"Materiales de restauración",  description:"Prevención de caries en fosas y fisuras" },
  { name:"Adhesivo dental",       category:"Materiales de restauración",  description:"Unión de resina a estructura dental" },
  { name:"Ácido grabador",        category:"Materiales de restauración",  description:"Acondicionamiento del esmalte" },
  { name:"Amalgama",              category:"Materiales de restauración",  description:"Restauraciones posteriores de alta resistencia" },
  { name:"Composite fluido",      category:"Materiales de restauración",  description:"Restauraciones de baja tensión y sellado" },
  { name:"Composite bulk fill",   category:"Materiales de restauración",  description:"Relleno en masa para cavidades profundas" },
  { name:"Material para provisionales", category:"Materiales de restauración", description:"Coronas y puentes temporales" },
  { name:"Acrílico autocurable",  category:"Materiales de restauración",  description:"Provisionales y reparaciones de prótesis" },
  { name:"Acrílico termocurable", category:"Materiales de restauración",  description:"Prótesis removibles definitivas" },
  { name:"Brackets metálicos",    category:"Ortodoncia",                  description:"Brackets de acero inoxidable estándar" },
  { name:"Brackets cerámicos",    category:"Ortodoncia",                  description:"Brackets estéticos color diente" },
  { name:"Brackets autoligables", category:"Ortodoncia",                  description:"Sin ligaduras, menor fricción" },
  { name:"Tubos molares",         category:"Ortodoncia",                  description:"Para molares en tratamiento de ortodoncia" },
  { name:"Bandas",                category:"Ortodoncia",                  description:"Anillos metálicos para molares" },
  { name:"Arcos NiTi",            category:"Ortodoncia",                  description:"Arcos de níquel titanio, fase inicial" },
  { name:"Arcos acero",           category:"Ortodoncia",                  description:"Arcos de acero para fase de detallado" },
  { name:"Ligaduras metálicas",   category:"Ortodoncia",                  description:"Sujeción de arco al bracket" },
  { name:"Ligaduras elásticas",   category:"Ortodoncia",                  description:"Ligaduras de colores para brackets" },
  { name:"Cadenas elásticas",     category:"Ortodoncia",                  description:"Cierre de espacios en ortodoncia" },
  { name:"Retenedores",           category:"Ortodoncia",                  description:"Mantenimiento de resultados post-tratamiento" },
  { name:"Alambre ortodóntico",   category:"Ortodoncia",                  description:"Alambre de diferentes calibres" },
  { name:"Microtornillos",        category:"Ortodoncia",                  description:"Anclaje óseo temporal" },
  { name:"Cera ortodóntica",      category:"Ortodoncia",                  description:"Protección de mucosa ante brackets" },
  { name:"Limas manuales",        category:"Endodoncia",                  description:"Instrumentación manual de conductos" },
  { name:"Limas rotatorias",      category:"Endodoncia",                  description:"Instrumentación mecanizada de conductos" },
  { name:"Conos de gutapercha",   category:"Endodoncia",                  description:"Obturación de conductos radiculares" },
  { name:"Sellador endodóntico",  category:"Endodoncia",                  description:"Sello hermético del sistema de conductos" },
  { name:"Hipoclorito",           category:"Endodoncia",                  description:"Irrigación y desinfección de conductos" },
  { name:"EDTA",                  category:"Endodoncia",                  description:"Quelación para remoción de barro dentinario" },
  { name:"Clorhexidina",          category:"Endodoncia",                  description:"Desinfectante endodóntico" },
  { name:"Puntas de papel",       category:"Endodoncia",                  description:"Secado de conductos radiculares" },
  { name:"Puntas de gutapercha",  category:"Endodoncia",                  description:"Obturación con técnica de condensación" },
  { name:"Motor endodóntico",     category:"Endodoncia",                  description:"Accionamiento de limas rotatorias" },
  { name:"Irrigadores",           category:"Endodoncia",                  description:"Irrigación controlada de conductos" },
  { name:"Suturas absorbibles",   category:"Cirugía e implantes",         description:"Para tejidos internos, se reabsorben solas" },
  { name:"Suturas no absorbibles",category:"Cirugía e implantes",         description:"Para tejidos externos, se retiran a los 7 días" },
  { name:"Implantes dentales",    category:"Cirugía e implantes",         description:"Titanio para rehabilitación de piezas perdidas" },
  { name:"Tornillos de cicatrización", category:"Cirugía e implantes",   description:"Cierre de implante durante osteointegración" },
  { name:"Membranas",             category:"Cirugía e implantes",         description:"Regeneración ósea guiada" },
  { name:"Injerto óseo",          category:"Cirugía e implantes",         description:"Relleno de defectos óseos" },
  { name:"Elevador de seno",      category:"Cirugía e implantes",         description:"Para levantamiento de seno maxilar" },
  { name:"Kit de implantes",      category:"Cirugía e implantes",         description:"Instrumental quirúrgico para implantes" },
  { name:"Piezas de mano quirúrgicas", category:"Cirugía e implantes",   description:"Motor quirúrgico para implantología" },
  { name:"Guantes",               category:"Consumibles",                 description:"Protección para el profesional y el paciente" },
  { name:"Cubrebocas",            category:"Consumibles",                 description:"Barrera contra aerosoles y salpicaduras" },
  { name:"Gasas",                 category:"Consumibles",                 description:"Control de sangrado y limpieza del campo" },
  { name:"Algodón",               category:"Consumibles",                 description:"Aislamiento y limpieza" },
  { name:"Rollos de algodón",     category:"Consumibles",                 description:"Aislamiento de cuadrantes" },
  { name:"Baberos",               category:"Consumibles",                 description:"Protección de ropa del paciente" },
  { name:"Vasos desechables",     category:"Consumibles",                 description:"Para enjuagues del paciente" },
  { name:"Jeringas",              category:"Consumibles",                 description:"Administración de medicamentos e irrigación" },
  { name:"Agujas cortas",         category:"Consumibles",                 description:"Anestesia infiltrativa en paladar" },
  { name:"Agujas largas",         category:"Consumibles",                 description:"Bloqueos mandibulares" },
  { name:"Servilletas",           category:"Consumibles",                 description:"Uso general en el área de trabajo" },
  { name:"Bolsas de esterilización", category:"Consumibles",             description:"Empaque de instrumental para autoclave" },
  { name:"Indicadores de esterilización", category:"Consumibles",        description:"Verifican el correcto proceso de esterilización" },
];

const CATEGORY_ICONS: Record<string, string> = {
  "Instrumental básico":        "🔧",
  "Fresas dentales":            "⚙️",
  "Materiales de restauración": "🧴",
  "Ortodoncia":                 "📐",
  "Endodoncia":                 "🔬",
  "Cirugía e implantes":        "🏥",
  "Consumibles":                "📦",
};

interface Item {
  id: string; name: string; description: string | null;
  category: string; emoji: string; quantity: number;
  minQuantity: number; unit: string; price: number | null;
}

function ItemImage({ name, category }: { name: string; category: string }) {
  const [error, setError] = useState(false);
  const src = ITEM_IMAGES[name] || CATEGORY_IMAGES[category];
  if (!src || error) {
    return (
      <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 text-xl">
        {CATEGORY_ICONS[category] ?? "📦"}
      </div>
    );
  }
  return (
    <img src={src} alt={name} onError={() => setError(true)}
      className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-border" />
  );
}

export function InventoryClient({ initialItems, specialty }: { initialItems: Item[]; specialty: string }) {
  const [items,      setItems]      = useState<Item[]>(initialItems);
  const [search,     setSearch]     = useState("");
  const [collapsed,  setCollapsed]  = useState<Record<string, boolean>>({});
  const [showAdd,    setShowAdd]    = useState(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [seeding,    setSeeding]    = useState(false);
  const [newItem,    setNewItem]    = useState({ name:"", description:"", category:"Instrumental básico", quantity:0, minQuantity:5, unit:"pza", price:"" });

  // Auto-seed on first load if empty and dental
  useEffect(() => {
    if (initialItems.length === 0 && specialty === "Odontología") {
      seedInventory(true);
    }
  }, []);

  const filtered = useMemo(() => {
    if (!search) return items;
    return items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.category.toLowerCase().includes(search.toLowerCase()));
  }, [items, search]);

  const byCategory = useMemo(() => {
    const map: Record<string, Item[]> = {};
    for (const item of filtered) {
      if (!map[item.category]) map[item.category] = [];
      map[item.category].push(item);
    }
    return map;
  }, [filtered]);

  const lowStock = items.filter(i => i.quantity > 0 && i.quantity <= i.minQuantity);
  const outStock  = items.filter(i => i.quantity === 0);

  async function seedInventory(silent = false) {
    if (!silent && !confirm(`¿Cargar los ${DEFAULT_ITEMS.length} artículos del inventario dental?`)) return;
    setSeeding(true);
    let added = 0;
    for (const item of DEFAULT_ITEMS) {
      if (items.some(i => i.name === item.name)) continue;
      try {
        const res = await fetch("/api/inventory", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...item, emoji: "📦", quantity: 0, minQuantity: 5, unit: "pza" }),
        });
        const created = await res.json();
        setItems(prev => [...prev, created]);
        added++;
      } catch {}
    }
    setSeeding(false);
    if (!silent || added > 0) toast.success(`✅ ${added} artículos cargados`);
  }

  async function changeQty(id: string, delta: number) {
    setLoadingIds(s => new Set(s).add(id));
    try {
      const res = await fetch(`/api/inventory/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: delta }),
      });
      const updated = await res.json();
      setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: updated.quantity } : i));
    } catch { toast.error("Error"); } finally {
      setLoadingIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function addItem() {
    if (!newItem.name) { toast.error("El nombre es requerido"); return; }
    try {
      const res = await fetch("/api/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newItem, emoji: "📦", price: newItem.price ? parseFloat(newItem.price) : null }),
      });
      const created = await res.json();
      setItems(prev => [...prev, created]);
      setShowAdd(false);
      setNewItem({ name:"", description:"", category:"Instrumental básico", quantity:0, minQuantity:5, unit:"pza", price:"" });
      toast.success("Artículo agregado");
    } catch { toast.error("Error"); }
  }

  async function deleteItem(id: string) {
    if (!confirm("¿Eliminar este artículo?")) return;
    await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success("Eliminado");
  }

  const categories = Object.keys(CATEGORY_ICONS);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold">📦 Inventario</h1>
          <p className="text-sm text-muted-foreground">{items.length} artículos · {outStock.length} sin stock · {lowStock.length} stock bajo</p>
        </div>
        <div className="flex gap-2">
          {specialty === "Odontología" && items.length > 0 && (
            <Button variant="outline" onClick={() => seedInventory(false)} disabled={seeding} size="sm">
              {seeding ? "Cargando…" : "⚡ Recargar dental"}
            </Button>
          )}
          <Button onClick={() => setShowAdd(true)} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> Agregar artículo
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {(lowStock.length > 0 || outStock.length > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          {outStock.length > 0 && (
            <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-rose-700 dark:text-rose-400">{outStock.length} sin stock</div>
                <div className="text-xs text-rose-500 truncate">{outStock.slice(0,3).map(i=>i.name).join(", ")}</div>
              </div>
            </div>
          )}
          {lowStock.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <div>
                <div className="text-xs font-bold text-amber-700 dark:text-amber-400">{lowStock.length} stock bajo</div>
                <div className="text-xs text-amber-500 truncate">{lowStock.slice(0,3).map(i=>i.name).join(", ")}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input className="flex h-10 w-full rounded-xl border border-border bg-white dark:bg-slate-900 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="Buscar artículo…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Loading state */}
      {seeding && items.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-2xl mb-3 animate-spin inline-block">⚙️</div>
          <div className="font-semibold">Cargando inventario dental…</div>
          <p className="text-sm mt-1">Esto solo tarda unos segundos</p>
        </div>
      )}

      {/* Categories */}
      <div className="space-y-3">
        {Object.entries(byCategory).map(([cat, catItems]) => {
          const icon      = CATEGORY_ICONS[cat] ?? "📦";
          const isCollapsed = collapsed[cat];
          const catLow    = catItems.filter(i => i.quantity <= i.minQuantity).length;
          return (
            <div key={cat} className="bg-white dark:bg-slate-900 border border-border rounded-xl overflow-hidden shadow-card">
              <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
                onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}>
                <span className="text-lg">{icon}</span>
                <span className="font-bold text-sm flex-1 text-left">{cat}</span>
                <span className="text-xs text-muted-foreground">{catItems.length} artículos</span>
                {catLow > 0 && <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 px-2 py-0.5 rounded-full">{catLow} bajo stock</span>}
                {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
              </button>

              {!isCollapsed && (
                <div className="border-t border-border divide-y divide-border/40">
                  {catItems.map(item => {
                    const isLow  = item.quantity > 0 && item.quantity <= item.minQuantity;
                    const isOut  = item.quantity === 0;
                    const isLoad = loadingIds.has(item.id);
                    return (
                      <div key={item.id} className={`flex items-center gap-3 px-4 py-3 group transition-colors ${isOut ? "bg-rose-50/40 dark:bg-rose-950/20" : isLow ? "bg-amber-50/40 dark:bg-amber-950/20" : "hover:bg-muted/10"}`}>
                        <ItemImage name={item.name} category={item.category} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{item.name}</div>
                          {item.description && <div className="text-xs text-muted-foreground line-clamp-1">{item.description}</div>}
                        </div>
                        {/* Quantity */}
                        <div className="flex-shrink-0 text-center w-14">
                          <div className={`text-xl font-extrabold leading-none ${isOut ? "text-rose-600" : isLow ? "text-amber-600" : "text-foreground"}`}>{item.quantity}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{item.unit}</div>
                        </div>
                        {/* +/- buttons */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button disabled={isLoad} onClick={() => changeQty(item.id, -1)}
                            className="w-9 h-9 rounded-xl bg-rose-500 hover:bg-rose-600 active:scale-95 text-white font-bold text-xl flex items-center justify-center transition-all disabled:opacity-50 shadow-sm">
                            −
                          </button>
                          <button disabled={isLoad} onClick={() => changeQty(item.id, 1)}
                            className="w-9 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-xl flex items-center justify-center transition-all disabled:opacity-50 shadow-sm">
                            +
                          </button>
                          <button onClick={() => deleteItem(item.id)}
                            className="w-7 h-7 rounded-lg text-muted-foreground hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center ml-1">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-bold">Agregar artículo</h2>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Nombre del artículo *</Label>
                <input className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Resina A2" value={newItem.name} onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Descripción — para qué sirve</Label>
                <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                  placeholder="Ej: Para restauraciones del sector anterior"
                  value={newItem.description} onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Categoría</Label>
                <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                  value={newItem.category} onChange={e => setNewItem(n => ({ ...n, category: e.target.value }))}>
                  {categories.map(c => <option key={c}>{c}</option>)}
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Cantidad</Label>
                  <input type="number" min="0" className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                    value={newItem.quantity} onChange={e => setNewItem(n => ({ ...n, quantity: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alerta si baja de</Label>
                  <input type="number" min="0" className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                    value={newItem.minQuantity} onChange={e => setNewItem(n => ({ ...n, minQuantity: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Unidad</Label>
                  <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                    value={newItem.unit} onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))}>
                    {["pza","cja","frasco","rollo","par","paquete","kit","ml","mg","uni"].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1">Cancelar</Button>
              <Button onClick={addItem} className="flex-1">✅ Agregar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
