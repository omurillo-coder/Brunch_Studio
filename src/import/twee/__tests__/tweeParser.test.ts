import { describe, expect, it } from 'vitest'
import { parseTweeSource } from '../tweeParser'

describe('parseTweeSource', () => {
  it('parsea un único pasaje sin etiquetas ni metadata', () => {
    const passages = parseTweeSource(':: Inicio\nHola mundo.')
    expect(passages).toEqual([{ name: 'Inicio', tags: [], metadata: undefined, body: 'Hola mundo.' }])
  })

  it('parsea varios pasajes en el orden en que aparecen', () => {
    const source = ':: Uno\nCuerpo uno.\n\n:: Dos\nCuerpo dos.\n\n:: Tres\nCuerpo tres.'
    const passages = parseTweeSource(source)
    expect(passages.map((p) => p.name)).toEqual(['Uno', 'Dos', 'Tres'])
    expect(passages.map((p) => p.body)).toEqual(['Cuerpo uno.', 'Cuerpo dos.', 'Cuerpo tres.'])
  })

  it('parsea etiquetas entre corchetes', () => {
    const passages = parseTweeSource(':: Combate [peligro jefe]\nTexto.')
    expect(passages[0]?.tags).toEqual(['peligro', 'jefe'])
    expect(passages[0]?.name).toBe('Combate')
  })

  it('parsea metadata JSON entre llaves', () => {
    const passages = parseTweeSource(':: Inicio {"position":"100,200"}\nTexto.')
    expect(passages[0]?.metadata).toEqual({ position: '100,200' })
    expect(passages[0]?.name).toBe('Inicio')
  })

  it('parsea etiquetas y metadata juntas en el orden nombre, etiquetas, metadata', () => {
    const passages = parseTweeSource(':: Combate [peligro] {"size":"200,100"}\nTexto.')
    expect(passages[0]?.name).toBe('Combate')
    expect(passages[0]?.tags).toEqual(['peligro'])
    expect(passages[0]?.metadata).toEqual({ size: '200,100' })
  })

  it('ignora metadata JSON inválida en vez de romper el parseo', () => {
    const passages = parseTweeSource(':: Inicio {esto no es json}\nTexto.')
    // El bloque final entre llaves se reconoce como candidato a metadata (las
    // llaves están balanceadas), pero al no ser JSON válido se descarta sin
    // romper el parseo del resto del pasaje; el nombre no incluye el bloque.
    expect(passages[0]?.name).toBe('Inicio')
    expect(passages[0]?.metadata).toBeUndefined()
    expect(passages).toHaveLength(1)
  })

  it('desescapa los ":" del nombre de pasaje', () => {
    const passages = parseTweeSource(':: Capítulo 1\\: El inicio\nTexto.')
    expect(passages[0]?.name).toBe('Capítulo 1: El inicio')
  })

  it('trata una línea que empieza por "\\::" como cuerpo, no como cabecera', () => {
    const source = ':: Inicio\nPrimera línea.\n\\:: Esto no es una cabecera.\nÚltima línea.'
    const passages = parseTweeSource(source)
    expect(passages).toHaveLength(1)
    expect(passages[0]?.body).toBe('Primera línea.\n:: Esto no es una cabecera.\nÚltima línea.')
  })

  it('descarta el contenido anterior a la primera cabecera', () => {
    const source = 'Comentario suelto antes de cualquier pasaje.\n:: Inicio\nTexto.'
    const passages = parseTweeSource(source)
    expect(passages).toHaveLength(1)
    expect(passages[0]?.name).toBe('Inicio')
  })

  it('devuelve una lista vacía para un archivo sin ninguna cabecera', () => {
    expect(parseTweeSource('solo texto suelto, sin pasajes')).toEqual([])
  })

  it('devuelve una lista vacía para una cadena vacía', () => {
    expect(parseTweeSource('')).toEqual([])
  })

  it('recorta espacios en blanco sobrantes al principio/final del cuerpo', () => {
    const passages = parseTweeSource(':: Inicio\n\n  Texto con espacios.  \n\n')
    expect(passages[0]?.body).toBe('Texto con espacios.')
  })

  it('conserva pasajes especiales StoryTitle/StoryData como pasajes normales del parser', () => {
    const source = ':: StoryTitle\nMi historia\n\n:: StoryData\n{"start":"Inicio"}\n\n:: Inicio\nTexto.'
    const passages = parseTweeSource(source)
    expect(passages.map((p) => p.name)).toEqual(['StoryTitle', 'StoryData', 'Inicio'])
    expect(passages[0]?.body).toBe('Mi historia')
    expect(passages[1]?.body).toBe('{"start":"Inicio"}')
  })
})
