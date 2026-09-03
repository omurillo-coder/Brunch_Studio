import { describe, expect, it } from 'vitest'
import { addGameOverPack } from '../nodePacks'
import { createProject } from '../project'
import type { FinalNode, ProjectDocument, SlideNode } from '../schemas'

function newNodeIds(before: ProjectDocument, after: ProjectDocument): string[] {
  const beforeIds = new Set(before.graph.nodes.map((node) => node.id))
  return after.graph.nodes.filter((node) => !beforeIds.has(node.id)).map((node) => node.id)
}

describe('addGameOverPack', () => {
  it('crea dos diapositivas y un Final, nuevos; las diapositivas conectadas entre sí', () => {
    const project = createProject('P')
    const updated = addGameOverPack(project, { x: 0, y: 0 })

    const [slide1Id, gameOverId, finalId] = newNodeIds(project, updated)
    expect(slide1Id).toBeDefined()
    expect(gameOverId).toBeDefined()
    expect(finalId).toBeDefined()
    expect(updated.graph.nodes).toHaveLength(project.graph.nodes.length + 3)

    const slide1 = updated.graph.nodes.find((node) => node.id === slide1Id) as SlideNode
    expect(slide1.type).toBe('slide')
    expect(slide1.responses).toHaveLength(2)
    // Primera respuesta: sin destino, para que el diseñador la conecte.
    expect(slide1.responses[0]?.targetNodeId).toBeUndefined()
    // Segunda respuesta: conectada a "Game Over".
    expect(slide1.responses[1]?.targetNodeId).toBe(gameOverId)

    // El Final nace SIN conectar (ver comentario de `addGameOverPack`).
    const final = updated.graph.nodes.find((node) => node.id === finalId) as FinalNode
    expect(final.type).toBe('final')
  })

  it('la primera diapositiva ("+1 Fallo") lleva la insignia de lienzo "plus-one-fallo" y +1 Fallos al visitarla; la de "Game Over" lleva "game-over" y NINGÚN efecto', () => {
    const project = createProject('P')
    const updated = addGameOverPack(project, { x: 0, y: 0 })
    const [slide1Id, gameOverId] = newNodeIds(project, updated)

    const slide1 = updated.graph.nodes.find((node) => node.id === slide1Id) as SlideNode
    const gameOver = updated.graph.nodes.find((node) => node.id === gameOverId) as SlideNode

    const fallosVariable = updated.variables.find((variable) => variable.name === 'Fallos')
    expect(fallosVariable).toBeDefined()

    expect(slide1.canvasBadge).toBe('plus-one-fallo')
    expect(slide1.visitEffects).toEqual([
      { variableId: fallosVariable?.id, operation: 'increment', value: 1 },
    ])

    expect(gameOver.canvasBadge).toBe('game-over')
    expect(gameOver.visitEffects).toBeUndefined()
  })

  it('la diapositiva "Game Over" tiene el texto exacto y una imagen pendiente', () => {
    const project = createProject('P')
    const updated = addGameOverPack(project, { x: 0, y: 0 })
    const [, gameOverId] = newNodeIds(project, updated)

    const gameOver = updated.graph.nodes.find((node) => node.id === gameOverId) as SlideNode
    expect(gameOver.type).toBe('slide')

    const textBlock = gameOver.content.find((block) => block.type === 'text')
    expect(textBlock?.type === 'text' ? textBlock.body : null).toContain(
      'Lástima, parece que este caso se quedará sin resolver.',
    )
    expect(textBlock?.type === 'text' ? textBlock.body : null).toContain(
      '¿De verdad quieres rendirte ahora?',
    )

    const imageBlock = gameOver.content.find((block) => block.type === 'image')
    expect(imageBlock).toBeDefined()
    expect(imageBlock?.type === 'image' ? imageBlock.assetId : 'missing').toBeUndefined()

    const fallosVariable = updated.variables.find((variable) => variable.name === 'Fallos')
    expect(fallosVariable).toBeDefined()
    expect(fallosVariable?.type).toBe('number')
    expect(fallosVariable?.initialValue).toBe(0)

    expect(gameOver.responses).toHaveLength(2)
    const tryAgain = gameOver.responses.find((response) => response.text === 'Vale, voy a intentarlo.')
    expect(tryAgain).toBeDefined()
    expect(tryAgain?.targetNodeId).toBeUndefined()
    expect(tryAgain?.actsAsExit).toBeFalsy()

    const giveUp = gameOver.responses.find((response) => response.text === 'No, me rindo.')
    expect(giveUp).toBeDefined()
    expect(giveUp?.actsAsExit).toBe(true)
    expect(giveUp?.targetNodeId).toBeUndefined()
  })

  it('el Final tiene el contenido "Perfecto" por defecto, "con fallos" como alternativo (Fallos > 0) y confeti en los dos', () => {
    const project = createProject('P')
    const updated = addGameOverPack(project, { x: 0, y: 0 })
    const [, , finalId] = newNodeIds(project, updated)

    const final = updated.graph.nodes.find((node) => node.id === finalId) as FinalNode
    expect(final.type).toBe('final')

    expect(final.body).toContain('¡Impresionante!')
    expect(final.body).toContain('Lo has resuelto en un momento.')
    expect(final.body).toContain('¿Quieres explorar otros caminos?')

    expect(final.alternateBody).toContain('¡Buen trabajo!')
    expect(final.alternateBody).toContain(
      'Has conseguido resolver el caso, aunque has tenido algunos contratiempos.',
    )
    expect(final.alternateBody).toContain('¿Qué decisiones cambiarías?')

    const fallosVariable = updated.variables.find((variable) => variable.name === 'Fallos')
    expect(final.alternateCondition).toEqual({
      variableId: fallosVariable?.id,
      operator: '>',
      value: 0,
    })

    expect(final.celebrate).toBe(true)
  })

  it('reutiliza la variable "Fallos" si el proyecto ya tiene una con ese nombre, sin duplicarla ni reiniciar su valor', () => {
    let project = createProject('P')
    project = addGameOverPack(project, { x: 0, y: 0 })
    const fallosCountAfterFirst = project.variables.filter((v) => v.name === 'Fallos').length
    const firstFallosId = project.variables.find((v) => v.name === 'Fallos')?.id

    // Segundo pack sobre el mismo proyecto: no debe crear una segunda
    // variable "Fallos".
    const updated = addGameOverPack(project, { x: 400, y: 0 })
    const fallosVariables = updated.variables.filter((v) => v.name === 'Fallos')
    expect(fallosVariables).toHaveLength(fallosCountAfterFirst)
    expect(fallosVariables[0]?.id).toBe(firstFallosId)
  })

  it('coloca la segunda diapositiva ("Game Over") a la derecha de la primera, y el Final debajo de la primera', () => {
    const project = createProject('P')
    const updated = addGameOverPack(project, { x: 100, y: 50 })
    const [slide1Id, gameOverId, finalId] = newNodeIds(project, updated)

    const slide1 = updated.graph.nodes.find((node) => node.id === slide1Id)
    const gameOver = updated.graph.nodes.find((node) => node.id === gameOverId)
    const final = updated.graph.nodes.find((node) => node.id === finalId)
    expect(slide1?.position).toEqual({ x: 100, y: 50 })
    expect(gameOver?.position.x).toBeGreaterThan(slide1?.position.x ?? 0)
    expect(gameOver?.position.y).toBe(50)
    expect(final?.position.x).toBe(100)
    expect(final?.position.y).toBeGreaterThan(slide1?.position.y ?? 0)
  })
})
