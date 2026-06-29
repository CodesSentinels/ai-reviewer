import {useState, useMemo} from 'react'
import {
  getReviewStateFromBody,
  writeReviewStateToBody
} from '@src/review-state'
import {PathFilter} from '@src/options'
import {
  COMMIT_ID_START_TAG,
  COMMIT_ID_END_TAG,
  RAW_SUMMARY_START_TAG,
  RAW_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  SUMMARIZE_TAG
} from '@src/commenter'
import ReviewFlowPipeline from '../flow/ReviewFlowPipeline'

const TRIAGE_REGEX = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/

interface FlowState {
  hasIgnore: boolean
  reviewState: 'active' | 'paused'
  bodyAfterWrite: string
  pathResults: Array<{path: string; pass: boolean}>
  triageResult: string | null
  summaryAfterTriage: string
  tags: {
    summarize: string
    rawSummaryStart: string
    rawSummaryEnd: string
    shortSummaryStart: string
    shortSummaryEnd: string
    commitIdStart: string
    commitIdEnd: string
  }
}

const DEFAULT_PR_BODY = `这是一个测试 PR 描述。

实现了用户登录功能。`

const DEFAULT_FILTER_RULES = `**/*.ts
**/*.vue
**/*.js
!**/*.test.ts
!node_modules/**
!dist/**`

const DEFAULT_FILES = `src/review.ts
src/commenter.ts
components/App.vue
src/index.test.ts
node_modules/lodash/index.ts
dist/index.js
assets/logo.png
styles/main.css`

const DEFAULT_SUMMARY_RESP = `文件实现了用户登录的核心逻辑，包括输入验证和 token 生成。

[TRIAGE]: NEEDS_REVIEW`

const PRESETS = {
  Normal: {
    prBody: DEFAULT_PR_BODY,
    filterRules: DEFAULT_FILTER_RULES,
    files: DEFAULT_FILES,
    summaryResp: DEFAULT_SUMMARY_RESP
  },
  'With ignore': {
    prBody: `这是一个自动生成的 PR。\n\n@codesentinel: ignore\n\n不需要审查。`,
    filterRules: DEFAULT_FILTER_RULES,
    files: DEFAULT_FILES,
    summaryResp: DEFAULT_SUMMARY_RESP
  },
  Paused: {
    prBody: `PR 描述\n\n<!-- codesentinel-review-state:start -->\nstate: paused\n<!-- codesentinel-review-state:end -->`,
    filterRules: DEFAULT_FILTER_RULES,
    files: DEFAULT_FILES,
    summaryResp: DEFAULT_SUMMARY_RESP
  },
  Approved: {
    prBody: DEFAULT_PR_BODY,
    filterRules: DEFAULT_FILTER_RULES,
    files: DEFAULT_FILES,
    summaryResp: `简单的配置变更，无需额外审查。\n\n[TRIAGE]: APPROVED`
  }
}

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

export default function BasicReviewFlow() {
  const [preset, setPreset] = useState<PresetKey>('Normal')
  const [prBody, setPrBody] = useState(DEFAULT_PR_BODY)
  const [filterRules, setFilterRules] = useState(DEFAULT_FILTER_RULES)
  const [files, setFiles] = useState(DEFAULT_FILES)
  const [summaryResp, setSummaryResp] = useState(DEFAULT_SUMMARY_RESP)

  const applyPreset = (key: PresetKey) => {
    const p = PRESETS[key]
    setPreset(key)
    setPrBody(p.prBody)
    setFilterRules(p.filterRules)
    setFiles(p.files)
    setSummaryResp(p.summaryResp)
  }

  const flowState: FlowState = useMemo(() => {
    const hasIgnore = prBody.includes('@codesentinel: ignore')
    const reviewState = getReviewStateFromBody(prBody)
    const bodyAfterWrite = writeReviewStateToBody(prBody, reviewState)

    const rules = filterRules
      .split('\n')
      .map(r => r.trim())
      .filter(Boolean)
    const filter = new PathFilter(rules.length > 0 ? rules : null)
    const fileList = files
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean)
    const pathResults = fileList.map(path => ({
      path,
      pass: filter.check(path)
    }))

    const triageMatch = summaryResp.match(TRIAGE_REGEX)
    const triageResult = triageMatch ? triageMatch[1] : null
    const summaryAfterTriage = summaryResp.replace(TRIAGE_REGEX, '').trim()

    return {
      hasIgnore,
      reviewState,
      bodyAfterWrite,
      pathResults,
      triageResult,
      summaryAfterTriage,
      tags: {
        summarize: SUMMARIZE_TAG,
        rawSummaryStart: RAW_SUMMARY_START_TAG,
        rawSummaryEnd: RAW_SUMMARY_END_TAG,
        shortSummaryStart: SHORT_SUMMARY_START_TAG,
        shortSummaryEnd: SHORT_SUMMARY_END_TAG,
        commitIdStart: COMMIT_ID_START_TAG,
        commitIdEnd: COMMIT_ID_END_TAG
      }
    }
  }, [prBody, filterRules, files, summaryResp])

  const passCount = flowState.pathResults.filter(r => r.pass).length
  const totalCount = flowState.pathResults.length

  return (
    <div style={{display: 'flex', height: '100%', overflow: 'hidden'}}>
      <div
        style={{
          width: 360,
          minWidth: 300,
          borderRight: '2px solid #e0e0e0',
          overflow: 'auto',
          padding: 16,
          background: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <h2 style={{margin: 0, fontSize: 16}}>Basic PR Review Flow</h2>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>Presets</label>
          <div
            style={{display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4}}
          >
            {Object.keys(PRESETS).map(key => (
              <button
                key={key}
                onClick={() => applyPreset(key as PresetKey)}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #ccc',
                  background: preset === key ? '#1565c0' : '#fff',
                  color: preset === key ? '#fff' : '#333',
                  cursor: 'pointer'
                }}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            PR Body{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              (state: {flowState.reviewState}, ignore:{' '}
              {flowState.hasIgnore ? 'YES' : 'no'})
            </span>
          </label>
          <textarea
            style={textareaStyle}
            value={prBody}
            onChange={e => setPrBody(e.target.value)}
          />
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            PathFilter Rules{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              (one per line)
            </span>
          </label>
          <textarea
            style={textareaStyle}
            value={filterRules}
            onChange={e => setFilterRules(e.target.value)}
          />
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            File Paths{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              ({passCount}/{totalCount} pass)
            </span>
          </label>
          <textarea
            style={{...textareaStyle, minHeight: 100}}
            value={files}
            onChange={e => setFiles(e.target.value)}
          />
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Filter Results
          </label>
          <div
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              maxHeight: 120,
              overflow: 'auto',
              border: '1px solid #e0e0e0',
              borderRadius: 4,
              padding: 6
            }}
          >
            {flowState.pathResults.map((r, i) => (
              <div key={i} style={{color: r.pass ? '#2e7d32' : '#c62828'}}>
                {r.pass ? '✓' : '✗'} {r.path}
              </div>
            ))}
          </div>
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            LightBot Summary Response{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              (triage: {flowState.triageResult ?? 'NEEDS_REVIEW (default)'})
            </span>
          </label>
          <textarea
            style={textareaStyle}
            value={summaryResp}
            onChange={e => setSummaryResp(e.target.value)}
          />
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Summary After Triage Removal
          </label>
          <pre
            style={{
              background: '#263238',
              color: '#e0e0e0',
              padding: 10,
              borderRadius: 4,
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              maxHeight: 100,
              overflow: 'auto',
              margin: 0
            }}
          >
            {flowState.summaryAfterTriage}
          </pre>
        </div>
      </div>

      <div style={{flex: 1, position: 'relative'}}>
        <ReviewFlowPipeline state={flowState} />
      </div>
    </div>
  )
}

export type {FlowState}
