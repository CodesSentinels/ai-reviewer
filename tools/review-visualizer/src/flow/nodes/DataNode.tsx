import {memo, useState} from 'react'
import {Handle, Position, type NodeProps} from '@xyflow/react'

export interface DataNodeData {
  label: string
  type: 'input' | 'process' | 'output'
  data: unknown
  description?: string
}

const TYPE_COLORS = {
  input: {bg: '#e8f5e9', border: '#4caf50', header: '#2e7d32'},
  process: {bg: '#e3f2fd', border: '#2196f3', header: '#1565c0'},
  output: {bg: '#fff3e0', border: '#ff9800', header: '#e65100'}
} as const

function DataNode({data}: NodeProps & {data: DataNodeData}) {
  const [expanded, setExpanded] = useState(false)
  const colors = TYPE_COLORS[data.type]
  const dataStr =
    typeof data.data === 'string'
      ? data.data
      : JSON.stringify(data.data, null, 2)
  const hasData = dataStr && dataStr !== '""' && dataStr !== 'null'
  const preview =
    hasData && !expanded
      ? dataStr.length > 80
        ? dataStr.slice(0, 80) + '...'
        : dataStr
      : ''

  return (
    <div
      style={{
        background: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: 8,
        minWidth: 200,
        maxWidth: 360,
        fontSize: 12,
        fontFamily: 'monospace',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div
        style={{
          background: colors.header,
          color: '#fff',
          padding: '6px 10px',
          borderRadius: '6px 6px 0 0',
          fontWeight: 600,
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>{data.label}</span>
        {hasData && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 11
            }}
          >
            {expanded ? 'collapse' : 'expand'}
          </button>
        )}
      </div>
      {data.description && (
        <div style={{padding: '4px 10px', color: '#666', fontSize: 11}}>
          {data.description}
        </div>
      )}
      {hasData && (
        <div
          style={{
            padding: '6px 10px',
            maxHeight: expanded ? 400 : 60,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: '#333',
            borderTop: '1px solid rgba(0,0,0,0.08)'
          }}
        >
          {expanded ? dataStr : preview}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export default memo(DataNode)
