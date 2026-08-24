import type { ProjectDocument } from '../domain'

/**
 * ---------------------------------------------------------------------------
 * Generación del `imsmanifest.xml` (Milestone 3, fase 2)
 * ---------------------------------------------------------------------------
 *
 * `buildScormManifest` es una función PURA (nada de disco, nada de Tauri):
 * recibe el documento y devuelve el manifiesto SCORM 2004 4ª edición mínimo
 * que describe el `index.html` autónomo (`buildHtmlBundle`) como único SCO
 * del paquete.
 *
 * SCORM 2004 4ª edición no exige modelar secuenciación (`imsss`/`adlseq`/
 * `adlnav`) ni `cmi.interactions` para un paquete de un único SCO sin reglas
 * de navegación entre SCOs: con los namespaces base de content packaging
 * (`imscp_v1p1`) más las extensiones ADL de content aggregation
 * (`adlcp_v1p3`) es un manifiesto válido y lo acepta cualquier LMS conforme
 * (Moodle incluido) — no se declaran `adlseq_v1p3`/`adlnav_v1p3`/`imsss`
 * porque el documento no usa ningún elemento de esos namespaces.
 *
 * El manifiesto NO incluye `imsmanifest.xml` en la lista de `<file>` del
 * `<resource>`: esa lista describe los archivos que forman el CONTENIDO del
 * recurso (lo que hay que servir para reproducirlo), no el propio
 * manifiesto que lo declara — ningún LMS habitual (incluido Moodle) lo
 * exige, y así lo confirma el propio esquema `adlcp_v1p3`.
 */

/** Namespace/esquema estándar de un `imsmanifest.xml` de SCORM 2004 4ª
 *  edición (content packaging base + extensiones ADL de content
 *  aggregation; sin secuenciación explícita, ver cabecera del archivo). */
const SCHEMA_LOCATION =
  'http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd ' +
  'http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd'

const ORGANIZATION_ID = 'brunch-organization'
const ITEM_ID = 'brunch-item-1'
const RESOURCE_ID = 'brunch-resource-1'

/** Escapa texto para insertarlo como contenido de un elemento XML. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Convierte `raw` en un identificador XML válido (tipo `ID`: debe empezar
 * por una letra o `_`, y solo puede contener letras, dígitos, `-`, `_` y
 * `.`). `project.metadata.id` es un UUID, que puede empezar por un dígito
 * (inválido como primer carácter de un `ID`), así que se antepone un
 * prefijo fijo en vez de reutilizarlo desnudo.
 */
function sanitizeXmlId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, '-')
  const withValidStart = /^[A-Za-z_]/.test(cleaned) ? cleaned : `id-${cleaned}`
  return withValidStart.length > 0 ? withValidStart : 'brunch-experience'
}

/**
 * Construye el `imsmanifest.xml` de `project`: un único `organization`/`item`
 * que referencia un único `resource` de tipo `webcontent`/`sco` con
 * `href="index.html"`.
 *
 * Determinista: el mismo documento produce siempre el mismo XML (sin fecha
 * de exportación ni nada variable), igual criterio que `buildHtmlBundle`.
 */
export function buildScormManifest(project: ProjectDocument): string {
  const identifier = sanitizeXmlId(project.metadata.id)
  const title = project.metadata.name.trim() || 'Experiencia interactiva'
  const escapedTitle = escapeXml(title)

  // El `<manifest>` no lleva atributo `version`: ese atributo (opcional en
  // IMS CP) versiona el propio paquete de contenido, no el estándar SCORM —
  // la versión de SCORM la declara `<schemaversion>` dentro de `<metadata>`.
  // Se omite para no dejar un valor sin significado real.
  return `<?xml version="1.0" standalone="no"?>
<manifest identifier="${identifier}"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="${SCHEMA_LOCATION}">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="${ORGANIZATION_ID}">
    <organization identifier="${ORGANIZATION_ID}">
      <title>${escapedTitle}</title>
      <item identifier="${ITEM_ID}" identifierref="${RESOURCE_ID}">
        <title>${escapedTitle}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${RESOURCE_ID}" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
`
}
