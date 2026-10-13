/**
 * comment-dedupe.test.ts — 按“同一问题”给新评论去重（内容层）
 *
 * 回归：
 *  - FT-055：full review 对已有未解决评论的同一函数、同一缺陷重复发布；
 *  - FT-092：截断后再审，已发布过的 `loadAll` 因为行范围不同（旧 5-10、新 1-17）被再次发布。
 * 样本取自回归测试里的真实评论。
 */
import {describe, expect, test} from '@jest/globals'
import {
  dedupeAgainstExisting,
  extractIssueKeys,
  splitReviewSections,
  stripToProse
} from '../src/comment-dedupe'

const HEADER = '🦉   CodeSentinel\n\n> [!CAUTION]\n> 🔴 **严重** — 需优先修复\n'

/** 第一轮已发布的评论（只讲 loadAll，位置 5-10） */
const EXISTING_LOAD_ALL = `${HEADER}
\`loadAll\` 直接返回 \`urls.map(async ...)\`，实际类型是 \`Promise<unknown>[]\`，并不会等待请求完成。应该用 \`Promise.all\` 汇总这些 promise。

<details>
<summary>🔧 修复建议</summary>

\`\`\`diff
-  return urls.map(async (url) => (await fetch(url)).json());
+  return Promise.all(urls.map(async (url) => (await fetch(url)).json()));
\`\`\`

</details>

<!-- ai-reviewer:github:comment -->`

/** 第二轮 full review 的合并评论（行范围 1-17）：第一段混着 lastItem 与 loadAll，第二段是另外两个问题 */
const MERGED = `${HEADER}
\`lastItem\` 和 \`loadAll\` 这两处实现都有明显的运行时问题。

- \`items[items.length]\` 会返回 \`undefined\`，因为数组最后一个元素的索引是 \`length - 1\`。
- \`loadAll\` 直接返回 \`urls.map(async ...)\`，并不会等待请求完成；应该用 \`Promise.all\`。

<details>
<summary>🔧 修复建议</summary>

\`\`\`diff
-  return items[items.length];
+  return items[items.length - 1];
\`\`\`

</details>

---

\`findUser\` 直接把外部输入拼接进 SQL 字符串，存在典型的 SQL 注入风险；\`API_TOKEN\` 以明文常量形式导出。

<details>
<summary>🧩 Analysis chain</summary>

---

Repository: x

</details>`

describe('extractIssueKeys', () => {
  test('取正文里反引号包起来的标识符，忽略折叠块、代码围栏、HTML 注释与过于泛的词', () => {
    const keys = extractIssueKeys(EXISTING_LOAD_ALL)
    expect(keys.has('loadall')).toBe(true)
    expect(keys.has('promise.all')).toBe(true)
    expect(keys.has('undefined')).toBe(false)
    expect(keys.has('fetch')).toBe(false)
    // 折叠块里的内容不参与
    expect([...keys].some(k => k.includes('urls.map(async (url)'))).toBe(false)
  })

  test('stripToProse 去掉标记、折叠块与围栏', () => {
    const prose = stripToProse(EXISTING_LOAD_ALL)
    expect(prose).not.toContain('<details')
    expect(prose).not.toContain('```')
    expect(prose).not.toContain('ai-reviewer:github:comment')
  })
})

describe('splitReviewSections', () => {
  test('按单独一行的 --- 拆段；折叠块和围栏里的 --- 不算分隔符', () => {
    const sections = splitReviewSections(MERGED)
    expect(sections).toHaveLength(2)
    expect(sections[1]).toContain('findUser')
    expect(sections[1]).toContain('Repository: x')
  })
})

describe('dedupeAgainstExisting', () => {
  test('整条评论讲的就是已报告过的问题 → 整条丢弃（FT-055 类：同一函数同一缺陷换了范围）', () => {
    const again = `${HEADER}\n\`loadAll\` 返回的是 \`Promise<unknown>[]\`，应当使用 \`Promise.all\` 等待所有请求完成。`
    const r = dedupeAgainstExisting(again, [EXISTING_LOAD_ALL])
    expect(r.message).toBe('')
    expect(r.droppedSections).toBe(1)
  })

  test('混合评论（FT-092）：已报告的 loadAll 要点被去掉，新问题全部保留', () => {
    const r = dedupeAgainstExisting(MERGED, [EXISTING_LOAD_ALL])
    expect(r.droppedBullets).toBe(1)
    expect(r.message).toContain('items[items.length]') // lastItem 保留
    expect(r.message).toContain('findUser') // SQL 注入保留
    expect(r.message).toContain('API_TOKEN') // 明文令牌保留
    expect(r.message).not.toContain('直接返回 `urls.map(async ...)`') // loadAll 要点不再重复
  })

  test('第一段整体被丢弃时，署名与严重级别提示留给后面保留的段', () => {
    const msg = `${HEADER}\n\`loadAll\` 应当用 \`Promise.all\`。\n\n---\n\n\`findUser\` 存在 SQL 注入。`
    const r = dedupeAgainstExisting(msg, [EXISTING_LOAD_ALL])
    expect(r.droppedSections).toBe(1)
    expect(r.message.startsWith('🦉   CodeSentinel')).toBe(true)
    expect(r.message).toContain('[!CAUTION]')
    expect(r.message).toContain('findUser')
    expect(r.message).not.toContain('loadAll')
  })

  test('完全不同的问题 → 原样保留', () => {
    const other = `${HEADER}\n\`findUser\` 直接拼接 SQL，存在注入风险。`
    const r = dedupeAgainstExisting(other, [EXISTING_LOAD_ALL])
    expect(r.message).toBe(other)
    expect(r.droppedSections + r.droppedBullets).toBe(0)
  })

  test('没有可识别的标识符 → 保守保留（宁可多发，不能漏发）', () => {
    const plain = `${HEADER}\n这里的循环边界写错了，会漏掉最后一项。`
    const r = dedupeAgainstExisting(plain, [EXISTING_LOAD_ALL])
    expect(r.message).toBe(plain)
  })

  test('只有少数标识符重合 → 保留', () => {
    const msg = `${HEADER}\n\`loadAll\` 之外，\`retryFetch\`、\`cacheKey\`、\`parseBody\` 也有问题。`
    const r = dedupeAgainstExisting(msg, [EXISTING_LOAD_ALL])
    expect(r.message).toBe(msg)
  })

  test('没有已有评论 → 原样返回', () => {
    expect(dedupeAgainstExisting(MERGED, []).message).toBe(MERGED)
  })
})
