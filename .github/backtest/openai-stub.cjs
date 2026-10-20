// 回测用的假 OpenAI Responses 服务：记录收到的每个请求，返回固定回复。不需要任何密钥。
const http = require('http')
const fs = require('fs')
const out = process.argv[2]
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
      fs.appendFileSync(out, JSON.stringify({url: req.url, input}) + '\n')
      const text = /triage/i.test(input) ? 'stub summary\n[TRIAGE]: NEEDS_REVIEW' : 'LGTM!'
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
