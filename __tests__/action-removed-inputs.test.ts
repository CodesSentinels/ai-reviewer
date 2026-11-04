/**
 * action-removed-inputs.test.ts — 已移除的 Action 输入不能被无意加回来（issue #231）
 *
 * 提示词与路径配置改由目标分支上的 .ai-reviewer.yml 提供，不保留兼容层：
 * 兼容层允许 system_message 整体替换，会让「基线不可变」留下例外。
 * 一旦有人把这些输入加回 action.yml，GitHub 侧就会重新出现一条绕过基线的通道。
 */
import {describe, expect, test} from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const yaml = require('js-yaml')

const actionYml = yaml.load(fs.readFileSync(path.resolve(__dirname, '../action.yml'), 'utf8')) as {
  inputs: Record<string, unknown>
}

describe('action.yml 已移除的输入', () => {
  test.each([
    'system_message',
    'path_filters',
    'path_instructions',
    'summarize',
    'summarize_release_notes'
  ])('不再声明 %s', name => {
    expect(Object.keys(actionYml.inputs)).not.toContain(name)
  })
})
