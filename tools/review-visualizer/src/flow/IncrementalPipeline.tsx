import {useEffect, useMemo, useRef, useCallback} from 'react'
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
import type {IncrementalState} from '../panels/IncrementalReview'

const nodeTypes = {dataNode: DataNode}

interface Props {
  state: IncrementalState
}

export default function IncrementalPipeline({state}: Props) {
  const isFull = state.reviewMode === 'full'

  const initialNodes: Node[] = useMemo(() => {
    const col0 = 0
    const col1 = 360
    const col2 = 720
    const rowGap = 180

    return [
      {
        id: 'comment-body',
        type: 'dataNode',
        position: {x: col0, y: 0},
        data: {
          label: 'Summary Comment',
          type: 'input' as const,
          data: state.block || '(no commit ID block)',
          description: 'bot summary comment body'
        }
      },
      {
        id: 'parse-ids',
        type: 'dataNode',
        position: {x: col1, y: 0},
        data: {
          label: 'getReviewedCommitIds',
          type: 'process' as const,
          data: state.parsedIds.length > 0
            ? state.parsedIds.map(id => `• ${id}`).join('\n')
            : '(none)',
          description: `${state.parsedIds.length} reviewed commits parsed`
        }
      },
      {
        id: 'all-commits',
        type: 'dataNode',
        position: {x: col0, y: rowGap},
        data: {
          label: 'All PR Commits',
          type: 'input' as const,
          data: state.allCommits.map((c, i) => {
            const isReviewed = state.parsedIds.includes(c)
            const isHighest = c === state.highestReviewed
            return `${isHighest ? '→ ' : '  '}${c}${isReviewed ? ' ✓' : ''}`
          }).join('\n'),
          description: `${state.allCommits.length} commits in PR`
        }
      },
      {
        id: 'highest-reviewed',
        type: 'dataNode',
        position: {x: col1, y: rowGap},
        data: {
          label: 'getHighestReviewedCommitId',
          type: 'process' as const,
          data: state.highestReviewed || '(none — first review)',
          description: 'reverse scan: last reviewed in commit list'
        }
      },
      {
        id: 'review-mode',
        type: 'dataNode',
        position: {x: col0, y: rowGap * 2},
        data: {
          label: 'Review Mode',
          type: 'input' as const,
          data: isFull ? 'FULL (forced)' : 'INCREMENTAL',
          description: isFull ? '/review full command' : 'default mode'
        }
      },
      {
        id: 'diff-start',
        type: 'dataNode',
        position: {x: col1, y: rowGap * 2},
        data: {
          label: 'Diff Start Point',
          type: 'process' as const,
          data: `start: ${state.diffStart}` +
            (state.diffStart === state.highestReviewed
              ? '\n(from last reviewed commit)'
              : '\n(from base SHA — full range)'),
          description: isFull
            ? 'full mode → always base'
            : !state.highestReviewed
              ? 'no reviewed commits → base'
              : 'incremental → last reviewed'
        }
      },
      {
        id: 'target-diff',
        type: 'dataNode',
        position: {x: col0, y: rowGap * 3},
        data: {
          label: 'Target Branch Diff',
          type: 'input' as const,
          data: state.targetFiles.join('\n') || '(empty)',
          description: `base→HEAD: ${state.targetFiles.length} files`
        }
      },
      {
        id: 'incremental-diff',
        type: 'dataNode',
        position: {x: col0, y: rowGap * 4},
        data: {
          label: 'Incremental Diff',
          type: 'input' as const,
          data: state.incrementalFiles.join('\n') || '(empty)',
          description: `lastReviewed→HEAD: ${state.incrementalFiles.length} files`
        }
      },
      {
        id: 'intersection',
        type: 'dataNode',
        position: {x: col1, y: rowGap * 3.5},
        data: {
          label: 'File Intersection',
          type: 'process' as const,
          data: state.intersectedFiles.length > 0
            ? state.intersectedFiles.join('\n')
            : '(no files — nothing to review)',
          description: `target ∩ incremental = ${state.intersectedFiles.length} files`
        }
      },
      {
        id: 'add-commit',
        type: 'dataNode',
        position: {x: col2, y: 0},
        data: {
          label: 'addReviewedCommitId',
          type: 'output' as const,
          data: state.bodyAfterAdd !== state.block
            ? 'New commit ID appended to block'
            : '(no new commit to add)',
          description: 'update summary comment after review'
        }
      },
      {
        id: 'review-output',
        type: 'dataNode',
        position: {x: col2, y: rowGap * 3.5},
        data: {
          label: 'Files to Review',
          type: 'output' as const,
          data: state.intersectedFiles.length > 0
            ? `${state.intersectedFiles.length} files enter Phase 4\n\n` +
              state.intersectedFiles.map(f => `• ${f}`).join('\n')
            : 'No files to review — skip Phase 4',
          description: 'final file list for heavyBot'
        }
      }
    ]
  }, [state, isFull])

  const initialEdges: Edge[] = useMemo(
    () => [
      {
        id: 'e-comment-parse',
        source: 'comment-body',
        target: 'parse-ids',
        animated: true
      },
      {
        id: 'e-parse-highest',
        source: 'parse-ids',
        target: 'highest-reviewed',
        animated: true,
        label: 'reviewed IDs'
      },
      {
        id: 'e-allcommits-highest',
        source: 'all-commits',
        target: 'highest-reviewed',
        animated: true,
        label: 'all commit SHAs'
      },
      {
        id: 'e-highest-diffstart',
        source: 'highest-reviewed',
        target: 'diff-start',
        animated: true
      },
      {
        id: 'e-mode-diffstart',
        source: 'review-mode',
        target: 'diff-start',
        animated: true,
        label: isFull ? 'force base' : ''
      },
      {
        id: 'e-target-intersection',
        source: 'target-diff',
        target: 'intersection',
        animated: true
      },
      {
        id: 'e-incremental-intersection',
        source: 'incremental-diff',
        target: 'intersection',
        animated: true
      },
      {
        id: 'e-diffstart-incremental',
        source: 'diff-start',
        target: 'incremental-diff',
        animated: true,
        label: 'determines diff range'
      },
      {
        id: 'e-intersection-output',
        source: 'intersection',
        target: 'review-output',
        animated: true
      },
      {
        id: 'e-parse-add',
        source: 'parse-ids',
        target: 'add-commit',
        animated: true,
        label: 'after review completes'
      }
    ],
    [isFull]
  )

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

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    positionsRef.current[node.id] = {x: node.position.x, y: node.position.y}
  }, [])

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
