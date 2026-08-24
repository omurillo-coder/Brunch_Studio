import { describe, expect, it } from 'vitest'
import { convertTweeToProject } from '../tweeConverter'
import { parseRichBody } from '../../../editor/richText/richTextContent'
import type { FinalNode, SlideNode } from '../../../domain'

function bodyText(body: string): string {
  const doc = parseRichBody(body)
  return (doc.content ?? [])
    .map((paragraph) =>
      (paragraph.content ?? []).map((textNode) => (textNode as { text?: string }).text ?? '').join(''),
    )
    .join('\n\n')
}

describe('convertTweeToProject', () => {
  it('lanza un error claro si el archivo no tiene ningún pasaje reconocible (vacío)', () => {
    expect(() => convertTweeToProject('', 'Historia')).toThrow()
  })

  it('lanza un error claro si el archivo solo tiene StoryTitle/StoryData', () => {
    const source = ':: StoryTitle\nMi historia\n\n:: StoryData\n{"ifid":"ABC"}'
    expect(() => convertTweeToProject(source, 'Historia')).toThrow()
  })

  it('un pasaje sin enlaces se convierte en un nodo Final', () => {
    const source = ':: Fin\nSe acabó la aventura.'
    const { document } = convertTweeToProject(source, 'Historia')
    expect(document.graph.nodes).toHaveLength(1)
    const node = document.graph.nodes[0] as FinalNode
    expect(node.type).toBe('final')
    expect(node.title).toBe('Fin')
    expect(bodyText(node.body)).toBe('Se acabó la aventura.')
  })

  it('un pasaje con un enlace se convierte en diapositiva "de continuar" sin continueLabel cuando el texto es genérico', () => {
    const source = ':: Inicio\nTexto. [[Siguiente]]\n\n:: Siguiente\nFin.'
    const { document } = convertTweeToProject(source, 'Historia')
    const inicio = document.graph.nodes.find((n) => n.title === 'Inicio') as SlideNode
    const siguiente = document.graph.nodes.find((n) => n.title === 'Siguiente')
    expect(inicio.type).toBe('slide')
    expect(inicio.responses).toHaveLength(0)
    expect(inicio.targetNodeId).toBe(siguiente?.id)
    expect(inicio.continueLabel).toBeUndefined()
    expect(bodyText(inicio.body)).toBe('Texto.')
  })

  it('un enlace con texto personalizado distinto del destino fija continueLabel', () => {
    const source = ':: Inicio\nTexto. [[Sigue leyendo->Siguiente]]\n\n:: Siguiente\nFin.'
    const { document } = convertTweeToProject(source, 'Historia')
    const inicio = document.graph.nodes.find((n) => n.title === 'Inicio') as SlideNode
    expect(inicio.continueLabel).toBe('Sigue leyendo')
  })

  it('un enlace con texto "Continue" no genera continueLabel personalizado', () => {
    const source = ':: Inicio\nTexto. [[Continue->Siguiente]]\n\n:: Siguiente\nFin.'
    const { document } = convertTweeToProject(source, 'Historia')
    const inicio = document.graph.nodes.find((n) => n.title === 'Inicio') as SlideNode
    expect(inicio.continueLabel).toBeUndefined()
  })

  it('un enlace cuyo texto mostrado es igual al nombre del destino no genera continueLabel personalizado', () => {
    const source = ':: Inicio\nTexto. [[Siguiente->Siguiente]]\n\n:: Siguiente\nFin.'
    const { document } = convertTweeToProject(source, 'Historia')
    const inicio = document.graph.nodes.find((n) => n.title === 'Inicio') as SlideNode
    expect(inicio.continueLabel).toBeUndefined()
  })

  it('un pasaje con 2 a 4 enlaces se convierte en diapositiva de decisión, una respuesta por enlace en orden', () => {
    const source =
      ':: Inicio\nElige.\n[[Ir a la izquierda->Izquierda]]\n[[Ir a la derecha->Derecha]]\n\n' +
      ':: Izquierda\nFin izquierda.\n\n:: Derecha\nFin derecha.'
    const { document, warnings } = convertTweeToProject(source, 'Historia')
    const inicio = document.graph.nodes.find((n) => n.title === 'Inicio') as SlideNode
    const izquierda = document.graph.nodes.find((n) => n.title === 'Izquierda')
    const derecha = document.graph.nodes.find((n) => n.title === 'Derecha')

    expect(inicio.responses).toHaveLength(2)
    expect(inicio.responses[0]?.text).toBe('Ir a la izquierda')
    expect(inicio.responses[0]?.targetNodeId).toBe(izquierda?.id)
    expect(inicio.responses[0]?.letter).toBe('A')
    expect(inicio.responses[1]?.text).toBe('Ir a la derecha')
    expect(inicio.responses[1]?.targetNodeId).toBe(derecha?.id)
    expect(inicio.responses[1]?.letter).toBe('B')
    expect(warnings).toHaveLength(0)
  })

  it('un pasaje con más de 4 enlaces usa los 4 primeros y avisa de los descartados', () => {
    const source =
      ':: Inicio\n' +
      '[[A]]\n[[B]]\n[[C]]\n[[D]]\n[[E]]\n\n' +
      ':: A\nFin.\n\n:: B\nFin.\n\n:: C\nFin.\n\n:: D\nFin.\n\n:: E\nFin.'
    const { document, warnings } = convertTweeToProject(source, 'Historia')
    const inicio = document.graph.nodes.find((n) => n.title === 'Inicio') as SlideNode

    expect(inicio.responses).toHaveLength(4)
    expect(inicio.responses.map((r) => r.text)).toEqual(['A', 'B', 'C', 'D'])
    expect(warnings.some((w) => w.includes('Inicio') && w.includes('descartado'))).toBe(true)
  })

  it('reconoce las cuatro notaciones de enlace equivalentes', () => {
    const source =
      ':: Inicio\n' +
      '[[Destino1]]\n[[Texto A->Destino2]]\n[[Destino3<-Texto B]]\n[[Texto C|Destino4]]\n\n' +
      ':: Destino1\nFin.\n\n:: Destino2\nFin.\n\n:: Destino3\nFin.\n\n:: Destino4\nFin.'
    const { document } = convertTweeToProject(source, 'Historia')
    const inicio = document.graph.nodes.find((n) => n.title === 'Inicio') as SlideNode
    const byTarget = (name: string) => document.graph.nodes.find((n) => n.title === name)?.id

    expect(inicio.responses[0]?.text).toBe('Destino1')
    expect(inicio.responses[0]?.targetNodeId).toBe(byTarget('Destino1'))
    expect(inicio.responses[1]?.text).toBe('Texto A')
    expect(inicio.responses[1]?.targetNodeId).toBe(byTarget('Destino2'))
    expect(inicio.responses[2]?.text).toBe('Texto B')
    expect(inicio.responses[2]?.targetNodeId).toBe(byTarget('Destino3'))
    expect(inicio.responses[3]?.text).toBe('Texto C')
    expect(inicio.responses[3]?.targetNodeId).toBe(byTarget('Destino4'))
  })

  it('usa StoryTitle como nombre del proyecto cuando existe y no está vacío', () => {
    const source = ':: StoryTitle\nLa gran aventura\n\n:: Inicio\nTexto.'
    const { document } = convertTweeToProject(source, 'nombre-de-archivo')
    expect(document.metadata.name).toBe('La gran aventura')
  })

  it('usa fallbackName cuando no hay StoryTitle', () => {
    const source = ':: Inicio\nTexto.'
    const { document } = convertTweeToProject(source, 'nombre-de-archivo')
    expect(document.metadata.name).toBe('nombre-de-archivo')
  })

  it('usa fallbackName cuando StoryTitle está vacío', () => {
    const source = ':: StoryTitle\n\n:: Inicio\nTexto.'
    const { document } = convertTweeToProject(source, 'nombre-de-archivo')
    expect(document.metadata.name).toBe('nombre-de-archivo')
  })

  it('StoryData.start fija el pasaje de inicio cuando nombra un pasaje real', () => {
    const source =
      ':: StoryData\n{"start":"Segundo"}\n\n:: Primero\nTexto.\n\n:: Segundo\nTexto.'
    const { document } = convertTweeToProject(source, 'Historia')
    const segundo = document.graph.nodes.find((n) => n.title === 'Segundo')
    expect(document.graph.startNodeId).toBe(segundo?.id)
  })

  it('usa el primer pasaje en orden de aparición como inicio si no hay StoryData', () => {
    const source = ':: Primero\nTexto.\n\n:: Segundo\nTexto.'
    const { document } = convertTweeToProject(source, 'Historia')
    const primero = document.graph.nodes.find((n) => n.title === 'Primero')
    expect(document.graph.startNodeId).toBe(primero?.id)
  })

  it('usa el primer pasaje en orden de aparición si StoryData.start no nombra un pasaje real', () => {
    const source =
      ':: StoryData\n{"start":"NoExiste"}\n\n:: Primero\nTexto.\n\n:: Segundo\nTexto.'
    const { document } = convertTweeToProject(source, 'Historia')
    const primero = document.graph.nodes.find((n) => n.title === 'Primero')
    expect(document.graph.startNodeId).toBe(primero?.id)
  })

  it('un enlace a un pasaje inexistente se deja sin destino y genera un aviso', () => {
    const source = ':: Inicio\nTexto. [[Fantasma]]'
    const { document, warnings } = convertTweeToProject(source, 'Historia')
    const inicio = document.graph.nodes.find((n) => n.title === 'Inicio') as SlideNode
    expect(inicio.targetNodeId).toBeUndefined()
    expect(warnings.some((w) => w.includes('Fantasma') && w.includes('Inicio'))).toBe(true)
  })

  it('detecta una macro Harlowe en un pasaje y avisa sin borrar el texto', () => {
    const source = ':: ConVariable\nTexto. (set: $vida to 10) Sigue leyendo. [[Siguiente]]\n\n:: Siguiente\nFin.'
    const { document, warnings } = convertTweeToProject(source, 'Historia')
    const nodo = document.graph.nodes.find((n) => n.title === 'ConVariable')
    expect(warnings.some((w) => w.includes('ConVariable'))).toBe(true)
    expect(bodyText(nodo?.body ?? '')).toContain('(set: $vida to 10)')
  })

  it('detecta una macro SugarCube en otro pasaje y avisa por separado', () => {
    const source =
      ':: ConVariableHarlowe\n(set: $vida to 10) [[Siguiente]]\n\n' +
      ':: ConMacroSugarCube\n<<set $vida = 10>> [[Siguiente]]\n\n' +
      ':: Siguiente\nFin.'
    const { warnings } = convertTweeToProject(source, 'Historia')
    expect(warnings.some((w) => w.includes('ConVariableHarlowe'))).toBe(true)
    expect(warnings.some((w) => w.includes('ConMacroSugarCube'))).toBe(true)
    // Un aviso por cada pasaje afectado, no uno combinado.
    expect(warnings.filter((w) => w.includes('lógica de Twine'))).toHaveLength(2)
  })

  it('no genera ningún aviso para un archivo sin enlaces rotos ni lógica de story format ni exceso de respuestas', () => {
    const source = ':: Inicio\nTexto. [[Siguiente]]\n\n:: Siguiente\nFin.'
    const { warnings } = convertTweeToProject(source, 'Historia')
    expect(warnings).toEqual([])
  })
})
