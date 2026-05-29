/**
 * unit-test/fs-reader.ts - 本地仓库快照 FsReader 实现
 *
 * Actions 运行时已经 `actions/checkout` 过仓库，源码就在 process.cwd()。
 * 因此本地文件系统是优于 GitHub API 的来源（更快、零配额）。
 *
 * 失败安全:
 * - 任何 IO 异常都返回 null / 空数组，不向上抛
 */
import {warning} from '@actions/core'
import * as fs from 'fs/promises'
import * as path from 'path'
import type {FsReader} from './context-collector'

/**
 * 不会带来有用上下文的目录，统一在 walk 时 prune，避免大型 monorepo 扫描超时。
 * - 各语言依赖目录: node_modules / vendor / target
 * - 构建产物: dist / build / out / .next
 * - 工具产物: coverage / .git / .turbo / .cache
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
  '.git'
])

export class LocalFsReader implements FsReader {
  constructor(private readonly root: string = process.cwd()) {}

  async readFile(relativePath: string): Promise<string | null> {
    try {
      const abs = path.join(this.root, relativePath)
      return await fs.readFile(abs, 'utf-8')
    } catch (e) {
      return null
    }
  }

  async list(prefix: string, suffix: string): Promise<string[]> {
    const absPrefix = path.join(this.root, prefix || '.')
    try {
      const stat = await fs.stat(absPrefix)
      if (!stat.isDirectory()) return []
    } catch {
      return []
    }
    const out: string[] = []
    await this.walk(absPrefix, prefix || '', suffix, out, 0)
    return out
  }

  private async walk(
    absDir: string,
    relDir: string,
    suffix: string,
    out: string[],
    depth: number
  ): Promise<void> {
    if (depth > 4) return
    let entries
    try {
      entries = await fs.readdir(absDir, {withFileTypes: true})
    } catch (e) {
      warning(`unit-test/fs-reader: readdir failed ${absDir}: ${String(e)}`)
      return
    }
    for (const ent of entries) {
      if (SKIP_DIRS.has(ent.name)) continue
      if (ent.name.startsWith('.')) continue
      const childRel = relDir ? `${relDir}/${ent.name}` : ent.name
      const childAbs = path.join(absDir, ent.name)
      if (ent.isDirectory()) {
        await this.walk(childAbs, childRel, suffix, out, depth + 1)
      } else if (ent.isFile() && ent.name.includes(suffix)) {
        out.push(childRel)
      }
    }
  }

  /**
   * 探测仓库根下是否存在特定路径（同步快速判断），供 framework-detector 使用。
   */
  async fileExists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.root, relativePath))
      return true
    } catch {
      return false
    }
  }
}
