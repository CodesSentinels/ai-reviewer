/**
 * log-section.test.ts — 审查 job 日志按阶段分段（#140「运行效率」E）
 */
import {describe, expect, test, jest, afterEach} from '@jest/globals'
import {resetLogger, setLogger, type Logger} from '../src/platform/logger'
import {beginLogSection, endLogSection} from '../src/platform/log-section'
import {GitLabLogger} from '../src/platform/gitlab-logger'

function recorder(): {logger: Logger; events: string[]} {
  const events: string[] = []
  const logger: Logger = {
    info: () => {},
    warning: () => {},
    error: () => {},
    debug: () => {},
    startSection: (id, title) => events.push(`start:${id}:${title}`),
    endSection: id => events.push(`end:${id}`)
  }
  return {logger, events}
}

afterEach(() => {
  endLogSection()
  resetLogger()
  jest.restoreAllMocks()
})

describe('beginLogSection / endLogSection', () => {
  test('切换分段时先结束上一段；同名重复进入不重开；结束后再结束无副作用', () => {
    const {logger, events} = recorder()
    setLogger(logger)

    beginLogSection('a', 'A')
    beginLogSection('a', 'A')
    beginLogSection('b', 'B')
    endLogSection()
    endLogSection()

    expect(events).toEqual(['start:a:A', 'end:a', 'start:b:B', 'end:b'])
  })

  test('Logger 没实现分段：不报错', () => {
    setLogger({info: () => {}, warning: () => {}, error: () => {}, debug: () => {}})
    expect(() => {
      beginLogSection('a', 'A')
      endLogSection()
    }).not.toThrow()
  })

  test('分段输出抛错：吞掉，不影响审查', () => {
    setLogger({
      info: () => {},
      warning: () => {},
      error: () => {},
      debug: () => {},
      startSection: () => {
        throw new Error('boom')
      },
      endSection: () => {
        throw new Error('boom')
      }
    })
    expect(() => {
      beginLogSection('a', 'A')
      endLogSection()
    }).not.toThrow()
  })
})

describe('GitLabLogger 分段格式', () => {
  test('section_start（默认折叠）与 section_end 成对，id 一致', () => {
    const lines: string[] = []
    jest.spyOn(console, 'log').mockImplementation((m: any) => void lines.push(String(m)))
    const l = new GitLabLogger()

    l.startSection('ai_review_summarize', 'Summarize changes')
    l.endSection('ai_review_summarize')

    expect(lines[0]).toMatch(
      /^\x1b\[0Ksection_start:\d+:ai_review_summarize\[collapsed=true\]\r\x1b\[0KSummarize changes$/
    )
    expect(lines[1]).toMatch(/^\x1b\[0Ksection_end:\d+:ai_review_summarize\r\x1b\[0K$/)
  })
})
