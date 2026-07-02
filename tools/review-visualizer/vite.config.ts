import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const srcRoot = path.resolve(__dirname, '../../src')
const mockDir = path.resolve(__dirname, 'src/mocks')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {find: '@actions/core', replacement: path.join(mockDir, 'actions-core.ts')},
      {find: '@actions/github', replacement: path.join(mockDir, 'actions-github.ts')},
      {find: /\.\/octokit$/, replacement: path.join(mockDir, 'octokit.ts')},
      {find: /\.\.\/octokit$/, replacement: path.join(mockDir, 'octokit.ts')},
      {find: '@src', replacement: srcRoot}
    ]
  }
})
