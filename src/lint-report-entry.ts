/**
 * lint-report-entry.ts — lint-only 执行器的可执行入口（LINT-004）
 *
 * 与核心模块 `lint-report-cli.ts` 分离：那边只导出函数、导入无副作用，
 * 便于单元测试；这里是**唯一**会自己跑起来的地方，无条件执行。
 *
 * 不能靠「argv 里有没有 --xxx」来判断是否以 CLI 方式被调用——jest、ncc 等宿主
 * 进程本身就带这类参数，那样判会让测试导入时误执行并写出文件。
 */
import {run} from './lint-report-cli'
import {getLogger} from './platform/logger'

// 不用顶层 await（同 main.ts / gitlab-trigger.ts 的既有原因）
void (async (): Promise<void> => {
  try {
    await run(process.argv.slice(2))
  } catch (e) {
    getLogger().error(`lint-report-cli: unhandled error — ${String(e)}`)
  }
})()
