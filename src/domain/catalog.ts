/**
 * Catálogo de ciclos formativos y sus asignaturas, usado por la diapositiva
 * de Inicio para los desplegables en cascada (ciclo -> asignaturas de ese
 * ciclo). Datos reales proporcionados por Content Factory - iLERNA (26 ago
 * 2026) — NO son datos de ejemplo. `id` de cada asignatura es su código
 * corto ya usado internamente (p.ej. `TR_ENGL_GM`); `id` de cada ciclo es un
 * slug derivado de su nombre completo, generado una sola vez a partir del
 * nombre.
 */
export interface CatalogAsignatura {
  id: string
  name: string
}

export interface CatalogCiclo {
  id: string
  name: string
  asignaturas: CatalogAsignatura[]
}

/**
 * Nombre de un ciclo para la SALIDA (HTML/SCORM/revisión profes y el
 * reproductor, tanto el "▶ Probar" de dentro de la app como el exportado):
 * sin el prefijo interno de código antes del primer " - " (p.ej. "AC - " en
 * `'AC - Actividades comerciales'`, o "ADAF - " en
 * `'ADAF - Asistencia a la Dirección / Administración y Finanzas'`), que no
 * significa nada para quien hace el caso práctico.
 *
 * En el espacio de trabajo (Inspector, buscador, tarjeta del canvas) se
 * sigue usando `ciclo.name` tal cual, CON el prefijo — ahí sí es útil para
 * el equipo de Content Factory. Si el nombre no tiene ese prefijo (p.ej. los
 * troncales, `'TRONCAL ESP'`), se devuelve sin tocar.
 */
export function cicloOutputName(name: string): string {
  const separatorIndex = name.indexOf(' - ')
  return separatorIndex === -1 ? name : name.slice(separatorIndex + 3)
}

/**
 * Nombre de una asignatura para el ESPACIO DE TRABAJO (selector de
 * Asignatura del Inspector, resumen de la tarjeta del canvas): el nombre
 * legible seguido de su código de módulo entre paréntesis (el propio `id`
 * del catálogo, p.ej. `'Atención al paciente (IDMN_M01)'`) — útil para el
 * equipo de Content Factory, que identifica cada asignatura por ese código.
 *
 * En la SALIDA (HTML/SCORM/revisión profes/reproductor) se sigue usando
 * `asignatura.name` tal cual, sin el código: no significa nada para quien
 * hace el caso práctico.
 */
export function asignaturaWorkspaceName(asignatura: CatalogAsignatura): string {
  return `${asignatura.name} (${asignatura.id})`
}

export const CICLOS: CatalogCiclo[] = [
  {
    id: 'troncal_esp',
    name: 'TRONCAL ESP',
    asignaturas: [
      { id: 'TR_ENGL_GM', name: 'English GM' },
      { id: 'TR_ENGL_GS', name: 'English GS' },
      { id: 'TR_DIG_GM', name: 'Digitalización aplicada a los sectores productivos_GM' },
      { id: 'TR_DIG_GS', name: 'Digitalización aplicada a los sectores productivos_GS' },
      { id: 'TR_SOST', name: 'Sostenibilidad aplicada al sistema productivo' },
      { id: 'TR_IPEI', name: 'Itinerario personal para la empleabilidad I' },
      { id: 'TR_IPEII', name: 'Itinerario personal para la empleabilidad II' },
      { id: 'TR_OPT01', name: 'Módulo optativo 01 (Ofimática)' },
      { id: 'TR_OPT02', name: 'Módulo optativo 02 (Hojas de cálculo)' },
      { id: 'TR_OPT03', name: 'Módulo optativo 03 (Inteligencia artificial)' },
      { id: 'TR_OPT04', name: 'Módulo optativo 04 (Habilidades comunicativas en lengua extranjera profesional)' },
      { id: 'TR_OPT05', name: 'Módulo optativo 05 (Ampliación de lengua extranjera profesional)' },
      { id: 'TR_OPT06', name: 'Módulo optativo 06 (Diálogo Social)' },
      { id: 'TR_OFI', name: 'Ofimática' },
      { id: 'TR_AUX', name: 'Primeros auxilios' },
      { id: 'TR_FR', name: 'Francés' },
      { id: 'TR_IT', name: 'Italiano' },
      { id: 'TR_FOL', name: 'Formación y orientación laboral' },
      { id: 'TR_EIE', name: 'Empresa e iniciativa emprendedora' },
    ],
  },
  {
    id: 'troncal_it',
    name: 'TRONCAL IT',
    asignaturas: [
      { id: 'TR_IT_DIG_GS', name: 'Digitalizzazione applicata ai settori produttivi' },
      { id: 'TR_IT_SOST', name: 'Sostenibilità applicata al sistema produttivo' },
      { id: 'TR_IT_IPEI', name: 'Itinerario personale per l\'occupazione I' },
      { id: 'TR_IT_IPEII', name: 'Itinerario personale per l\'occupazione II' },
      { id: 'TR_IT_OPT01', name: 'Modulo professionale opzionale I' },
      { id: 'TR_IT_AUX', name: 'Primo soccorso (AUX en italiano)' },
      { id: 'TR_IT_ENGL_GS', name: 'English IT GS' },
      { id: 'TR_IT_FOL', name: 'FOL en italiano (Formazione e orientamento sul lavoro)' },
      { id: 'TR_IT_EIE', name: 'EIE en italiano (Mercato del lavoro e iniziativa imprenditoriale)' },
    ],
  },
  {
    id: 'troncal_fr',
    name: 'TRONCAL FR',
    asignaturas: [
      { id: 'TR_FR_DIG_GS', name: 'Digitalisation appliquée aux secteurs productifs' },
      { id: 'TR_FR_SOST', name: 'Durabilité appliquée au système de production' },
      { id: 'TR_FR_IPEI', name: 'Itinéraire personnel pour l\'employabilité I' },
      { id: 'TR_FR_IPEII', name: 'Itinéraire personnel pour l\'employabilité II' },
      { id: 'TR_FR_OPT01', name: 'Module professionnel optionnel I' },
      { id: 'TR_FR_ENGL_GS', name: 'English FR GS' },
      { id: 'TR_FR_FOL', name: 'FOL en francés' },
      { id: 'TR_FR_EIE', name: 'EIE en francés' },
    ],
  },
  {
    id: 'afis_acondicionamiento_fisico',
    name: 'AFIS - Acondicionamiento físico',
    asignaturas: [
      { id: 'AFIS_M03', name: 'Fitness en sala de entrenamiento polivalente' },
      { id: 'AFIS_M04', name: 'Actividades básicas de acondicionamiento físico con soporte musical' },
      { id: 'AFIS_M05', name: 'Actividades especializadas de acondicionamiento físico con soporte musical' },
      { id: 'AFIS_M06', name: 'Acondicionamiento físico en el agua' },
      { id: 'AFIS_M07', name: 'Técnicas de hidrocinesia' },
      { id: 'AFIS_M08', name: 'Control postural, bienestar y mantenimiento funcional' },
      { id: 'AFIS_M12', name: 'Didáctica aplicada al acondicionamiento físico (solo Aragón)' },
    ],
  },
  {
    id: 'ac_actividades_comerciales',
    name: 'AC - Actividades comerciales',
    asignaturas: [
      { id: 'AC_M02', name: 'Marketing en la actividad comercial' },
      { id: 'AC_M03', name: 'Gestión de compras' },
      { id: 'AC_M04', name: 'Dinamización del punto de venta' },
      { id: 'AC_M05', name: 'Procesos de venta' },
      { id: 'AC_M06', name: 'Aplicaciones informáticas para el comercio' },
      { id: 'AC_M08', name: 'Gestión de un pequeño comercio' },
      { id: 'AC_M09', name: 'Técnicas de almacén' },
      { id: 'AC_M10', name: 'Venta técnica' },
      { id: 'AC_M11', name: 'Servicios de atención comercial' },
      { id: 'AC_M12', name: 'Comercio electrónico' },
    ],
  },
  {
    id: 'asir_actividades_comerciales',
    name: 'ASIR - Actividades comerciales',
    asignaturas: [
      { id: 'ASIR_M02', name: 'Fundamentos de hardware' },
      { id: 'ASIR_M03', name: 'Gestión de bases de datos' },
      { id: 'ASIR_M04A', name: 'Implantación de sistemas operativos - A' },
      { id: 'ASIR_M04B', name: 'Implantación de sistemas operativos - B' },
      { id: 'ASIR_M06', name: 'Planificación y administración de redes' },
      { id: 'ASIR_M07', name: 'Administración de sistemas gestores de bases de datos' },
      { id: 'ASIR_M08', name: 'Administración de sistemas operativos' },
      { id: 'ASIR_M10', name: 'Implantación de aplicaciones web' },
      { id: 'ASIR_M12', name: 'Seguridad y alta disponibilidad' },
      { id: 'ASIR_M13', name: 'Servicios de red e internet' },
    ],
  },
  {
    id: 'anat_anatomia_patologica_y_citodiagnostico',
    name: 'ANAT - Anatomía Patológica y Citodiagnóstico',
    asignaturas: [
      { id: 'ANAT_M07', name: 'Necropsias' },
      { id: 'ANAT_M08', name: 'Procesamiento citológico y tisular' },
      { id: 'ANAT_M09', name: 'Citología ginecológica' },
      { id: 'ANAT_M10', name: 'Citología general' },
    ],
  },
  {
    id: '3d_animaciones_3d_juegos_y_entornos_interactivos',
    name: '3D - Animaciones 3D, Juegos y Entornos Interactivos',
    asignaturas: [
      { id: '3D_M01', name: 'Proyectos de animación audiovisual 2D y 3D' },
      { id: '3D_M02A', name: 'Diseño, dibujo y modelado para animación A' },
      { id: '3D_M02B', name: 'Diseño, dibujo y modelado para animación B' },
      { id: '3D_M03A', name: 'Animación de elementos 2D y 3D A' },
      { id: '3D_M03B', name: 'Animación de elementos 2D y 3D B' },
      { id: '3D_M04', name: 'Color, iluminación y acabados 2D y 3D' },
      { id: '3D_M05', name: 'Proyectos de juegos y entornos interactivos' },
      { id: '3D_M06', name: 'Realización de proyectos multimedia interactivos' },
      { id: '3D_M07A', name: 'Desarrollo de entornos interactivos multidispositivo y videojuegos A' },
      { id: '3D_M07B', name: 'Desarrollo de entornos interactivos multidispositivo y videojuegos B' },
      { id: '3D_M08', name: 'Realización del montaje y posproducción de audiovisuales' },
    ],
  },
  {
    id: 'adaf_asistencia_a_la_direccion_administracion_y_finanzas',
    name: 'ADAF - Asistencia a la Dirección / Administración y Finanzas',
    asignaturas: [
      { id: 'ADAF_M01', name: 'Comunicación y atención al cliente' },
      { id: 'ADAF_M02', name: 'Gestión de la documentación jurídica y empresarial' },
      { id: 'ADAF_M03A', name: 'Proceso integral de la actividad comercial A' },
      { id: 'ADAF_M03B', name: 'Proceso integral de la actividad comercial B' },
      { id: 'ADAF_M04', name: 'Recursos humanos y responsabilidad social corporativa' },
      { id: 'AD_M08', name: 'Protocolo empresarial' },
      { id: 'AD_M09', name: 'Organización de eventos empresariales' },
      { id: 'AD_M10', name: 'Gestión avanzada de la información' },
      { id: 'AF_M07', name: 'Gestión de recursos humanos' },
      { id: 'AF_M08', name: 'Gestión financiera' },
      { id: 'AF_M09', name: 'Contabilidad y fiscalidad' },
      { id: 'AF_M10', name: 'Gestión logística y comercial' },
      { id: 'AF_M11', name: 'Simulación empresarial' },
    ],
  },
  {
    id: 'apd_atencion_a_personas_en_situacion_de_dependencia',
    name: 'APD - Atención a personas en situación de dependencia',
    asignaturas: [
      { id: 'APD_M01', name: 'Apoyo domiciliario' },
      { id: 'APD_M02', name: 'Atención higiénica' },
      { id: 'APD_M03', name: 'Atención y apoyo psicosocial' },
      { id: 'APD_M04', name: 'Características y necesidades de las personas en situación de dependencia' },
      { id: 'APD_M06', name: 'Organización de la atención a las personas en situación de dependencia' },
      { id: 'APD_M08', name: 'Apoyo a la comunicación' },
      { id: 'APD_M09', name: 'Atención sanitaria' },
      { id: 'APD_M10', name: 'Destrezas sociales' },
      { id: 'APD_M13', name: 'Teleasistencia' },
    ],
  },
  {
    id: 'aud_audiologia_protesica_esp',
    name: 'AUD - Audiología Protésica (ESP)',
    asignaturas: [
      { id: 'AUD_M01', name: 'Características anatomosensoriales auditivas' },
      { id: 'AUD_M02', name: 'Tecnología electrónica en audioprótesis' },
      { id: 'AUD_M03', name: 'Acústica y elementos de protección sonora' },
      { id: 'AUD_M04', name: 'Elaboración de moldes y protectores auditivos' },
      { id: 'AUD_M05', name: 'Elección y adaptación de prótesis auditivas' },
      { id: 'AUD_M06', name: 'Atención al hipoacúsico' },
      { id: 'AUD_M07', name: 'Audición y comunicación verbal' },
      { id: 'AUD_M08', name: 'Gestión y servicios posventa del establecimiento de audioprótesis' },
    ],
  },
  {
    id: 'aud_fr_audiologie_prothetique_fr',
    name: 'AUD_FR - Audiologie prothétique (FR)',
    asignaturas: [
      { id: 'AUD_FR_M01', name: 'Caractéristiques anatomico-sensorielles auditives' },
      { id: 'AUD_FR_M02', name: 'Technologie électronique des audioprothèses' },
      { id: 'AUD_FR_M03', name: 'Acoustique et éléments de protection sonore' },
      { id: 'AUD_FR_M04', name: 'Élaboration d\'embouts et de protecteurs auditifs' },
      { id: 'AUD_FR_M05', name: 'Choix et adaptation des prothèses auditives' },
      { id: 'AUD_FR_M06', name: 'Prise en charge de l\'hypoacousie' },
      { id: 'AUD_FR_M07', name: 'Audition et communication verbale' },
      { id: 'AUD_FR_M08', name: 'Gestion et services après-vente de l\'établissement d\'audioprothèses' },
    ],
  },
  {
    id: 'cae_cuidados_auxiliares_de_enfermeria',
    name: 'CAE - Cuidados Auxiliares de Enfermería',
    asignaturas: [
      { id: 'CAE_C01', name: 'Operaciones administrativas y documentación sanitaria' },
      { id: 'CAE_C02', name: 'El ser humano ante la enfermedad' },
      { id: 'CAE_C03', name: 'Bienestar del paciente' },
      { id: 'CAE_C04A', name: 'Cuidados básicos de enfermería aplicados a las necesidades del ser humano A' },
      { id: 'CAE_C04B', name: 'Cuidados básicos de enfermería aplicados a las necesidades del ser humano B' },
      { id: 'CAE_C05', name: 'Primeros auxilios' },
      { id: 'CAE_C06', name: 'Higiene del medio hospitalario y limpieza del material' },
      { id: 'CAE_C07', name: 'Apoyo psicológico al paciente/cliente' },
      { id: 'CAE_C08', name: 'Educación para la salud' },
      { id: 'CAE_C09', name: 'Técnicas de ayuda odontológica/estomatológica' },
      { id: 'CAE_C10', name: 'RET' },
      { id: 'CAE_C11', name: 'FOL LOGSE' },
    ],
  },
  {
    id: 'com_comercio_internacional',
    name: 'COM - Comercio Internacional',
    asignaturas: [
      { id: 'COM_M02', name: 'Financiación internacional' },
      { id: 'COM_M03', name: 'Medios de pago internacionales' },
      { id: 'COM_M07', name: 'Marketing internacional' },
      { id: 'COM_M08', name: 'Sistema de información de mercados' },
      { id: 'COM_M09', name: 'Negociación internacional' },
      { id: 'COM_M10', name: 'Comercio digital internacional' },
    ],
  },
  {
    id: 'dax_desarrollo_de_aplicaciones_multiplataforma_desarrollo_de_aplicaciones_web',
    name: 'DAX - Desarrollo de Aplicaciones Multiplataforma / Desarrollo de Aplicaciones Web',
    asignaturas: [
      { id: 'DAX_M01', name: 'Sistemas informáticos' },
      { id: 'DAX_M02A', name: 'Bases de datos A' },
      { id: 'DAX_M02B', name: 'Bases de datos B' },
      { id: 'DAX_M03A', name: 'Programación A' },
      { id: 'DAX_M03B', name: 'Programación B' },
      { id: 'DAX_M04', name: 'Lenguajes de marcas y sistemas de gestión de información' },
      { id: 'DAX_M05', name: 'Entornos de desarrollo' },
      { id: 'DAM_M06', name: 'Acceso a datos' },
      { id: 'DAM_M07', name: 'Desarrollo de interfaces' },
      { id: 'DAM_M08', name: 'Programación multimedia y dispositivos móviles' },
      { id: 'DAM_M09', name: 'Programación de servicios y procesos' },
      { id: 'DAM_M10', name: 'Sistemas de gestión empresarial' },
      { id: 'DAW_M06', name: 'Desarrollo web en entorno cliente' },
      { id: 'DAW_M07', name: 'Desarrollo web en entorno servidor' },
      { id: 'DAW_M08', name: 'Despliegue de aplicaciones web' },
      { id: 'DAW_M09', name: 'Diseño de interfaces web' },
    ],
  },
  {
    id: 'die_dietetica',
    name: 'DIE - Dietética',
    asignaturas: [
      { id: 'DIE_C01', name: 'Organización y gestión del área de trabajo asignada en la unidad/gabinete de dietética' },
      { id: 'DIE_C02', name: 'Alimentación equilibrada' },
      { id: 'DIE_C03', name: 'Dietoterapia' },
      { id: 'DIE_C04A', name: 'Control alimentario - A' },
      { id: 'DIE_C04B', name: 'Control alimentario - B' },
      { id: 'DIE_C05A', name: 'Microbiología e higiene alimentaria - A' },
      { id: 'DIE_C05B', name: 'Microbiología e higiene alimentaria - B' },
      { id: 'DIE_C06', name: 'Educación sanitaria y promoción de la salud' },
      { id: 'DIE_C07', name: 'Fisiopatología aplicada a la dietética' },
    ],
  },
  {
    id: 'ds_documentacion_y_administracion_sanitarias',
    name: 'DS - Documentación y Administración Sanitarias',
    asignaturas: [
      { id: 'DS_M01', name: 'Gestión de pacientes' },
      { id: 'DS_M02', name: 'Terminología clínica y patología' },
      { id: 'DS_M03', name: 'Extracción de diagnósticos y procedimientos' },
      { id: 'DS_M04', name: 'Archivos y documentación sanitaria' },
      { id: 'DS_M05', name: 'Sistemas de información y clasificación sanitaria' },
      { id: 'DS_M07', name: 'Codificación sanitaria' },
      { id: 'DS_M08', name: 'Atención psicosocial al paciente/usuario' },
      { id: 'DS_M09', name: 'Validación y explotación de datos' },
      { id: 'DS_M10', name: 'Gestión administrativa sanitaria' },
    ],
  },
  {
    id: 'ei_educacion_infantil',
    name: 'EI - Educación Infantil',
    asignaturas: [
      { id: 'EI_M01', name: 'Intervención con familias y atención a los niños en riesgo social' },
      { id: 'EI_M02', name: 'Didáctica de la educación infantil' },
      { id: 'EI_M03', name: 'Autonomía personal y salud infantil' },
      { id: 'EI_M04', name: 'El juego infantil y su metodología' },
      { id: 'EI_M05', name: 'Expresión y comunicación' },
      { id: 'EI_M06', name: 'Desarrollo cognitivo y motriz' },
      { id: 'EI_M07', name: 'Desarrollo socioafectivo' },
      { id: 'EI_M08', name: 'Habilidades sociales' },
      { id: 'EI_M12', name: 'Recursos didácticos en inglés para la educación infantil' },
    ],
  },
  {
    id: 'tseas_ensenanza_y_animacion_sociodeportivas',
    name: 'TSEAS - Enseñanza y Animación Sociodeportivas',
    asignaturas: [
      { id: 'EAS_M01', name: 'Valoración de la condición física e intervención en accidentes' },
      { id: 'EAS_M02', name: 'Dinamización grupal' },
      { id: 'EAS_M03', name: 'Planificación de la animación sociodeportiva' },
      { id: 'EAS_M04', name: 'Metodología de la enseñanza de actividades físico-deportivas' },
      { id: 'EAS_M05', name: 'Actividades físico-deportivas individuales' },
      { id: 'EAS_M06', name: 'Actividades de ocio y tiempo libre' },
      { id: 'EAS_M07', name: 'Actividades físico-deportivas de implementos' },
      { id: 'EAS_M08', name: 'Actividades físico-deportivas de equipo' },
      { id: 'EAS_M09', name: 'Juegos y actividades físico-recreativas y de animación turística' },
      { id: 'EAS_M10', name: 'Actividades físico-deportivas para la inclusión social' },
    ],
  },
  {
    id: 'ems_emergencias_sanitarias',
    name: 'EMS - Emergencias Sanitarias',
    asignaturas: [
      { id: 'EMS_M02', name: 'Apoyo psicológico en situaciones de emergencia' },
      { id: 'EMS_M03', name: 'Atención sanitaria inicial en situaciones de emergencia' },
      { id: 'EMS_M04', name: 'Dotación sanitaria' },
      { id: 'EMS_M06', name: 'Mantenimiento mecánico preventivo del vehículo' },
      { id: 'EMS_M07', name: 'Planes de emergencia y dispositivos de riesgos previsibles' },
      { id: 'EMS_M08', name: 'Teleemergencias' },
      { id: 'EMS_M09', name: 'Atención sanitaria especial en situaciones de emergencia' },
      { id: 'EMS_M11', name: 'Evacuación y traslado de pacientes' },
      { id: 'EMS_M13', name: 'Logística sanitaria en emergencias' },
    ],
  },
  {
    id: 'far_farmacia_y_parafarmacia',
    name: 'FAR - Farmacia y Parafarmacia',
    asignaturas: [
      { id: 'FAR_M01', name: 'Anatomofisiología y patología básicas' },
      { id: 'FAR_M02', name: 'Dispensación de productos parafarmacéuticos' },
      { id: 'FAR_M03', name: 'Disposición y venta de productos' },
      { id: 'FAR_M05', name: 'Oficina de farmacia' },
      { id: 'FAR_M06', name: 'Operaciones básicas de laboratorio' },
      { id: 'FAR_M08', name: 'Dispensación de productos farmacéuticos' },
      { id: 'FAR_M10', name: 'Farmacia hospitalaria' },
      { id: 'FAR_M11', name: 'Formulación magistral' },
      { id: 'FAR_M13', name: 'Promoción de la salud' },
    ],
  },
  {
    id: 'gat_gestion_de_alojamientos_turisticos',
    name: 'GAT - Gestión de Alojamientos Turísticos',
    asignaturas: [
      { id: 'GAT_M01', name: 'Estructura del mercado turístico' },
      { id: 'GAT_M02', name: 'Recepción y reservas' },
      { id: 'GAT_M03', name: 'Gestión del departamento de pisos' },
      { id: 'GAT_M04', name: 'Protocolo y relaciones públicas' },
      { id: 'GAT_M05', name: 'Marketing turístico' },
      { id: 'GAT_M06', name: 'Comercialización de eventos' },
      { id: 'GAT_M07', name: 'Dirección de alojamientos turísticos' },
      { id: 'GAT_M08', name: 'Recursos humanos en el alojamiento' },
    ],
  },
  {
    id: 'gead_gestion_administrativa',
    name: 'GEAD - Gestión Administrativa',
    asignaturas: [
      { id: 'GEAD_M01', name: 'Comunicación empresarial y atención al cliente' },
      { id: 'GEAD_M02', name: 'Operaciones administrativas de compraventa' },
      { id: 'GEAD_M03', name: 'Operaciones administrativas de recursos humanos' },
      { id: 'GEAD_M04', name: 'Operaciones auxiliares de gestión de tesorería' },
      { id: 'GEAD_M05', name: 'Técnica contable' },
      { id: 'GEAD_M06', name: 'Tratamiento de la documentación contable' },
      { id: 'GEAD_M07', name: 'Tratamiento informático de la información' },
      { id: 'GEAD_M09', name: 'Empresa y administración' },
      { id: 'GEAD_M10', name: 'Empresa en el aula' },
    ],
  },
  {
    id: 'giat_guia_informacion_y_asistencias_turisticas',
    name: 'GIAT - Guía, Información y Asistencias Turísticas',
    asignaturas: [
      { id: 'GIAT_M02', name: 'Destinos turísticos' },
      { id: 'GIAT_M03', name: 'Servicios de información turística' },
      { id: 'GIAT_M05', name: 'Recursos turísticos' },
      { id: 'GIAT_M06', name: 'Procesos de guía y asistencia turística' },
      { id: 'GIAT_M07', name: 'Diseño de productos turísticos' },
    ],
  },
  {
    id: 'hb_higiene_bucodental_esp',
    name: 'HB - Higiene Bucodental (ESP)',
    asignaturas: [
      { id: 'HB_M01', name: 'Recepción y logística en la clínica dental' },
      { id: 'HB_M02', name: 'Estudio de la cavidad oral' },
      { id: 'HB_M03', name: 'Exploración de la cavidad oral' },
      { id: 'HB_M04', name: 'Intervención bucodental' },
      { id: 'HB_M05', name: 'Epidemiología en salud oral' },
      { id: 'HB_M06', name: 'Educación para la salud oral' },
      { id: 'HB_M07', name: 'Conservadora, periodoncia, cirugía e implantes' },
      { id: 'HB_M08', name: 'Prótesis y ortodoncia' },
      { id: 'HB_M10', name: 'Fisiopatología general' },
    ],
  },
  {
    id: 'hb_it_igiene_dentale_it',
    name: 'HB_IT - Igiene dentale (IT)',
    asignaturas: [
      { id: 'HB_IT_M01', name: 'Accoglienza e logistica nella clinica dentale' },
      { id: 'HB_IT_M02', name: 'Studio del cavo orale' },
      { id: 'HB_IT_M03', name: 'Esplorazione del cavo orale' },
      { id: 'HB_IT_M04', name: 'Interventi orali' },
      { id: 'HB_IT_M05', name: 'Epidemiologia nella salute orale' },
      { id: 'HB_IT_M06', name: 'Educazione alla salute orale' },
      { id: 'HB_IT_M07', name: 'Conservativa, periodonzia, chirurgia e impianti' },
      { id: 'HB_IT_M08', name: 'Protesi e ortodonzia' },
      { id: 'HB_IT_M10', name: 'Fisiopatologia generale' },
    ],
  },
  {
    id: 'idmn_imagen_para_el_diagnostico_y_medicina_nuclear_esp',
    name: 'IDMN - Imagen para el Diagnóstico y Medicina Nuclear (ESP)',
    asignaturas: [
      { id: 'IDMN_M01', name: 'Atención al paciente' },
      { id: 'IDMN_M02', name: 'Anatomía por la imagen' },
      { id: 'IDMN_M03', name: 'Protección radiológica' },
      { id: 'IDMN_M04', name: 'Técnicas de radiología simple' },
      { id: 'IDMN_M05', name: 'Técnicas de radiología especial' },
      { id: 'IDMN_M06', name: 'Técnicas de tomografía computarizada y ecografía' },
      { id: 'IDMN_M07', name: 'Técnicas de imagen por resonancia magnética' },
      { id: 'IDMN_M08', name: 'Técnicas de imagen en medicina nuclear' },
      { id: 'IDMN_M09', name: 'Técnicas de radiofarmacia' },
      { id: 'IDMN_M10', name: 'Fundamentos físicos y equipos' },
    ],
  },
  {
    id: 'idmn_it_radiologia_medica_it',
    name: 'IDMN_IT - Radiologia Medica (IT)',
    asignaturas: [
      { id: 'IDMN_IT_M01', name: 'Assistenza al paziente' },
      { id: 'IDMN_IT_M02', name: 'Anatomia per imaging' },
      { id: 'IDMN_IT_M03', name: 'Radioprotezione' },
      { id: 'IDMN_IT_M04', name: 'Tecniche di radiologia convenzionale' },
      { id: 'IDMN_IT_M05', name: 'Tecniche di radiologia speciale' },
      { id: 'IDMN_IT_M06', name: 'Tecniche di tomografia computerizzata e ecografia' },
      { id: 'IDMN_IT_M07', name: 'Tecniche di risonanza magnetica per immagini' },
      { id: 'IDMN_IT_M08', name: 'Tecniche d\'immagine in medicina nucleare' },
      { id: 'IDMN_IT_M09', name: 'Tecniche di radiofarmacia' },
      { id: 'IDMN_IT_M10', name: 'Fondamenti di fisica e apparecchiature radiologiche' },
    ],
  },
  {
    id: 'is_integracion_social',
    name: 'IS - Integración Social',
    asignaturas: [
      { id: 'IS_M01', name: 'Contexto de la intervención social' },
      { id: 'IS_M02', name: 'Metodología de la intervención social' },
      { id: 'IS_M03', name: 'Promoción de la autonomía personal' },
      { id: 'IS_M04', name: 'Inserción sociolaboral' },
      { id: 'IS_M05', name: 'Sistemas aumentativos y alternativos de comunicación' },
      { id: 'IS_M06', name: 'Atención a unidades de convivencia' },
      { id: 'IS_M07', name: 'Apoyo a la intervención educativa' },
      { id: 'IS_M08', name: 'Mediación comunitaria' },
      { id: 'IS_M09', name: 'Habilidades sociales' },
    ],
  },
  {
    id: 'lab_laboratorio_clinico_y_biomedico',
    name: 'LAB - Laboratorio Clínico y Biomédico',
    asignaturas: [
      { id: 'LAB_M01', name: 'Gestión de muestras biológicas' },
      { id: 'LAB_M02', name: 'Técnicas generales de laboratorio' },
      { id: 'LAB_M03', name: 'Biología molecular y citogenética' },
      { id: 'LAB_M07', name: 'Análisis bioquímico' },
      { id: 'LAB_M08', name: 'Técnicas de inmunodiagnóstico' },
      { id: 'LAB_M09', name: 'Microbiología clínica' },
      { id: 'LAB_M10', name: 'Técnicas de análisis hematológico' },
    ],
  },
  {
    id: 'mkt_marketing_y_publicidad',
    name: 'MKT - Marketing y Publicidad',
    asignaturas: [
      { id: 'MKT_M01', name: 'Atención al cliente, consumidor y usuario' },
      { id: 'MKT_M02', name: 'Diseño y elaboración de material de comunicación' },
      { id: 'MKT_M03', name: 'Gestión económica y financiera de la empresa' },
      { id: 'MKT_M04', name: 'Investigación comercial' },
      { id: 'MKT_M05', name: 'Trabajo de campo en la investigación comercial' },
      { id: 'MKT_M06', name: 'Lanzamiento de productos y servicios' },
      { id: 'MKT_M07', name: 'Marketing digital' },
      { id: 'MKT_M08', name: 'Medios y soportes de comunicación' },
      { id: 'MKT_M09', name: 'Políticas de marketing' },
      { id: 'MKT_M10', name: 'Relaciones públicas y organización de eventos de marketing' },
    ],
  },
  {
    id: 'mc_mediacion_comunicativa',
    name: 'MC - Mediación Comunicativa',
    asignaturas: [
      { id: 'MC_M01', name: 'Metodología de la integración social de las personas con dificultades de comunicación, lenguaje y habla' },
      { id: 'MC_M02', name: 'Sensibilización social y participación' },
      { id: 'MC_M03', name: 'Intervención socioeducativa con personas sordociegas' },
      { id: 'MC_M04', name: 'Contexto de la mediación comunicativa con personas sordociegas' },
      { id: 'MC_M05', name: 'Lengua de signos' },
      { id: 'MC_M06', name: 'Ámbitos de la aplicación de la lengua de signos' },
      { id: 'MC_M07', name: 'Intervención con personas con dificultades de comunicación' },
      { id: 'MC_M08', name: 'Técnicas de intervención comunicativa' },
    ],
  },
  {
    id: 'igu_promocion_de_igualdad_de_genero',
    name: 'IGU - Promoción de Igualdad de Género',
    asignaturas: [
      { id: 'IGU_M04', name: 'Desarrollo comunitario' },
      { id: 'IGU_M05', name: 'Información y comunicación con perspectiva de género' },
      { id: 'IGU_M06', name: 'Prevención de la violencia de género' },
      { id: 'IGU_M07', name: 'Promoción del empleo femenino' },
      { id: 'IGU_M08', name: 'Ámbitos de intervención para la promoción de igualdad' },
      { id: 'IGU_M09', name: 'Participación social de las mujeres' },
      { id: 'IGU_M10', name: 'Intervención socioeducativa para la igualdad' },
    ],
  },
  {
    id: 'pro_protesis_dentales',
    name: 'PRO - Prótesis Dentales',
    asignaturas: [
      { id: 'PRO_M01', name: 'Aparatos de ortodoncia y férulas oclusales' },
      { id: 'PRO_M02', name: 'Diseño funcional de prótesis' },
      { id: 'PRO_M04', name: 'Laboratorio de prótesis dentales' },
      { id: 'PRO_M05', name: 'Prótesis completas' },
      { id: 'PRO_M06', name: 'Prótesis parciales removibles metálicas, de resina y mixtas' },
      { id: 'PRO_M09', name: 'Prótesis sobre implantes' },
      { id: 'PRO_M10', name: 'Restauraciones y estructuras metálicas en prótesis fija' },
      { id: 'PRO_M11', name: 'Restauraciones y recubrimientos estéticos' },
    ],
  },
  {
    id: 'edif_proyectos_de_edificacion',
    name: 'EDIF - Proyectos de Edificación',
    asignaturas: [
      { id: 'EDIF_M01', name: 'Estructuras de construcción' },
      { id: 'EDIF_M02', name: 'Representaciones en construcción' },
      { id: 'EDIF_M03', name: 'Mediciones y valoraciones de construcción' },
      { id: 'EDIF_M04', name: 'Replanteos de construcción' },
      { id: 'EDIF_M05', name: 'Planificación de construcción' },
      { id: 'EDIF_M06', name: 'Diseño y construcción de edificios' },
      { id: 'EDIF_M07', name: 'Instalaciones en edificación' },
      { id: 'EDIF_M08', name: 'Eficiencia energética en edificación' },
      { id: 'EDIF_M09', name: 'Desarrollo de proyectos de edificación residencial' },
      { id: 'EDIF_M10', name: 'Desarrollo de proyectos de edificación no residencial' },
    ],
  },
  {
    id: 'obra_proyectos_de_obra_civil',
    name: 'OBRA - Proyectos de Obra Civil',
    asignaturas: [
      { id: 'OBRA_M06', name: 'Urbanismo y obra civil' },
      { id: 'OBRA_M07', name: 'Redes y servicios en obra civil' },
      { id: 'OBRA_M08', name: 'Levantamientos topográficos' },
      { id: 'OBRA_M09', name: 'Desarrollo de proyectos urbanísticos' },
      { id: 'OBRA_M10', name: 'Desarrollo de proyectos de obras lineales' },
    ],
  },
  {
    id: 'rad_radioterapia_y_dosimetria',
    name: 'RAD - Radioterapia y Dosimetría',
    asignaturas: [
      { id: 'RAD_M07', name: 'Simulación del tratamiento' },
      { id: 'RAD_M08', name: 'Dosimetría física y clínica' },
      { id: 'RAD_M09', name: 'Tratamientos con teleterapia' },
      { id: 'RAD_M10', name: 'Tratamientos con braquiterapia' },
    ],
  },
  {
    id: 'rea_realizacion_de_proyectos_audiovisuales_y_espectaculos',
    name: 'REA - Realización de Proyectos Audiovisuales y Espectáculos',
    asignaturas: [
      { id: 'REA_M01', name: 'Planificación de la realización en cine y vídeo' },
      { id: 'REA_M02', name: 'Procesos de realización de cine y vídeo' },
      { id: 'REA_M03', name: 'Planificación de la realización en televisión' },
      { id: 'REA_M04', name: 'Procesos de realización en televisión' },
      { id: 'REA_M05', name: 'Planificación del montaje y la posproducción audiovisuales' },
      { id: 'REA_M07', name: 'Planificación de regiduría de espectáculos y eventos' },
      { id: 'REA_M08', name: 'Procesos de regiduría de espectáculos y eventos' },
      { id: 'REA_M09', name: 'Medios técnicos audiovisuales y escénicos' },
    ],
  },
  {
    id: 'smix_sistemas_microinformaticos_y_redes',
    name: 'SMIX - Sistemas Microinformáticos y Redes',
    asignaturas: [
      { id: 'SMIX_M01', name: 'Montaje y mantenimiento de equipos' },
      { id: 'SMIX_M02', name: 'Sistemas operativos monopuesto' },
      { id: 'SMIX_M03', name: 'Aplicaciones ofimáticas' },
      { id: 'SMIX_M04', name: 'Sistemas operativos en red' },
      { id: 'SMIX_M05', name: 'Redes locales' },
      { id: 'SMIX_M06', name: 'Seguridad informática' },
      { id: 'SMIX_M07', name: 'Servicios de red' },
      { id: 'SMIX_M08', name: 'Aplicaciones web' },
    ],
  },
  {
    id: 'tl_transporte_y_logistica',
    name: 'TL - Transporte y Logística',
    asignaturas: [
      { id: 'TL_M01', name: 'Comercialización del transporte y la logística' },
      { id: 'TL_M02', name: 'Gestión administrativa del comercio internacional' },
      { id: 'TL_M03', name: 'Gestión administrativa del transporte y la logística' },
      { id: 'TL_M05', name: 'Logística de aprovisionamiento' },
      { id: 'TL_M06', name: 'Logística de almacenamiento' },
      { id: 'TL_M07', name: 'Organización del transporte de mercancías' },
      { id: 'TL_M08', name: 'Organización del transporte de viajeros' },
      { id: 'TL_M09', name: 'Transporte internacional de mercancías' },
      { id: 'TL_M10', name: 'Organización de otros servicios de transporte (solo Cataluña)' },
    ],
  },
  {
    id: 'iabd_inteligencia_artificial_y_big_data',
    name: 'IABD - Inteligencia Artificial y Big Data',
    asignaturas: [
      { id: 'IABD_M01', name: 'Modelos de inteligencia artificial' },
      { id: 'IABD_M02', name: 'Sistemas de aprendizaje automático' },
      { id: 'IABD_M03', name: 'Programación de inteligencia artificial' },
      { id: 'IABD_M04', name: 'Sistemas de big data' },
      { id: 'IABD_M05', name: 'Big data aplicado' },
    ],
  },
  {
    id: 'iabd_videojuegos_y_realidad_virtual',
    name: 'IABD - Videojuegos y Realidad Virtual',
    asignaturas: [
      { id: 'VRV_M01', name: 'Programación y motores de videojuegos' },
      { id: 'VRV_M02', name: 'Diseño gráfico 2D y 3D' },
      { id: 'VRV_M03', name: 'Programación en red e inteligencia artificial' },
      { id: 'VRV_M04', name: 'Realidad virtual y realidad aumentada' },
      { id: 'VRV_M05', name: 'Diseño, gestión, publicación y producción' },
    ],
  },
  {
    id: 'ciber_ciberseguridad',
    name: 'CIBER - Ciberseguridad',
    asignaturas: [
      { id: 'CIBER_M01', name: 'Incidentes de ciberseguridad' },
      { id: 'CIBER_M02', name: 'Bastionado de redes y sistemas.' },
      { id: 'CIBER_M03', name: 'Puesta en producción segura.' },
      { id: 'CIBER_M04', name: 'Análisis forense informático.' },
      { id: 'CIBER_M05', name: 'Hacking ético.' },
      { id: 'CIBER_M06', name: 'Normativa de ciberseguridad.' },
    ],
  },
]
