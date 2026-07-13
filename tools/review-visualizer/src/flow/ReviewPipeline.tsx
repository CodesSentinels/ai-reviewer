import {useCallback, useEffect, useMemo, useRef} from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import DataNode from './nodes/DataNode'
import type {PipelineState} from '../engine/adapters'

const nodeTypes = {dataNode: DataNode}

interface Props {
  state: PipelineState
  sourceFilename: string
  refFilename: string
}

export default function ReviewPipeline({
  state,
  sourceFilename,
  refFilename
}: Props) {
  const isVue = sourceFilename.endsWith('.vue')

  const initialNodes: Node[] = useMemo(() => {
    const rowGap = 180
    const col0 = 0
    const col1 = 360
    const col2 = 740

    const row0 = 0                          // Diff Patch → extractModifiedSymbols
    const row1 = rowGap                     // Source Content (→ Vue extract if Vue)
    const rowRef = isVue ? rowGap * 2 : rowGap   // Reference File → parseImports
    const rowRefs = rowRef + rowGap               // findReferencesInContent

    const nodes: Node[] = [
      {
        id: 'diff-input',
        type: 'dataNode',
        position: {x: col0, y: row0},
        data: {
          label: 'Diff Patch',
          type: 'input',
          data: `${state.symbols.length} symbols extracted`,
          description: `modified file: ${sourceFilename}`
        }
      },
      {
        id: 'extract-symbols',
        type: 'dataNode',
        position: {x: col1, y: row0},
        data: {
          label: 'extractModifiedSymbols',
          type: 'process',
          data: state.symbols,
          description: `${sourceFilename}`
        }
      },
      {
        id: 'source-input',
        type: 'dataNode',
        position: {x: col0, y: row1},
        data: {
          label: 'Source Content',
          type: 'input',
          data: `${sourceFilename}`,
          description: isVue ? 'Vue SFC — modified file' : 'TS/JS — modified file'
        }
      },
      {
        id: 'ref-input',
        type: 'dataNode',
        position: {x: col0, y: rowRef},
        data: {
          label: 'Reference File',
          type: 'input',
          data: refFilename,
          description: 'file that may import modified symbols'
        }
      },
      {
        id: 'parse-imports',
        type: 'dataNode',
        position: {x: col1, y: rowRef},
        data: {
          label: 'parseImports',
          type: 'process',
          data: state.imports,
          description: `${refFilename}: ${state.imports.length} imports found`
        }
      },
      {
        id: 'find-refs',
        type: 'dataNode',
        position: {x: col1, y: rowRefs},
        data: {
          label: 'findReferencesInContent',
          type: 'process',
          data: state.references,
          description: `${state.references.length} references found`
        }
      },
      {
        id: 'format-output',
        type: 'dataNode',
        position: {x: col2, y: rowRef},
        data: {
          label: 'formatCrossFileContext',
          type: 'output',
          data: state.formattedContext || '(no exported symbols modified)',
          description: 'final context for AI review'
        }
      }
    ]

    if (isVue) {
      nodes.push({
        id: 'vue-extract',
        type: 'dataNode',
        position: {x: col1, y: row1},
        data: {
          label: 'extractVueScriptContent',
          type: 'process',
          data: state.vueScriptContent || '(empty)',
          description: `<script> from ${sourceFilename}`
        }
      })
    }

    return nodes
  }, [state, sourceFilename, refFilename, isVue])

  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [
      {
        id: 'e-diff-symbols',
        source: 'diff-input',
        target: 'extract-symbols',
        animated: true
      },
      {
        id: 'e-ref-imports',
        source: 'ref-input',
        target: 'parse-imports',
        animated: true
      },
      {
        id: 'e-ref-refs',
        source: 'ref-input',
        target: 'find-refs',
        animated: true
      },
      {
        id: 'e-symbols-refs',
        source: 'extract-symbols',
        target: 'find-refs',
        animated: true,
        label: 'exported symbols'
      },
      {
        id: 'e-symbols-format',
        source: 'extract-symbols',
        target: 'format-output',
        animated: true
      },
      {
        id: 'e-imports-format',
        source: 'parse-imports',
        target: 'format-output',
        animated: true
      },
      {
        id: 'e-refs-format',
        source: 'find-refs',
        target: 'format-output',
        animated: true
      }
    ]
    if (isVue) {
      edges.push({
        id: 'e-source-vue',
        source: 'source-input',
        target: 'vue-extract',
        animated: true,
        label: '<script> extraction'
      })
    }
    return edges
  }, [isVue])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const positionsRef = useRef<Record<string, {x: number; y: number}>>({})

  useEffect(() => {
    setNodes(prev => {
      const draggedPositions: Record<string, {x: number; y: number}> = {}
      for (const n of prev) {
        if (positionsRef.current[n.id]) {
          draggedPositions[n.id] = {x: n.position.x, y: n.position.y}
        }
      }
      positionsRef.current = draggedPositions

      return initialNodes.map(n => ({
        ...n,
        position: draggedPositions[n.id] ?? n.position
      }))
    })
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      positionsRef.current[node.id] = {x: node.position.x, y: node.position.y}
    },
    []
  )

  return (
    <div style={{width: '100%', height: '100%'}}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{padding: 0.2}}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
