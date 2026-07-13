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
import type {FlowState} from '../panels/BasicReviewFlow'

const nodeTypes = {dataNode: DataNode}

interface Props {
  state: FlowState
}

export default function ReviewFlowPipeline({state}: Props) {
  const passCount = state.pathResults.filter(r => r.pass).length
  const failCount = state.pathResults.length - passCount

  const initialNodes: Node[] = useMemo(() => {
    const col0 = 0
    const col1 = 340
    const col2 = 680
    const col3 = 1020
    const rowGap = 180

    return [
      {
        id: 'pr-event',
        type: 'dataNode',
        position: {x: col0, y: 0},
        data: {
          label: 'PR Event',
          type: 'input' as const,
          data: 'pull_request (opened / synchronize)',
          description: 'GitHub webhook trigger'
        }
      },
      {
        id: 'ignore-check',
        type: 'dataNode',
        position: {x: col1, y: 0},
        data: {
          label: 'Ignore Check',
          type: 'process' as const,
          data: state.hasIgnore
            ? 'BLOCKED — @codesentinel: ignore found'
            : 'PASS — no ignore keyword',
          description: 'body.includes("@codesentinel: ignore")'
        }
      },
      {
        id: 'pause-check',
        type: 'dataNode',
        position: {x: col1, y: rowGap},
        data: {
          label: 'Pause State Check',
          type: 'process' as const,
          data: `state: ${state.reviewState}`,
          description: 'getReviewStateFromBody()'
        }
      },
      {
        id: 'state-write',
        type: 'dataNode',
        position: {x: col0, y: rowGap},
        data: {
          label: 'writeReviewStateToBody',
          type: 'process' as const,
          data: state.bodyAfterWrite.length > 100
            ? state.bodyAfterWrite.slice(0, 100) + '...'
            : state.bodyAfterWrite,
          description: 'writes state tag into PR body'
        }
      },
      {
        id: 'path-filter',
        type: 'dataNode',
        position: {x: col1, y: rowGap * 2},
        data: {
          label: 'PathFilter',
          type: 'process' as const,
          data: `${passCount} pass, ${failCount} filtered out`,
          description: 'minimatch glob rules'
        }
      },
      {
        id: 'filter-rules',
        type: 'dataNode',
        position: {x: col0, y: rowGap * 2},
        data: {
          label: 'Filter Rules',
          type: 'input' as const,
          data: state.pathResults
            .slice(0, 6)
            .map(r => `${r.pass ? '✓' : '✗'} ${r.path}`)
            .join('\n') +
            (state.pathResults.length > 6
              ? `\n... +${state.pathResults.length - 6} more`
              : ''),
          description: 'inclusion / exclusion patterns'
        }
      },
      {
        id: 'lightbot',
        type: 'dataNode',
        position: {x: col2, y: 0},
        data: {
          label: 'lightBot Summary',
          type: 'process' as const,
          data: state.summaryAfterTriage.length > 80
            ? state.summaryAfterTriage.slice(0, 80) + '...'
            : state.summaryAfterTriage,
          description: 'Phase 1-3: summarize → merge → release notes'
        }
      },
      {
        id: 'triage',
        type: 'dataNode',
        position: {x: col2, y: rowGap},
        data: {
          label: 'TRIAGE Parse',
          type: 'process' as const,
          data: state.triageResult ?? 'NEEDS_REVIEW (default)',
          description: '/\\[TRIAGE\\]:\\s*(NEEDS_REVIEW|APPROVED)/'
        }
      },
      {
        id: 'review-decision',
        type: 'dataNode',
        position: {x: col2, y: rowGap * 2},
        data: {
          label: 'Review Decision',
          type: 'output' as const,
          data:
            state.hasIgnore
              ? 'SKIP — ignore keyword'
              : state.reviewState === 'paused'
                ? 'SKIP — review paused'
                : state.triageResult === 'APPROVED'
                  ? 'SKIP — file auto-approved'
                  : `REVIEW — ${passCount} files pass filter`,
          description: 'final decision for Phase 4'
        }
      },
      {
        id: 'tags-info',
        type: 'dataNode',
        position: {x: col3, y: 0},
        data: {
          label: 'Comment Tags',
          type: 'output' as const,
          data: [
            `SUMMARIZE_TAG: "${state.tags.summarize.slice(0, 40)}..."`,
            `RAW_SUMMARY: start/end pair`,
            `SHORT_SUMMARY: start/end pair`,
            `COMMIT_ID: start/end pair`
          ].join('\n'),
          description: 'HTML comment tags in bot summary'
        }
      }
    ]
  }, [state, passCount, failCount])

  const blocked = state.hasIgnore || state.reviewState === 'paused'

  const initialEdges: Edge[] = useMemo(
    () => [
      {
        id: 'e-pr-ignore',
        source: 'pr-event',
        target: 'ignore-check',
        animated: true
      },
      {
        id: 'e-pr-statewrite',
        source: 'pr-event',
        target: 'state-write',
        animated: true
      },
      {
        id: 'e-statewrite-pause',
        source: 'state-write',
        target: 'pause-check',
        animated: true
      },
      ...(state.hasIgnore
        ? [
            {
              id: 'e-ignore-decision',
              source: 'ignore-check',
              target: 'review-decision',
              animated: true,
              label: 'SKIP — ignore found',
              style: {stroke: '#c62828'}
            }
          ]
        : [
            {
              id: 'e-ignore-pause',
              source: 'ignore-check',
              target: 'pause-check',
              animated: true,
              label: 'pass'
            }
          ]),
      ...(state.reviewState === 'paused' && !state.hasIgnore
        ? [
            {
              id: 'e-pause-decision',
              source: 'pause-check',
              target: 'review-decision',
              animated: true,
              label: 'SKIP — paused',
              style: {stroke: '#c62828'}
            }
          ]
        : !blocked
          ? [
              {
                id: 'e-pause-filter',
                source: 'pause-check',
                target: 'path-filter',
                animated: true,
                label: 'pass'
              }
            ]
          : []),
      ...(!blocked
        ? [
            {
              id: 'e-rules-filter',
              source: 'filter-rules',
              target: 'path-filter',
              animated: true
            },
            {
              id: 'e-filter-lightbot',
              source: 'path-filter',
              target: 'lightbot',
              animated: true,
              label: `${passCount} files`
            }
          ]
        : []),
      ...(!blocked
        ? [
            {
              id: 'e-lightbot-triage',
              source: 'lightbot',
              target: 'triage',
              animated: true
            },
            {
              id: 'e-triage-decision',
              source: 'triage',
              target: 'review-decision',
              animated: true
            },
            {
              id: 'e-lightbot-tags',
              source: 'lightbot',
              target: 'tags-info',
              animated: true,
              label: 'comment format'
            }
          ]
        : [])
    ],
    [state.hasIgnore, state.reviewState, passCount, blocked]
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
