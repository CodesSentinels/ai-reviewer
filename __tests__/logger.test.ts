/**
 * Logger 单元测试（ARCH-012~015）
 *
 * 覆盖：
 * - Logger 接口 + singleton（setLogger/getLogger/resetLogger）
 * - GitHubLogger 委托 @actions/core
 * - GitLabLogger 输出到 console，不 import @actions/core
 * - ARCH-015：GitLabLogger 模块不含 @actions/core 依赖
 */
import {describe, expect, test, jest, beforeEach} from '@jest/globals'
import {
  type Logger,
  setLogger,
  getLogger,
  resetLogger
} from '../src/platform/logger'

describe('Logger singleton', () => {
  beforeEach(() => {
    resetLogger()
  })

  test('默认 logger 使用 console（不抛错）', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    getLogger().info('hello')
    expect(spy).toHaveBeenCalledWith('hello')
    spy.mockRestore()
  })

  test('setLogger 替换全局实例', () => {
    const mock: Logger = {
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }
    setLogger(mock)
    getLogger().info('test')
    getLogger().warning('warn')
    getLogger().error('err')
    getLogger().debug('dbg')
    expect(mock.info).toHaveBeenCalledWith('test')
    expect(mock.warning).toHaveBeenCalledWith('warn')
    expect(mock.error).toHaveBeenCalledWith('err')
    expect(mock.debug).toHaveBeenCalledWith('dbg')
  })

  test('resetLogger 恢复为 console logger', () => {
    const mock: Logger = {
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }
    setLogger(mock)
    resetLogger()
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    getLogger().info('after reset')
    expect(spy).toHaveBeenCalledWith('after reset')
    expect(mock.info).not.toHaveBeenCalledWith('after reset')
    spy.mockRestore()
  })
})

describe('GitHubLogger（ARCH-013）', () => {
  // mock @actions/core 防止真正调用
  const coreInfo = jest.fn()
  const coreWarning = jest.fn()
  const coreError = jest.fn()
  const coreDebug = jest.fn()
  jest.mock('@actions/core', () => ({
    info: (...a: any[]) => coreInfo(...a),
    warning: (...a: any[]) => coreWarning(...a),
    error: (...a: any[]) => coreError(...a),
    debug: (...a: any[]) => coreDebug(...a)
  }))

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('委托 @actions/core 的 info/warning/error/debug', async () => {
    const {GitHubLogger} = await import('../src/platform/github-logger')
    const logger = new GitHubLogger()

    logger.info('i')
    logger.warning('w')
    logger.error('e')
    logger.debug('d')

    expect(coreInfo).toHaveBeenCalledWith('i')
    expect(coreWarning).toHaveBeenCalledWith('w')
    expect(coreError).toHaveBeenCalledWith('e')
    expect(coreDebug).toHaveBeenCalledWith('d')
  })
})

describe('GitLabLogger（ARCH-014/015）', () => {
  beforeEach(() => {
    delete process.env.AI_REVIEWER_DEBUG
  })

  test('info 输出到 console.log', async () => {
    const {GitLabLogger} = await import('../src/platform/gitlab-logger')
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    new GitLabLogger().info('hello gitlab')
    expect(spy).toHaveBeenCalledWith('hello gitlab')
    spy.mockRestore()
  })

  test('warning 带 [WARNING] 前缀输出到 console.warn', async () => {
    const {GitLabLogger} = await import('../src/platform/gitlab-logger')
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    new GitLabLogger().warning('caution')
    expect(spy).toHaveBeenCalledWith('[WARNING] caution')
    spy.mockRestore()
  })

  test('error 带 [ERROR] 前缀输出到 console.error', async () => {
    const {GitLabLogger} = await import('../src/platform/gitlab-logger')
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    new GitLabLogger().error('fail')
    expect(spy).toHaveBeenCalledWith('[ERROR] fail')
    spy.mockRestore()
  })

  test('debug 在 AI_REVIEWER_DEBUG=true 时输出', async () => {
    process.env.AI_REVIEWER_DEBUG = 'true'
    const {GitLabLogger} = await import('../src/platform/gitlab-logger')
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    new GitLabLogger().debug('trace')
    expect(spy).toHaveBeenCalledWith('[DEBUG] trace')
    spy.mockRestore()
  })

  test('debug 在未设置 AI_REVIEWER_DEBUG 时不输出', async () => {
    const {GitLabLogger} = await import('../src/platform/gitlab-logger')
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    new GitLabLogger().debug('silent')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('ARCH-015: gitlab-logger.ts 源码不 import @actions/core 或 @actions/github', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/platform/gitlab-logger.ts'),
      'utf8'
    )
    expect(source).not.toContain("from '@actions/core'")
    expect(source).not.toContain("from '@actions/github'")
  })
})
