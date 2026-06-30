import {useState, useMemo} from 'react'
import CommentChainStatusFlow from '../flow/CommentChainStatusFlow'

export interface CommentEntry {
  id: number
  path: string
  line: number
  body: string
  /** resolved state from GraphQL threadStatusMap */
  isResolved: boolean | null  // null = not in map (legacy)
}

export interface ChainStatusState {
  comments: CommentEntry[]
  threadStatusMap: Map<string, boolean>
  annotatedChains: string
  aiDecision: string
}

const PRESETS = {
  'Open thread (same issue)': {
    description: '已有 [OPEN] 评论，AI 发现同一问题 → 应跳过，不重复评论',
    comments: [
      {
        id: 1,
        path: 'src/api.ts',
        line: 12,
        body: '<!-- AI Reviewer --> SQL 注入风险：用户输入直接拼接到查询语句',
        isResolved: false
      }
    ],
    patch: `10: export function getUser(id: string) {
11:   const db = getDb()
12:   const query = \`SELECT * FROM users WHERE id = '\${id}'\`
13:   return db.execute(query)
14: }`,
    aiInstruction: '当前 patch 的问题与 [OPEN] 评论相同（SQL 注入），AI 应回复 LGTM 而非新建评论'
  },
  'Resolved thread (regression)': {
    description: '问题曾被 resolved，但代码回归 → AI 应写新评论说明问题复现',
    comments: [
      {
        id: 2,
        path: 'src/api.ts',
        line: 12,
        body: '<!-- AI Reviewer --> SQL 注入风险：用户输入直接拼接到查询语句',
        isResolved: true
      }
    ],
    patch: `10: export function getUser(id: string) {
11:   const db = getDb()
12:   const query = \`SELECT * FROM users WHERE id = '\${id}'\`
13:   return db.execute(query)
14: }`,
    aiInstruction: 'thread 已被 resolved，但同一问题仍在新 hunk 中 → AI 应写新评论说明问题复现'
  },
  'Open thread (fixed)': {
    description: '已有 [OPEN] 评论，但新代码已修复该问题 → AI 应 LGTM',
    comments: [
      {
        id: 3,
        path: 'src/api.ts',
        line: 12,
        body: '<!-- AI Reviewer --> SQL 注入风险：用户输入直接拼接到查询语句',
        isResolved: false
      }
    ],
    patch: `10: export function getUser(id: string) {
11:   const db = getDb()
12:   const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
13:   return stmt.execute([id])
14: }`,
    aiInstruction: '同一行的 [OPEN] 评论提到 SQL 注入，新代码已改用参数化查询 → AI 应 LGTM，说明修复解决了评论的问题'
  },
  'No map (legacy)': {
    description: '无 threadStatusMap（旧行为）→ 链无标签，AI 按原有逻辑处理',
    comments: [
      {
        id: 4,
        path: 'src/api.ts',
        line: 12,
        body: '<!-- AI Reviewer --> SQL 注入风险',
        isResolved: null
      }
    ],
    patch: `12:   const query = \`SELECT * FROM users WHERE id = '\${id}'\``,
    aiInstruction: 'threadStatusMap 未传入，链无 [OPEN]/[RESOLVED] 标签，AI 按普通上下文处理（原有行为）'
  }
} as const

type PresetKey = keyof typeof PRESETS

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 80,
  fontFamily: 'monospace',
  fontSize: 12,
  padding: 8,
  border: '1px solid #ccc',
  borderRadius: 4,
  resize: 'vertical',
  boxSizing: 'border-box'
}

function buildAnnotatedChains(
  comments: CommentEntry[],
  hasMap: boolean
): string {
  if (comments.length === 0) return '(no existing comment chains)'

  return comments
    .map((c, i) => {
      let statusLabel = ''
      if (hasMap && c.isResolved !== null) {
        statusLabel = c.isResolved ? ' [RESOLVED]' : ' [OPEN]'
      }
      return `Conversation Chain ${i + 1}${statusLabel}:\nreviewer: ${c.body}\n---`
    })
    .join('\n')
}

function buildAiDecision(
  comments: CommentEntry[],
  hasMap: boolean,
  patch: string
): string {
  if (comments.length === 0) return 'Normal review — no existing chains.'

  const c = comments[0]
  if (!hasMap || c.isResolved === null) {
    return '⚠️  No status label — AI treats as regular context (may duplicate).'
  }
  if (!c.isResolved) {
    // Open thread
    const isFixed = patch.includes('prepare') || patch.includes('?')
    if (isFixed) {
      return '✅  [OPEN] thread detected. New code uses parameterized query — issue fixed.\nAI Decision: LGTM (addresses the concern in the open thread)'
    }
    return '⏭️  [OPEN] thread detected. Same issue still present in new hunk.\nAI Decision: LGTM (open thread already covers this — no duplicate comment)'
  } else {
    // Resolved thread — check if issue is still there
    const isFixed = patch.includes('prepare') || patch.includes('?')
    if (isFixed) {
      return '✅  [RESOLVED] thread. Issue genuinely gone in new hunk.\nAI Decision: LGTM'
    }
    return '🔁  [RESOLVED] thread. Same problem found in new hunk (regression).\nAI Decision: Write new comment — "Previously resolved concern has resurfaced"'
  }
}

export default function CommentChainStatus() {
  const [preset, setPreset] = useState<PresetKey>('Open thread (same issue)')
  const [patch, setPatch] = useState(PRESETS['Open thread (same issue)'].patch)
  const [comments, setComments] = useState<CommentEntry[]>(
    PRESETS['Open thread (same issue)'].comments as unknown as CommentEntry[]
  )

  const applyPreset = (key: PresetKey) => {
    const p = PRESETS[key]
    setPreset(key)
    setPatch(p.patch)
    setComments(p.comments as unknown as CommentEntry[])
  }

  const state: ChainStatusState = useMemo(() => {
    const hasMap = comments.some(c => c.isResolved !== null)
    const threadStatusMap = new Map<string, boolean>()
    for (const c of comments) {
      if (c.isResolved !== null) {
        const key = `${c.path}:${c.line}`
        if (!threadStatusMap.has(key) || !c.isResolved) {
          threadStatusMap.set(key, c.isResolved)
        }
      }
    }

    const annotatedChains = buildAnnotatedChains(comments, hasMap)
    const aiDecision = buildAiDecision(comments, hasMap, patch)

    return {comments, threadStatusMap, annotatedChains, aiDecision}
  }, [comments, patch])

  const toggleResolved = (id: number) => {
    setComments(prev =>
      prev.map(c => {
        if (c.id !== id) return c
        const next: boolean | null =
          c.isResolved === null ? false : c.isResolved === false ? true : null
        return {...c, isResolved: next}
      })
    )
    setPreset('Open thread (same issue)')  // unset preset when manually editing
  }

  return (
    <div style={{display: 'flex', height: '100%', overflow: 'hidden'}}>
      {/* Left panel */}
      <div
        style={{
          width: 400,
          minWidth: 320,
          borderRight: '2px solid #e0e0e0',
          overflow: 'auto',
          padding: 16,
          background: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <h2 style={{margin: 0, fontSize: 16}}>Comment Chain Status (OPT-001)</h2>
        <p style={{margin: 0, fontSize: 12, color: '#555', lineHeight: 1.5}}>
          模拟 <code>fetchThreadStatusMap</code> + <code>getCommentChainsWithinRange</code> 给评论链打 [OPEN]/[RESOLVED] 标签，
          展示 AI 在不同状态下的决策差异。
        </p>

        {/* Presets */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>场景预设</label>
          <div style={{display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4}}>
            {(Object.keys(PRESETS) as PresetKey[]).map(key => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #ccc',
                  background: preset === key ? '#1565c0' : '#fff',
                  color: preset === key ? '#fff' : '#333',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {key}
              </button>
            ))}
          </div>
          {preset !== 'No map (legacy)' && (
            <p style={{margin: '6px 0 0', fontSize: 11, color: '#666'}}>
              {PRESETS[preset].description}
            </p>
          )}
        </div>

        {/* Existing comments */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Existing Review Comments{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              (点击状态切换 null → false → true → null)
            </span>
          </label>
          <div style={{display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4}}>
            {comments.map(c => {
              const statusColor =
                c.isResolved === null ? '#888' :
                c.isResolved ? '#2e7d32' : '#c62828'
              const statusText =
                c.isResolved === null ? 'no map' :
                c.isResolved ? 'RESOLVED' : 'OPEN'
              return (
                <div
                  key={c.id}
                  style={{
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    padding: 8,
                    fontSize: 11,
                    background: '#fff'
                  }}
                >
                  <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}>
                    <span style={{fontFamily: 'monospace', color: '#555'}}>
                      {c.path}:{c.line}
                    </span>
                    <button
                      onClick={() => toggleResolved(c.id)}
                      style={{
                        padding: '2px 8px',
                        fontSize: 11,
                        borderRadius: 4,
                        border: `1px solid ${statusColor}`,
                        background: '#fff',
                        color: statusColor,
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      {statusText}
                    </button>
                  </div>
                  <div style={{fontFamily: 'monospace', color: '#333', wordBreak: 'break-word'}}>
                    {c.body}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Patch being reviewed */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>New Hunk (being reviewed)</label>
          <textarea
            style={textareaStyle}
            value={patch}
            onChange={e => setPatch(e.target.value)}
          />
        </div>

        {/* Annotated chains output */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Injected <code>---comment_chains---</code>
          </label>
          <pre
            style={{
              background: '#263238',
              color: '#e0e0e0',
              padding: 10,
              borderRadius: 4,
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 150,
              overflow: 'auto',
              margin: 0
            }}
          >
            {state.annotatedChains}
          </pre>
        </div>

        {/* AI Decision */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>AI 决策（依据 prompt 规则）</label>
          <pre
            style={{
              background: '#1b2a1b',
              color: '#a5d6a7',
              padding: 10,
              borderRadius: 4,
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0
            }}
          >
            {state.aiDecision}
          </pre>
        </div>
      </div>

      {/* Right panel — flow diagram */}
      <div style={{flex: 1, position: 'relative'}}>
        <CommentChainStatusFlow state={state} patch={patch} />
      </div>
    </div>
  )
}
