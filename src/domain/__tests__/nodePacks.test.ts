import { describe, expect, it } from 'vitest'
import { addGameOverPack } from '../nodePacks'
import { createProject } from '../project'
import type { ProjectDocument, SlideNode } from '../schemas'

function newNodeIds(before: ProjectDocument, after: ProjectDocument): string[] {
  const beforeIds = new Set(before.graph.nodes.map((node) => node.id))
  return after.graph.nodes.filter((node) => !beforeIds.has(node.id)).map((node) => node.id)
}

describe('addGameOverPack', () => {
  it('crea dos diapositivas nuevas, conectadas entre sí', () => {
    const project = createProject('P')
    const updated = addGameOverPack(project, { x: 0, y: 0 })

    const [slide1Id, gameOverId] = newNodeIds(project, updated)
    expect(slide1Id).toBeDefined()
    expect(gameOverId).toBeDefined()
    expect(updated.graph.nodes).toHaveLength(project.graph.nodes.length + 2)

    const slide1 = updated.graph.nodes.find((node) => node.id === slide1Id) as SlideNode
    expect(slide1.type).toBe('slide')
    expect(slide1.responses).toHaveLength(2)
    // Primera respuesta: sin destino, para que el diseñador la conecte.
    expect(slide1.responses[0]?.targetNodeId).toBeUndefined()
    // Segunda respuesta: conectada a "Game Over".
    expect(slide1.responses[1]?.targetNodeId).toBe(gameOverId)
  })

  it('la diapositiva "Game Over" tiene el texto exacto, una imagen pendiente y +1 Fallos al visitarla', () => {
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
    expect(gameOver.visitEffects).toEqual([
      { variableId: fallosVariable?.id, operation: 'increment', value: 1 },
    ])

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

  it('coloca la segunda diapositiva ("Game Over") a la derecha de la primera', () => {
    const project = createProject('P')
    const updated = addGameOverPack(project, { x: 100, y: 50 })
    const [slide1Id, gameOverId] = newNodeIds(project, updated)

    const slide1 = updated.graph.nodes.find((node) => node.id === slide1Id)
    const gameOver = updated.graph.nodes.find((node) => node.id === gameOverId)
    expect(slide1?.position).toEqual({ x: 100, y: 50 })
    expect(gameOver?.position.x).toBeGreaterThan(slide1?.position.x ?? 0)
    expect(gameOver?.position.y).toBe(50)
  })
})
