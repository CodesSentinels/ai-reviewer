/**
 * unit-test-framework-detector.test.ts — framework-detector 单元测试
 */
import {describe, expect, test} from '@jest/globals'
import {
  detectFramework,
  type FrameworkRepoSnapshot
} from '../src/unit-test/framework-detector'

function snapshot(
  files: string[],
  deps: Record<string, string> = {},
  extras: Partial<FrameworkRepoSnapshot> = {}
): FrameworkRepoSnapshot {
  return {
    files: new Set(files),
    packageJsonDeps: deps,
    ...extras
  }
}

describe('detectFramework — 配置文件最高优先级', () => {
  test('vitest.config.ts → vitest (high)', () => {
    const r = detectFramework(snapshot(['vitest.config.ts']))
    expect(r.framework).toBe('vitest')
    expect(r.confidence).toBe('high')
  })

  test('jest.config.js → jest (high)', () => {
    const r = detectFramework(snapshot(['jest.config.js']))
    expect(r.framework).toBe('jest')
    expect(r.confidence).toBe('high')
  })

  test('pytest.ini → pytest (high)', () => {
    const r = detectFramework(snapshot(['pytest.ini']))
    expect(r.framework).toBe('pytest')
    expect(r.confidence).toBe('high')
  })

  test('pyproject [tool.pytest] → pytest (high)', () => {
    const r = detectFramework(
      snapshot(['pyproject.toml'], {}, {
        pyprojectToml: '[tool.pytest.ini_options]\nminversion = "6.0"\n'
      })
    )
    expect(r.framework).toBe('pytest')
  })
})

describe('detectFramework — package.json 依赖', () => {
  test('vitest dep → vitest (medium)', () => {
    const r = detectFramework(snapshot([], {vitest: '^1.0.0'}))
    expect(r.framework).toBe('vitest')
    expect(r.confidence).toBe('medium')
  })

  test('jest dep → jest (medium)', () => {
    const r = detectFramework(snapshot([], {jest: '^29.0.0'}))
    expect(r.framework).toBe('jest')
  })

  test('mocha + chai dep → mocha + chai', () => {
    const r = detectFramework(snapshot([], {mocha: '^10', chai: '^4'}))
    expect(r.framework).toBe('mocha')
    expect(r.assertionLibrary).toBe('chai')
  })
})

describe('detectFramework — 文件模式弱信号', () => {
  test('*_test.go → go-testing', () => {
    const r = detectFramework(snapshot(['pkg/foo_test.go']))
    expect(r.framework).toBe('go-testing')
  })

  test('*.test.ts → jest (low)', () => {
    const r = detectFramework(snapshot(['src/foo.test.ts']))
    expect(r.framework).toBe('jest')
    expect(r.confidence).toBe('low')
  })
})

describe('detectFramework — 兜底', () => {
  test('TS 项目无任何信号 → jest (low)', () => {
    const r = detectFramework(snapshot([], {}, {primaryLanguage: 'typescript'}))
    expect(r.framework).toBe('jest')
    expect(r.confidence).toBe('low')
  })

  test('Python 项目无信号 → pytest', () => {
    const r = detectFramework(snapshot([], {}, {primaryLanguage: 'python'}))
    expect(r.framework).toBe('pytest')
  })

  test('Go 项目无信号 → go-testing', () => {
    const r = detectFramework(snapshot([], {}, {primaryLanguage: 'go'}))
    expect(r.framework).toBe('go-testing')
  })
})
