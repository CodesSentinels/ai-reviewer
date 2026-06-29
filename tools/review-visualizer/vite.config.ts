import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const srcRoot = path.resolve(__dirname, '../../src')
const mockDir = path.resolve(__dirname, 'src/mocks')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@actions/core': path.join(mockDir, 'actions-core.ts'),
      '@actions/github': path.join(mockDir, 'actions-github.ts'),
      '../../src/octokit': path.join(mockDir, 'octokit.ts'),
      '../octokit': path.join(mockDir, 'octokit.ts'),
      './octokit': path.join(mockDir, 'octokit.ts'),
      '@src': srcRoot
    }
  }
})
