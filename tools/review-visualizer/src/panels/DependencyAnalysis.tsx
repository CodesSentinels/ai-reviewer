import {useState, useMemo} from 'react'
import {runPipeline, type PipelineState} from '../engine/adapters'
import ReviewPipeline from '../flow/ReviewPipeline'

const DEFAULT_DIFF = `@@ -1,5 +1,10 @@
+export function formatPrice(amount: number): string {
+  return amount.toFixed(2)
+}
+export const MAX_RETRY = 3`

const DEFAULT_SOURCE = `import { ref } from 'vue'
import { useApi } from '~/composables/useApi'

export function formatPrice(amount: number): string {
  return amount.toFixed(2)
}

export const MAX_RETRY = 3

function internalHelper() {
  return 'not exported'
}`

const DEFAULT_REF = `import { formatPrice, MAX_RETRY } from '~/utils/format'

const display = formatPrice(100)
console.log('retries:', MAX_RETRY)

function checkout() {
  const total = formatPrice(599.9)
  return total
}`

const PRESETS = {
  'TS exports': {
    sourceFilename: 'utils/format.ts',
    refFilename: 'pages/shop.vue',
    diff: DEFAULT_DIFF,
    source: DEFAULT_SOURCE,
    ref: DEFAULT_REF
  },
  'Vue SFC': {
    sourceFilename: 'components/PriceTag.vue',
    refFilename: 'pages/product.vue',
    diff: `@@ -1,3 +1,8 @@
+export function usePrice(amount: number) {
+  return computed(() => amount.toFixed(2))
+}`,
    source: `<template>
  <span>{{ price }}</span>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useApi } from '~/composables/useApi'

export function usePrice(amount: number) {
  return computed(() => amount.toFixed(2))
}

const price = usePrice(100)
</script>
<style scoped>
span { color: green; }
</style>`,
    ref: `<script setup lang="ts">
import { usePrice } from '~/components/PriceTag.vue'
const total = usePrice(299)
</script>
<template><div>{{ total }}</div></template>`
  },
  'Class export': {
    sourceFilename: 'services/user.ts',
    refFilename: 'controllers/auth.ts',
    diff: `@@ -1,3 +1,8 @@
+export class UserService {
+  async getUser(id: string) { return { id, name: 'test' } }
+  async deleteUser(id: string) { return true }
+}`,
    source: `export class UserService {
  async getUser(id: string) { return { id, name: 'test' } }
  async deleteUser(id: string) { return true }
}

export interface UserProfile {
  id: string
  name: string
}`,
    ref: `import { UserService } from '../services/user'

const svc = new UserService()
const user = await svc.getUser('123')
console.log(user)`
  },
  'No references': {
    sourceFilename: 'utils/internal.ts',
    refFilename: 'app.ts',
    diff: `@@ -1,3 +1,5 @@
+export function helper() { return 42 }`,
    source: `export function helper() { return 42 }`,
    ref: `import { something } from './other'
console.log(something())`
  }
}

type PresetKey = keyof typeof PRESETS

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 120,
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

export default function DependencyAnalysis() {
  const [preset, setPreset] = useState<PresetKey>('TS exports')
  const [sourceFilename, setSourceFilename] = useState(
    PRESETS['TS exports'].sourceFilename
  )
  const [refFilename, setRefFilename] = useState(
    PRESETS['TS exports'].refFilename
  )
  const [diffPatch, setDiffPatch] = useState(DEFAULT_DIFF)
  const [sourceContent, setSourceContent] = useState(DEFAULT_SOURCE)
  const [refContent, setRefContent] = useState(DEFAULT_REF)

  const applyPreset = (key: PresetKey) => {
    const p = PRESETS[key]
    setPreset(key)
    setSourceFilename(p.sourceFilename)
    setRefFilename(p.refFilename)
    setDiffPatch(p.diff)
    setSourceContent(p.source)
    setRefContent(p.ref)
  }

  const pipelineState: PipelineState = useMemo(() => {
    try {
      return runPipeline({
        diffPatch,
        sourceFilename,
        sourceContent,
        refFilename,
        refContent
      })
    } catch (e) {
      console.error('Pipeline error:', e)
      return {
        vueScriptContent: '',
        imports: [],
        symbols: [],
        references: [],
        formattedContext: `Error: ${e}`
      }
    }
  }, [diffPatch, sourceFilename, sourceContent, refFilename, refContent])

  return (
    <div style={{display: 'flex', height: '100%', overflow: 'hidden'}}>
      {/* Left panel */}
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
        <h2 style={{margin: 0, fontSize: 16}}>
          Cross-File Dependency Analysis
        </h2>

        {/* Presets */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>Presets</label>
          <div style={{display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4}}>
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

        {/* Source filename */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>Source Filename</label>
          <input
            style={inputStyle}
            value={sourceFilename}
            onChange={e => setSourceFilename(e.target.value)}
          />
        </div>

        {/* Diff patch */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Diff Patch{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              ({pipelineState.symbols.length} symbols)
            </span>
          </label>
          <textarea
            style={textareaStyle}
            value={diffPatch}
            onChange={e => setDiffPatch(e.target.value)}
          />
        </div>

        {/* Source content */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Source Content{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              ({pipelineState.imports.length} imports)
            </span>
          </label>
          <textarea
            style={{...textareaStyle, minHeight: 150}}
            value={sourceContent}
            onChange={e => setSourceContent(e.target.value)}
          />
        </div>

        {/* Ref filename */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Reference Filename
          </label>
          <input
            style={inputStyle}
            value={refFilename}
            onChange={e => setRefFilename(e.target.value)}
          />
        </div>

        {/* Ref content */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Reference File Content{' '}
            <span style={{fontWeight: 400, color: '#888'}}>
              ({pipelineState.references.length} refs)
            </span>
          </label>
          <textarea
            style={textareaStyle}
            value={refContent}
            onChange={e => setRefContent(e.target.value)}
          />
        </div>

        {/* Formatted output */}
        <div>
          <label style={{fontWeight: 600, fontSize: 12}}>
            Formatted Output
          </label>
          <pre
            style={{
              background: '#263238',
              color: '#e0e0e0',
              padding: 10,
              borderRadius: 4,
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 200,
              overflow: 'auto',
              margin: 0
            }}
          >
            {pipelineState.formattedContext || '(no output)'}
          </pre>
        </div>
      </div>

      {/* Right panel — flow diagram */}
      <div style={{flex: 1, position: 'relative'}}>
        <ReviewPipeline
          state={pipelineState}
          sourceFilename={sourceFilename}
          refFilename={refFilename}
        />
      </div>
    </div>
  )
}
