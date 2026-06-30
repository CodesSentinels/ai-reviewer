import {useState} from 'react'
import BasicReviewFlow from './panels/BasicReviewFlow'
import IncrementalReview from './panels/IncrementalReview'
import DependencyAnalysis from './panels/DependencyAnalysis'
import CommentChainStatus from './panels/CommentChainStatus'

const TABS = [
  {key: 'basic', label: '1.1 Basic Review Flow'},
  {key: 'incremental', label: '1.2 Incremental Review'},
  {key: 'dependency', label: '1.3 Dependency Analysis'},
  {key: 'comment-chain', label: 'OPT-001 Comment Chain Status'}
] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const [tab, setTab] = useState<TabKey>('basic')

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100vh'}}>
      <nav
        style={{
          display: 'flex',
          gap: 0,
          background: '#1a1a2e',
          padding: '0 16px',
          flexShrink: 0
        }}
      >
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderBottom: tab === t.key ? '3px solid #4fc3f7' : '3px solid transparent',
              background: tab === t.key ? '#16213e' : 'transparent',
              color: tab === t.key ? '#4fc3f7' : '#8899aa',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div style={{flex: 1, overflow: 'hidden'}}>
        {tab === 'basic' && <BasicReviewFlow />}
        {tab === 'incremental' && <IncrementalReview />}
        {tab === 'dependency' && <DependencyAnalysis />}
        {tab === 'comment-chain' && <CommentChainStatus />}
      </div>
    </div>
  )
}
