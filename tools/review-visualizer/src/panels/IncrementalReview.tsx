import {useState, useMemo} from 'react'
import {
  Commenter,
  COMMIT_ID_START_TAG,
  COMMIT_ID_END_TAG
} from '@src/commenter'
import IncrementalPipeline from '../flow/IncrementalPipeline'

const commenter = new Commenter()

export interface IncrementalState {
  parsedIds: string[]
  block: string
  bodyAfterAdd: string
  highestReviewed: string
  diffStart: string
  reviewMode: string
  intersectedFiles: string[]
  allCommits: string[]
  targetFiles: string[]
  incrementalFiles: string[]
}

const DEFAULT_COMMENT_BODY = `摘要评论内容

${COMMIT_ID_START_TAG}
<!-- abc111 -->
<!-- def222 -->
<!-- ghi333 -->
${COMMIT_ID_END_TAG}`

const DEFAULT_ALL_COMMITS = `abc111
def222
ghi333
jkl444
mno555`

const DEFAULT_TARGET_FILES = `src/review.ts
src/commenter.ts
src/options.ts
package.json`

const DEFAULT_INCREMENTAL_FILES = `src/commenter.ts
src/options.ts
src/new-file.ts`

const PRESETS = {
  'Incremental (has reviewed)': {
    commentBody: DEFAULT_COMMENT_BODY,
    allCommits: DEFAULT_ALL_COMMITS,
    newCommitId: 'mno555',
    reviewMode: 'incremental',
    baseSha: 'base-sha-000',
    targetFiles: DEFAULT_TARGET_FILES,
    incrementalFiles: DEFAULT_INCREMENTAL_FILES
  },
  'First review (empty)': {
    commentBody: '摘要评论内容，尚未有审查记录',
    allCommits: DEFAULT_ALL_COMMITS,
    newCommitId: 'abc111',
    reviewMode: 'incremental',
    baseSha: 'base-sha-000',
    targetFiles: DEFAULT_TARGET_FILES,
    incrementalFiles: DEFAULT_TARGET_FILES
  },
  'Full review (forced)': {
    commentBody: DEFAULT_COMMENT_BODY,
    allCommits: DEFAULT_ALL_COMMITS,
    newCommitId: 'mno555',
    reviewMode: 'full',
    baseSha: 'base-sha-000',
    targetFiles: DEFAULT_TARGET_FILES,
    incrementalFiles: DEFAULT_INCREMENTAL_FILES
  },
  'All reviewed (up to date)': {
    commentBody: `摘要\n${COMMIT_ID_START_TAG}\n<!-- abc111 -->\n<!-- def222 -->\n<!-- ghi333 -->\n<!-- jkl444 -->\n<!-- mno555 -->\n${COMMIT_ID_END_TAG}`,
    allCommits: DEFAULT_ALL_COMMITS,
    newCommitId: '',
    reviewMode: 'incremental',
    baseSha: 'base-sha-000',
    targetFiles: DEFAULT_TARGET_FILES,
    incrementalFiles: ''
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid #ccc',
  borderRadius: 4,
  boxSizing: 'border-box'
}

export default function IncrementalReview() {
  const [preset, setPreset] = useState<PresetKey>('Incremental (has reviewed)')
  const [commentBody, setCommentBody] = useState(DEFAULT_COMMENT_BODY)
  const [allCommitsStr, setAllCommitsStr] = useState(DEFAULT_ALL_COMMITS)
  const [newCommitId, setNewCommitId] = useState('mno555')
  const [reviewMode, setReviewMode] = useState('incremental')
  const [baseSha, setBaseSha] = useState('base-sha-000')
  const [targetFilesStr, setTargetFilesStr] = useState(DEFAULT_TARGET_FILES)
  const [incrementalFilesStr, setIncrementalFilesStr] = useState(
    DEFAULT_INCREMENTAL_FILES
  )

  const applyPreset = (key: PresetKey) => {
    const p = PRESETS[key]
    setPreset(key)
    setCommentBody(p.commentBody)
    setAllCommitsStr(p.allCommits)
    setNewCommitId(p.newCommitId)
    setReviewMode(p.reviewMode)
    setBaseSha(p.baseSha)
    setTargetFilesStr(p.targetFiles)
    setIncrementalFilesStr(p.incrementalFiles)
  }

  const state: IncrementalState = useMemo(() => {
    const parsedIds = commenter.getReviewedCommitIds(commentBody)
    const block = commenter.getReviewedCommitIdsBlock(commentBody)

    const bodyAfterAdd = newCommitId
      ? commenter.addReviewedCommitId(commentBody, newCommitId)
      : commentBody

    const allCommits = allCommitsStr
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    const highestReviewed = commenter.getHighestReviewedCommitId(
      allCommits,
      parsedIds
    )

    const headSha = allCommits[allCommits.length - 1] || ''
    let diffStart: string
    if (reviewMode === 'full') {
      diffStart = baseSha
    } else if (highestReviewed === '' || highestReviewed === headSha) {
      diffStart = baseSha
    } else {
      diffStart = highestReviewed
    }

    const targetFiles = targetFilesStr
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    const incrementalFiles = incrementalFilesStr
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    const intersectedFiles = targetFiles.filter(f =>
      incrementalFiles.includes(f)
    )

    return {
      parsedIds,
      block,
      bodyAfterAdd,
      highestReviewed,
      diffStart,
      reviewMode,
      intersectedFiles,
      allCommits,
      targetFiles,
      incrementalFiles
    }
  }, [
    commentBody,
    allCommitsStr,
    newCommitId,
    reviewMode,
    baseSha,
    targetFilesStr,
    incrementalFilesStr
  ])

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
        <h2 style={{margin: 0, fontSize: 16}}>Incremental Review</h2>

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
            Summary Comment Body{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              ({state.parsedIds.length} reviewed IDs)
            </span>
          </label>
          <textarea
            style={{...textareaStyle, minHeight: 120}}
            value={commentBody}
            onChange={e => setCommentBody(e.target.value)}
          />
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            All PR Commits{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              (one SHA per line)
            </span>
          </label>
          <textarea
            style={textareaStyle}
            value={allCommitsStr}
            onChange={e => setAllCommitsStr(e.target.value)}
          />
        </div>

        <div style={{display: 'flex', gap: 8}}>
          <div style={{flex: 1}}>
            <label style={{fontWeight: 600, fontSize: 12}}>Base SHA</label>
            <input
              style={inputStyle}
              value={baseSha}
              onChange={e => setBaseSha(e.target.value)}
            />
          </div>
          <div style={{flex: 1}}>
            <label style={{fontWeight: 600, fontSize: 12}}>Review Mode</label>
            <select
              style={{...inputStyle, height: 32}}
              value={reviewMode}
              onChange={e => setReviewMode(e.target.value)}
            >
              <option value="incremental">incremental</option>
              <option value="full">full</option>
            </select>
          </div>
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            New Commit to Add
          </label>
          <input
            style={inputStyle}
            value={newCommitId}
            onChange={e => setNewCommitId(e.target.value)}
            placeholder="(leave empty to skip)"
          />
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Target Branch Files{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              (base→HEAD diff)
            </span>
          </label>
          <textarea
            style={textareaStyle}
            value={targetFilesStr}
            onChange={e => setTargetFilesStr(e.target.value)}
          />
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Incremental Files{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              (lastReviewed→HEAD diff)
            </span>
          </label>
          <textarea
            style={textareaStyle}
            value={incrementalFilesStr}
            onChange={e => setIncrementalFilesStr(e.target.value)}
          />
        </div>

        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Intersected Files{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              ({state.intersectedFiles.length} files to review)
            </span>
          </label>
          <div
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              border: '1px solid #e0e0e0',
              borderRadius: 4,
              padding: 6,
              maxHeight: 100,
              overflow: 'auto'
            }}
          >
            {state.intersectedFiles.length === 0 ? (
              <span style={{color: '#888'}}>(no files to review)</span>
            ) : (
              state.intersectedFiles.map((f, i) => (
                <div key={i} style={{color: '#2e7d32'}}>
                  {f}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={{flex: 1, position: 'relative'}}>
        <IncrementalPipeline state={state} />
      </div>
    </div>
  )
}
