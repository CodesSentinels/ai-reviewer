// 回测用假 OpenAI Responses 服务：行为可预测，不需要密钥。
//  - 文件摘要提示词（含 [TRIAGE]）→ NEEDS_REVIEW
//  - 深度审查提示词（含 "Changes made to `<file>`"）→ bugs.json 里登记过的文件报一条固定缺陷；
//    评论链里已有 [OPEN] 的同一文件回 LGTM!（模拟模型遵守「不重复评论」）
//  - 其他（合并摘要 / 发布说明 / 追问）→ 固定文本
const http = require('http')
const fs = require('fs')
const logFile = process.argv[2]
const bugs = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
http
  .createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      let input = ''
      try {
        const j = JSON.parse(body)
        input = typeof j.input === 'string' ? j.input : JSON.stringify(j.input)
      } catch {}
      let kind = 'other'
      let text = 'stub text'
      const m = input.match(/Changes made to `([^`]+)`/)
      if (/\[TRIAGE\]/.test(input) && !m) {
        kind = 'triage'
        text = 'stub file summary\n[TRIAGE]: NEEDS_REVIEW'
      } else if (m) {
        kind = 'review'
        const file = m[1]
        // 提示词的固定说明里也出现 [OPEN]，只看真正的评论链段（取最后一个 ---comment_chains---）
        const ci = input.lastIndexOf('---comment_chains---')
        const chain = ci >= 0 ? input.slice(ci).split('---end_change_section---')[0] : ''
        const open = /\[OPEN\]/.test(chain)
        if (bugs[file] && !open) {
          const [s, e] = bugs[file]
          text = `${s}-${e}:\n[severity: major]\nSTUB-BUG in ${file}\n---`
        } else {
          text = 'LGTM!'
        }
        kind = `review:${file}:${open ? 'open-chain' : 'fresh'}`
      }
      console.log(`stub request: ${kind}`)
      fs.appendFileSync(logFile, JSON.stringify({kind, input}) + '\n')
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          id: 'resp_stub',
          object: 'response',
          status: 'completed',
          output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text}]}],
          usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}
        })
      )
    })
  })
  .listen(18080, '127.0.0.1')
