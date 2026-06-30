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
import type {ChainStatusState} from '../panels/CommentChainStatus'

const nodeTypes = {dataNode: DataNode}

interface Props {
  state: ChainStatusState
  patch: string
}

export default function CommentChainStatusFlow({state, patch}: Props) {
  const firstComment = state.comments[0] ?? null
  const isResolved = firstComment?.isResolved ?? null
  const hasMap = state.comments.some(c => c.isResolved !== null)

  // Determine AI decision outcome for edges/colors
  const isFixed = patch.includes('prepare') || patch.includes('?')
  type Outcome = 'lgtm-open-fixed' | 'lgtm-open-duplicate' | 'new-comment-regression' | 'lgtm-resolved-fixed' | 'lgtm-no-map'
  const outcome: Outcome = (() => {
    if (!hasMap || isResolved === null) return 'lgtm-no-map'
    if (!isResolved && isFixed) return 'lgtm-open-fixed'
    if (!isResolved && !isFixed) return 'lgtm-open-duplicate'
    if (isResolved && isFixed) return 'lgtm-resolved-fixed'
    return 'new-comment-regression'
  })()

  const initialNodes: Node[] = useMemo(() => {
    const col0 = 0
    const col1 = 360
    const col2 = 720
    const col3 = 1080
    const rowGap = 180

    const statusLabel =
      isResolved === null ? '(no map)' :
      isResolved ? '[RESOLVED]' : '[OPEN]'

    const statusColor =
      isResolved === null ? '#888' :
      isResolved ? '#2e7d32' : '#c62828'

    const statusDesc =
      isResolved === null
        ? 'threadStatusMap not passed — legacy behaviour'
        : isResolved
          ? 'Thread marked resolved by user in GitHub UI'
          : 'Thread still open — issue not yet addressed'

    const mapDesc =
      !hasMap
        ? 'fetchThreadStatusMap() not called — no GraphQL request'
        : `${state.threadStatusMap.size} thread location(s) indexed\nKey format: path:line → isResolved`

    const chainContent = firstComment
      ? `Conversation Chain 1${isResolved === null ? '' : isResolved ? ' [RESOLVED]' : ' [OPEN]'}:\n${firstComment.body}`
      : '(no chains)'

    const decisionLabel =
      outcome === 'lgtm-open-duplicate' ? 'LGTM — skip (open thread exists)' :
      outcome === 'lgtm-open-fixed' ? 'LGTM — open thread concern addressed' :
      outcome === 'new-comment-regression' ? 'NEW COMMENT — resolved issue resurfaced' :
      outcome === 'lgtm-resolved-fixed' ? 'LGTM — resolved, issue genuinely gone' :
      'Normal review (no status context)'

    return [
      {
        id: 'graphql',
        type: 'dataNode',
        position: {x: col0, y: 0},
        data: {
          label: 'fetchThreadStatusMap',
          type: 'process' as const,
          data: mapDesc,
          description: 'GraphQL reviewThreads → path:line → isResolved'
        }
      },
      {
        id: 'status-map',
        type: 'dataNode',
        position: {x: col1, y: 0},
        data: {
          label: 'ThreadStatusMap',
          type: hasMap ? 'process' as const : 'input' as const,
          data: hasMap
            ? [...state.threadStatusMap.entries()]
                .map(([k, v]) => `${k} → ${v ? 'resolved' : 'open'}`)
                .join('\n') || '(empty)'
            : '(not available)',
          description: hasMap ? `${state.threadStatusMap.size} entries` : 'threadStatusMap = undefined'
        }
      },
      {
        id: 'rest-comments',
        type: 'dataNode',
        position: {x: col0, y: rowGap},
        data: {
          label: 'REST Review Comments',
          type: 'input' as const,
          data: firstComment
            ? `id: ${firstComment.id}\npath: ${firstComment.path}\nline: ${firstComment.line}`
            : '(none)',
          description: 'pulls.listReviewComments (cached per PR)'
        }
      },
      {
        id: 'get-chains',
        type: 'dataNode',
        position: {x: col1, y: rowGap},
        data: {
          label: 'getCommentChainsWithinRange',
          type: 'process' as const,
          data: `threadStatusMap ${hasMap ? 'passed ✓' : 'omitted (undefined)'}`,
          description: 'matches comments by path + line range'
        }
      },
      {
        id: 'thread-status',
        type: 'dataNode',
        position: {x: col2, y: 0},
        data: {
          label: `Thread Status`,
          type: 'process' as const,
          data: `${statusLabel}\n${statusDesc}`,
          description: `key: ${firstComment ? `${firstComment.path}:${firstComment.line}` : 'n/a'}`
        }
      },
      {
        id: 'annotated-chain',
        type: 'dataNode',
        position: {x: col2, y: rowGap},
        data: {
          label: '---comment_chains---',
          type: 'process' as const,
          data: chainContent,
          description: 'injected into review prompt'
        }
      },
      {
        id: 'patch-input',
        type: 'dataNode',
        position: {x: col0, y: rowGap * 2},
        data: {
          label: 'New Hunk',
          type: 'input' as const,
          data: patch.slice(0, 120) + (patch.length > 120 ? '...' : ''),
          description: 'current diff patch being reviewed'
        }
      },
      {
        id: 'prompt-rules',
        type: 'dataNode',
        position: {x: col1, y: rowGap * 2},
        data: {
          label: 'Prompt Rules',
          type: 'process' as const,
          data: `[OPEN]: same issue → LGTM (skip)\n[OPEN]: fixed → LGTM (acknowledge)\n[RESOLVED]: regression → new comment\n[RESOLVED]: fixed → LGTM\nno label → treat as [OPEN]`,
          description: 'reviewFileDiff prompt — "Existing comment chains (MANDATORY)"'
        }
      },
      {
        id: 'ai-decision',
        type: 'dataNode',
        position: {x: col3, y: rowGap},
        data: {
          label: 'AI Decision',
          type: 'output' as const,
          data: decisionLabel,
          description: outcome === 'new-comment-regression'
            ? 'Posts new comment: "Previously resolved concern has resurfaced"'
            : 'Responds LGTM — no new comment posted'
        }
      }
    ]
  }, [state, patch, firstComment, isResolved, hasMap, outcome])

  const initialEdges: Edge[] = useMemo(() => {
    const decisionColor = outcome === 'new-comment-regression' ? '#c62828' : '#2e7d32'
    const statusEdgeColor =
      isResolved === null ? '#888' : isResolved ? '#2e7d32' : '#c62828'

    return [
      {id: 'e-graphql-map', source: 'graphql', target: 'status-map', animated: true},
      {id: 'e-rest-chains', source: 'rest-comments', target: 'get-chains', animated: true},
      {
        id: 'e-map-chains',
        source: 'status-map',
        target: 'get-chains',
        animated: hasMap,
        style: hasMap ? {} : {strokeDasharray: '4 4', stroke: '#bbb'},
        label: hasMap ? 'status map' : 'not passed'
      },
      {
        id: 'e-map-status',
        source: 'status-map',
        target: 'thread-status',
        animated: hasMap,
        style: {stroke: statusEdgeColor}
      },
      {
        id: 'e-chains-annotated',
        source: 'get-chains',
        target: 'annotated-chain',
        animated: true,
        label: isResolved === null ? 'no label' : isResolved ? '[RESOLVED]' : '[OPEN]',
        style: {stroke: statusEdgeColor}
      },
      {id: 'e-patch-rules', source: 'patch-input', target: 'prompt-rules', animated: true},
      {id: 'e-annotated-rules', source: 'annotated-chain', target: 'prompt-rules', animated: true},
      {
        id: 'e-rules-decision',
        source: 'prompt-rules',
        target: 'ai-decision',
        animated: true,
        style: {stroke: decisionColor},
        label: outcome === 'new-comment-regression' ? 'regression → new comment' : 'LGTM'
      }
    ]
  }, [state, isResolved, hasMap, outcome])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const positionsRef = useRef<Record<string, {x: number; y: number}>>({})

  useEffect(() => {
    setNodes(prev => {
      const dragged: Record<string, {x: number; y: number}> = {}
      for (const n of prev) {
        if (positionsRef.current[n.id]) {
          dragged[n.id] = {x: n.position.x, y: n.position.y}
        }
      }
      positionsRef.current = dragged
      return initialNodes.map(n => ({
        ...n,
        position: dragged[n.id] ?? n.position
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
