/**
 * lint/config.ts - .codesentinel.yaml 工具配置解析
 *
 * 配置文件位于仓库根目录，可控制：
 * - 各工具是否启用（覆盖适配器的 defaultEnabled）
 * - 工具特定参数（如 ruff 的 select、eslint 的 useProjectConfig）
 *
 * 设计：
 * - 配置文件不存在或解析失败时，回退到适配器默认值，不阻塞审查
 * - 仅消费 tools 区块；其他区块（未来扩展）由其他模块处理
 */

import {info, warning} from '@actions/core'
import {existsSync, readFileSync} from 'fs'
import * as path from 'path'
// js-yaml 没有发布 @types 子包的本地副本；这里只用一个最小子集，故走轻量声明
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as {load: (raw: string) => unknown}
import {type ToolConfig, type ToolsConfig} from './types'

/** 配置文件名 */
const CONFIG_FILENAMES = ['.codesentinel.yaml', '.codesentinel.yml']

/** 解析后的完整配置 */
export interface CodeSentinelConfig {
  tools: ToolsConfig
}

/**
 * 在仓库根目录查找并加载 .codesentinel.yaml
 *
 * @param repoRoot 仓库根目录
 * @returns 解析后的配置；文件不存在/解析失败时返回空配置
 */
export function loadConfig(repoRoot: string): CodeSentinelConfig {
  for (const name of CONFIG_FILENAMES) {
    const fullPath = path.join(repoRoot, name)
    if (!existsSync(fullPath)) continue

    try {
      const raw = readFileSync(fullPath, 'utf8')
      const parsed = yaml.load(raw) as Record<string, unknown> | null
      if (parsed == null || typeof parsed !== 'object') {
        warning(`lint config: ${name} is empty or not an object, ignoring`)
        return {tools: {}}
      }
      const tools = (parsed.tools as ToolsConfig | undefined) ?? {}
      info(
        `lint config: loaded ${name} with ${Object.keys(tools).length} tool entries`
      )
      return {tools}
    } catch (e) {
      warning(
        `lint config: failed to parse ${name}: ${
          e instanceof Error ? e.message : String(e)
        }, falling back to defaults`
      )
      return {tools: {}}
    }
  }
  info('lint config: no .codesentinel.yaml found, using adapter defaults')
  return {tools: {}}
}

/**
 * 解析单个工具的 enabled 状态
 *
 * 优先级：用户配置 > 适配器默认值
 */
export function isToolEnabled(
  toolName: string,
  config: ToolsConfig,
  defaultEnabled: boolean
): boolean {
  const cfg = config[toolName]
  if (cfg == null) return defaultEnabled
  if (typeof cfg.enabled === 'boolean') return cfg.enabled
  return defaultEnabled
}

/** 获取工具配置（不存在时返回空对象） */
export function getToolConfig(
  toolName: string,
  config: ToolsConfig
): ToolConfig {
  return config[toolName] ?? {}
}
