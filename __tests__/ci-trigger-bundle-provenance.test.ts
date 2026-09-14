/**
 * ci-trigger-bundle-provenance.test.ts — CI 产物来源（§14.4 TEST-040）
 *
 * TEST-040 两个子句各有归宿，但覆盖强度不一样：
 *
 *   「MR 临时 bundle 只验证不复用」
 *       gitlab-ci-config.test.ts 断言两个 job 都没有 needs/dependencies
 *   「protected trigger 只接受可信 bundle」
 *       gitlab-ci-config.test.ts 断言脚本里**出现了** `git merge-base
 *       --is-ancestor` 和 `git cat-file -e` 这两个字符串
 *
 * 后者是**字符串存在性**断言——它能挡住「有人把校验整段删掉」，挡不住「校验
 * 写错了」：把 `--is-ancestor` 的两个参数写反、把 `if !` 写成 `if`、
 * 把 `exit 1` 写成 `exit 0`，那条断言统统照样绿，而受保护分支上的 job 会开始
 * 接受任意来源的 bundle。CI-012 的那段逻辑是独立 Node 脚本，有真正的行为测试
 * （gitlab-ci-verify-bundle-provenance.test.ts）；CI-013 的这段是内联 shell，
 * 一直没人真的跑过它。
 *
 * 本文件把那段 shell **从 `.gitlab-ci.yml` 里原样抽出来**，在临时 git 仓库上
 * 真的执行，逐个场景验收。从配置里抽而不是在测试里抄一份，是为了让它跟着
 * 配置一起变——抄一份的话改坏了配置测试依然绿。
 */
import {describe, expect, test, beforeAll} from '@jest/globals'
import {execFileSync, execSync} from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml')

const CONFIG_PATH = path.resolve(__dirname, '../.gitlab-ci.yml')
const doc = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) as any
const TRIGGER = 'ai_review_trigger'
const MR_VERIFY = 'mr_verify'

/** 从 job 的 script 列表里取出包含指定标记的那一条，原样返回 */
function scriptEntryContaining(jobName: string, needle: string): string {
  const script: string[] = doc[jobName].script ?? []
  const hit = script.find(s => typeof s === 'string' && s.includes(needle))
  if (hit == null) {
    throw new Error(
      `${jobName} 的 script 里找不到包含 "${needle}" 的条目——配置结构变了，本文件需要同步更新`
    )
  }
  return hit
}

// ─── 临时仓库 ───────────────────────────────────────────────────────────────

interface Repo {
  dir: string
  /** default 分支上依次三个 commit */
  c1: string
  c2: string
  c3: string
  /** 从 c1 分叉出去的旁支 commit（不是 c3 的祖先） */
  sideCommit: string
}

let repo: Repo

function git(dir: string, args: string): string {
  return execSync(`git ${args}`, {cwd: dir, encoding: 'utf8'}).trim()
}

function commit(dir: string, msg: string): string {
  fs.writeFileSync(path.join(dir, 'f.txt'), `${msg}\n`)
  git(dir, 'add -A')
  git(dir, `-c user.email=t@e -c user.name=t commit -m "${msg}"`)
  return git(dir, 'rev-parse HEAD')
}

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-provenance-repo-'))
  git(dir, 'init -q -b main')
  const c1 = commit(dir, 'c1')
  const c2 = commit(dir, 'c2')
  // 从 c1 分叉：sideCommit 是真实存在的 commit，但不在 main 的历史里
  git(dir, `checkout -q -b side ${c1}`)
  const sideCommit = commit(dir, 'side')
  git(dir, 'checkout -q main')
  const c3 = commit(dir, 'c3')

  fs.mkdirSync(path.join(dir, 'dist', 'gitlab-trigger'), {recursive: true})
  repo = {dir, c1, c2, c3, sideCommit}
})

/** 按给定的 SOURCE_SHA 与 CI_COMMIT_SHA 跑一次 CI-013 的校验块 */
function runProvenanceCheck(
  recordedSha: string | null,
  ciCommitSha: string
): {status: number; output: string} {
  const shaFile = path.join(repo.dir, 'dist', 'gitlab-trigger', 'SOURCE_SHA')
  if (recordedSha == null) {
    if (fs.existsSync(shaFile)) fs.rmSync(shaFile)
  } else {
    fs.writeFileSync(shaFile, recordedSha)
  }

  // `test -f ...` 与校验块是 script 里两条独立条目，GitLab 逐条执行且任一
  // 非零即失败——用 `set -e` 复现这个语义
  const guard = scriptEntryContaining(TRIGGER, 'test -f dist/gitlab-trigger/SOURCE_SHA')
  const block = scriptEntryContaining(TRIGGER, 'RECORDED_SHA')
  const scriptPath = path.join(repo.dir, '__check.sh')
  fs.writeFileSync(scriptPath, `set -e\n${guard}\n${block}\n`)

  try {
    const output = execFileSync('sh', [scriptPath], {
      cwd: repo.dir,
      encoding: 'utf8',
      env: {...process.env, CI_COMMIT_SHA: ciCommitSha},
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return {status: 0, output}
  } catch (e: any) {
    return {status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}`}
  }
}

describe('CI-013 校验块的真实行为（TEST-040）', () => {
  test('SOURCE_SHA 是 CI_COMMIT_SHA 的祖先 → 放行', () => {
    const r = runProvenanceCheck(repo.c1, repo.c3)
    expect(r.status).toBe(0)
    expect(r.output).toContain('is a real ancestor')
  })

  test('SOURCE_SHA 恰好等于 CI_COMMIT_SHA → 同样放行（祖先关系含自身）', () => {
    // 这条是「改回精确相等」那次修复的反面保障：放宽成祖先链之后，原本合法的
    // 「恰好相等」不能反而被挡掉
    const r = runProvenanceCheck(repo.c3, repo.c3)
    expect(r.status).toBe(0)
  })

  test('SOURCE_SHA 来自另一分支（真实存在但不在本分支历史里）→ 拒绝', () => {
    // 这是校验真正要挡的攻击面：攻击者在自己分支上打包并提交 dist，
    // SOURCE_SHA 是个货真价实的 commit，但它不在受保护分支的历史上
    const r = runProvenanceCheck(repo.sideCommit, repo.c3)
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('is not an ancestor')
  })

  test('SOURCE_SHA 是后代（比 CI_COMMIT_SHA 更新）→ 拒绝', () => {
    // 方向必须是单向的。写反成 `--is-ancestor $CI_COMMIT_SHA $RECORDED_SHA`
    // 的话这条会绿，而「用一个更新的、尚未合并到受保护分支的 bundle」就被放行了
    const r = runProvenanceCheck(repo.c3, repo.c1)
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('is not an ancestor')
  })

  test('SOURCE_SHA 是仓库里不存在的 SHA（伪造）→ 拒绝，且报的是"不是已知 commit"', () => {
    const r = runProvenanceCheck('0'.repeat(40), repo.c3)
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('is not a known commit')
  })

  test('SOURCE_SHA 内容是垃圾字符串 → 在格式这一关就被拒', () => {
    // 注意报的是格式而不是"不是已知 commit"：格式门禁排在最前面，
    // 这类输入根本轮不到交给 git 去解析
    const r = runProvenanceCheck('not-a-sha; rm -rf /', repo.c3)
    expect(r.status).not.toBe(0)
    expect(r.output).toContain('not a full 40-character commit SHA')
  })

  /**
   * 上一条只覆盖了「git 根本解析不了」的输入。真正危险的是**能被解析**、
   * 但根本不是 commit SHA 的 revision expression。
   *
   * git 的每个 rev 参数都接受完整的 revision 语法：`HEAD`、分支名、`HEAD~1`、
   * `@{-1}`、tag……写进 SOURCE_SHA 的若是 `HEAD`，在 trigger job 的 clone 里
   * 它就解析成 `CI_COMMIT_SHA` 自己——自己是自己的祖先，两道校验全过。
   *
   * 那样一来这个校验就变成**恒真**：不管 bundle 是什么时候、从哪个 commit
   * 打出来的，只要 SOURCE_SHA 里写着 `HEAD` 就一律放行。CI-013 要保的
   * 「产物来源可追溯到本分支真实历史」这条属性直接归零，而日志里还会打印
   * 一行 `ok: ... is a real ancestor`，看起来一切正常。
   *
   * 打包脚本写入的一定是 `git rev-parse HEAD` 的输出（完整 40 位十六进制），
   * 所以格式校验没有任何误伤面。
   */
  test.each([
    ['HEAD', 'HEAD'],
    ['分支名', 'main'],
    ['相对引用', 'HEAD~1'],
    ['短 SHA（前 7 位）', null], // 运行时用真实短 sha 填充
    ['带前后空白的合法 SHA', null]
  ])('可被 git 解析但不是 commit SHA 的输入 → 拒绝：%s', (_label, literal) => {
    const value =
      literal ?? (_label === '短 SHA（前 7 位）' ? repo.c1.slice(0, 7) : `  ${repo.c1}  `)
    const r = runProvenanceCheck(value, repo.c3)

    expect(r.status).not.toBe(0)
    // 必须是**格式**这一关挡下的，而不是碰巧被后面的祖先判断挡住——
    // 后者对 HEAD 这类输入根本挡不住
    expect(r.output).toContain('not a full 40-character commit SHA')
  })

  test('SOURCE_SHA 文件缺失 → 在校验之前就失败（test -f 那道门）', () => {
    const r = runProvenanceCheck(null, repo.c3)
    expect(r.status).not.toBe(0)
  })

  test('拒绝时不执行 bundle（校验块位于 node dist/... 之前）', () => {
    const script: string[] = doc[TRIGGER].script
    const checkIdx = script.findIndex(s => s.includes('RECORDED_SHA'))
    const runIdx = script.findIndex(s => s.includes('node dist/gitlab-trigger/index.js'))
    expect(checkIdx).toBeGreaterThanOrEqual(0)
    expect(runIdx).toBeGreaterThan(checkIdx)
  })
})

describe('MR 临时 bundle 只验证不复用（TEST-040 前半句）', () => {
  /**
   * `needs`/`dependencies` 未定义时，GitLab 的默认行为是**下载此前所有 stage
   * 里全部 job 的 artifact**。今天之所以没出事，靠的是两个 job 的 rules 互斥
   * （merge_request_event vs trigger），同一次 pipeline 里不可能都存在——
   * 也就是说「不复用」这条安全属性目前**依赖于**另一条安全属性成立。
   *
   * 显式写 `dependencies: []` 才是「什么都不下载」的声明，让这条属性独立成立：
   * 将来哪怕有人放宽了 rules，artifact 也不会悄悄流进持密钥的 job。
   */
  test('ai_review_trigger 显式声明不消费任何 artifact（dependencies: []）', () => {
    expect(doc[TRIGGER].dependencies).toEqual([])
  })

  test('mr_verify 同样显式声明（第一个 stage，但要防将来插入新 stage）', () => {
    expect(doc[MR_VERIFY].dependencies).toEqual([])
  })

  test('两个 job 都没有 needs 指向对方', () => {
    expect(doc[TRIGGER].needs).toBeUndefined()
    expect(doc[MR_VERIFY].needs).toBeUndefined()
  })

  test('mr_verify 的 artifact 有过期时间（只服务本次验证）', () => {
    expect(doc[MR_VERIFY].artifacts?.expire_in).toBeDefined()
  })

  test('trigger job 不产生 artifact（没有可供下游消费的产物）', () => {
    expect(doc[TRIGGER].artifacts).toBeUndefined()
  })
})
