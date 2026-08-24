import type { ProjectDocument } from '../domain'

/**
 * ---------------------------------------------------------------------------
 * Generación del `imsmanifest.xml` (Milestone 3, fase 2)
 * ---------------------------------------------------------------------------
 *
 * `buildScormManifest` es una función PURA (nada de disco, nada de Tauri):
 * recibe el documento y devuelve el manifiesto SCORM 1.2 mínimo que describe
 * el `index.html` autónomo (`buildHtmlBundle`) como único SCO del paquete.
 *
 * SCORM 1.2 se eligió por ser la versión más simple y la más compatible con
 * LMS reales (incluido Moodle) — no hace falta modelar secuenciación ni
 * `cmi.interactions`, solo un SCO de contenido con estado
 * completado/puntuación.
 *
 * El manifiesto NO incluye `imsmanifest.xml` en la lista de `<file>` del
 * `<resource>`: esa lista describe los archivos que forman el CONTENIDO del
 * recurso (lo que hay que servir para reproducirlo), no el propio
 * manifiesto que lo declara — ningún LMS habitual (incluido Moodle) lo
 * exige, y así lo confirma el propio esquema `adlcp_rootv1p2`.
 */

/** Namespace/esquema estándar de un `imsmanifest.xml` de SCORM 1.2. */
const SCHEMA_LOCATION =
  'http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd ' +
  'http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd ' +
  'http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd'

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

  return `<?xml version="1.0" standalone="no"?>
<manifest identifier="${identifier}" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="${SCHEMA_LOCATION}">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
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
    <resource identifier="${RESOURCE_ID}" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
`
}
