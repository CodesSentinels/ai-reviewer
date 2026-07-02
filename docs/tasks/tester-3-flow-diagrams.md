# 测试人 3 — P0 测试用例流程图

> 以下 Mermaid 图对应测试人 3 的核心测试场景，
> 帮助理解对话交互、噪音控制、Lint 集成的内部逻辑和验证点。

---

## 图 1：对话式追问流程（对应 3.1 对话追问 + 3.2 轮次控制）

```mermaid
sequenceDiagram
    autonumber
    participant User as 用户
    participant GH as GitHub<br/>(pull_request_review_comment)
    participant Dispatcher as CommandDispatcher
    participant Conv as handleConversation<br/>(conversation.ts)
    participant Bot as heavyBot

    Note over User: === 3.1.1 行级评论追问 ===
    User->>GH: 在 Bot 行级评论 thread 中<br/>@codesentinel 为什么这样不好？
    GH->>Dispatcher: event: pull_request_review_comment
    Dispatcher->>Dispatcher: parse → 非已注册命令
    Dispatcher-->>Conv: fallback_conversation

    Conv->>Conv: isFollowUpQuestion(body, BOT_MENTIONS)
    Note right of Conv: 检查: body 含 @codesentinel<br/>且事件是 review_comment → true
    Conv->>GH: 收集 thread 历史<br/>(getCommentChain)
    Conv->>Conv: countBotTurns(chain)
    
    alt turns < MAX_CONVERSATION_TURNS (10)
        Conv->>Conv: truncateConversationChain(chain, MAX_CHAIN_CHARS)
        Conv->>Bot: chat(prompt + chain + diff_context)
        Bot-->>Conv: AI 回复
        Conv->>GH: 回帖到 thread
    else turns ≥ 10 (测试 3.2.1)
        Conv->>GH: 回帖 "轮次已达上限"
    end

    Note over User: === 3.1.3 不带 @bot ===
    User->>GH: 在 thread 中普通回复<br/>(不含 mention)
    GH->>Dispatcher: event: pull_request_review_comment
    Dispatcher->>Dispatcher: parse → kind='none'
    Note right of Dispatcher: 不含 BOT_MENTIONS → 跳过

    Note over User: === 3.2.4 issue_comment 对话 ===
    User->>GH: 在 PR 主评论区<br/>@codesentinel 解释一下
    GH->>Dispatcher: event: issue_comment
    Dispatcher->>Dispatcher: parse → kind='conversation'
    Dispatcher-->>Dispatcher: issue_comment 对话暂不支持 → 跳过
```

### 对话截断策略

```mermaid
flowchart TD
    Entry([收集到 thread 历史]) --> CheckLength{chain 总长度<br/>> MAX_CHAIN_CHARS?}
    
    CheckLength -->|否| FullChain[使用完整 chain]
    CheckLength -->|是| Truncate["truncateConversationChain()<br/><small>保留最新 N 条消息<br/>直到总长度 ≤ 12k</small>"]
    
    FullChain --> BuildPrompt
    Truncate --> BuildPrompt
    
    BuildPrompt["构建 prompt:<br/>system + PR context<br/>+ file diff<br/>+ truncated chain<br/>+ user question"]
    BuildPrompt --> CallAI[heavyBot.chat]
    CallAI --> Reply[回帖到 thread]

    %% 测试标注
    CheckLength -.- T322["<small>测试 3.2.2: 长对话截断</small>"]
    Truncate -.- T323["<small>测试 3.2.3: 保留最近内容</small>"]

    classDef decision fill:#fff3e0,stroke:#ff9800
    classDef action fill:#e3f2fd,stroke:#2196f3
    class CheckLength decision
    class Truncate,BuildPrompt,CallAI,Reply action
```

---

## 图 2：噪音控制流水线（对应 3.3 噪音控制 + 3.5 评论去重）

```mermaid
flowchart TD
    Input(["rawFindings: Finding[]<br/><small>Phase 4 逐文件审查产出</small>"]) --> Dedup

    subgraph Dedup [Step 1: 去重]
        D1["dedupeFindings(findings)"]
        D1 --> D2{"同文件 + 相似首行?"}
        D2 -->|是| D3[合并: 保留首条，丢弃重复]
        D2 -->|否| D4[保留]
    end

    D3 --> MergeByTopic
    D4 --> MergeByTopic

    subgraph MergeByTopic [Step 1.5: AI 评论合并]
        M1["mergeReviewsByTopic()"]
        M1 --> M2{"同文件 + 相邻行<br/>+ 同一 lint ruleId?"}
        M2 -->|是| M3["合并: 扩展 startLine~endLine<br/>合并评论文本"]
        M2 -->|否| M4[保留独立]
    end

    M3 --> Classify
    M4 --> Classify

    subgraph Classify [Step 2: 严重级别分类]
        C1["classifyFindingSeverity(text)"]
        C1 --> C2["关键词匹配:<br/>security/injection/XSS → critical<br/>error/bug/crash → major<br/>unused/style → minor<br/>nit/typo → nit"]
        C2 --> C3["附加 severityBadge:<br/>🚨 严重 | ⚠️ 主要<br/>📝 建议 | 💡 微调"]
    end

    C3 --> Sort

    subgraph Sort [Step 3: 排序]
        S1["按严重级别降序排列<br/><small>critical > major > minor > nit > info</small>"]
    end

    S1 --> Truncate

    subgraph Truncate [Step 4: 截断]
        T1{findings.length<br/>> maxComments?}
        T1 -->|否| T2[全部保留]
        T1 -->|是 且 maxComments>0| T3["截断: 保留前 N 条<br/>丢弃尾部低优先级"]
        T1 -->|maxComments=0| T4[不截断: 全部保留]
    end

    T2 --> Output
    T3 --> Output
    T4 --> Output

    Output(["finalFindings → submitReview<br/><small>排序后的评论列表</small>"])

    %% 测试标注
    D1 -.- T335["<small>测试 3.3.5: 同类合并</small>"]
    M1 -.- T351["<small>测试 3.5.1: lint 合并</small>"]
    C1 -.- T331["<small>测试 3.3.1: 严重级别徽标</small>"]
    S1 -.- T332["<small>测试 3.3.2: 级别排序</small>"]
    T3 -.- T333["<small>测试 3.3.3~4: 截断+保留高优</small>"]
    T4 -.- T336["<small>测试 3.3.6: max=0 不截断</small>"]

    classDef step fill:#e8f5e9,stroke:#4caf50
    classDef decision fill:#fff3e0,stroke:#ff9800
    class Dedup,MergeByTopic,Classify,Sort,Truncate step
    class D2,M2,T1 decision
```

### 严重级别关键词映射（classifyFindingSeverity）

```mermaid
flowchart LR
    Text[评论文本] --> Scan[逐关键词匹配]
    
    Scan --> Critical["<b>critical</b><br/>security, injection, XSS,<br/>RCE, command injection,<br/>eval, SQL injection"]
    Scan --> Major["<b>major</b><br/>error, bug, crash,<br/>undefined, null pointer,<br/>await missing, race condition"]
    Scan --> Minor["<b>minor</b><br/>unused, refactor,<br/>naming, style, complexity"]
    Scan --> Nit["<b>nit</b><br/>typo, formatting,<br/>whitespace, prefer"]
    Scan --> Info["<b>info</b><br/>以上均不匹配 → 默认"]

    Critical --> Badge1["🚨 严重"]
    Major --> Badge2["⚠️ 主要"]
    Minor --> Badge3["📝 建议"]
    Nit --> Badge4["💡 微调"]
    Info --> Badge5["ℹ️ 信息"]
```

---

## 图 3：Linter/SAST 集成流程（对应 3.4 Lint 集成）

```mermaid
flowchart TD
    Entry([Phase 4 审查开始]) --> LintCheck{enable_lint_tools?}
    
    LintCheck -->|false| NoLint[跳过 Lint 阶段<br/>lintContext = '']
    LintCheck -->|true| Orchestrator

    subgraph Orchestrator [runLintTools — orchestrator.ts]
        O1[detectLanguage → 选择适用的 Adapters]
        O1 --> O2{各工具启用状态}
        
        O2 -->|enable_eslint| ESLint["ESLint Adapter<br/><small>eslint.ts</small>"]
        O2 -->|enable_biome| Biome["Biome Adapter<br/><small>biome.ts</small>"]
        O2 -->|enable_tsc| TSC["tsc Adapter<br/><small>tsc.ts</small>"]
        O2 -->|enable_prettier| Prettier["Prettier Adapter<br/><small>prettier.ts</small>"]
        O2 -->|enable_semgrep| Semgrep["Semgrep Adapter<br/><small>semgrep.ts</small>"]
        
        ESLint --> Results
        Biome --> Results
        TSC --> Results
        Prettier --> Results
        Semgrep --> Results
        
        Results["LintResult[]<br/><small>{ruleId, message, line, severity}</small>"]
    end

    Results --> Filter

    subgraph Filter [lint-filter.ts]
        F1["filterLintResults():<br/>只保留与 PR diff 行重叠的 findings"]
    end

    Filter --> Format

    subgraph Format [formatter.ts]
        F2["formatLintContextForFile():<br/>格式化为 prompt 注入文本"]
        F2 --> F3["formatToolAttribution():<br/>生成 🧰 Tools 卡片"]
    end

    F3 --> Inject["注入到 reviewFileDiff prompt:<br/>$lint_section + $lint_mandatory_instruction"]
    NoLint --> ReviewPrompt["reviewFileDiff prompt<br/>(无 lint section)"]
    Inject --> ReviewPrompt

    ReviewPrompt --> AI["heavyBot.chat → 行级评论"]

    %% 测试标注
    LintCheck -.- T345["<small>测试 3.4.5: 总开关关闭</small>"]
    O2 -.- T346["<small>测试 3.4.6: 单独禁用</small>"]
    ESLint -.- T341["<small>测试 3.4.1: ESLint</small>"]
    TSC -.- T342["<small>测试 3.4.2: tsc</small>"]
    Biome -.- T343["<small>测试 3.4.3: Biome</small>"]
    Semgrep -.- T347["<small>测试 3.4.7: Semgrep</small>"]
    F3 -.- T344["<small>测试 3.4.4: 工具归因卡片</small>"]

    classDef step fill:#e8f5e9,stroke:#4caf50
    classDef decision fill:#fff3e0,stroke:#ff9800
    classDef skip fill:#fee,stroke:#f66
    class Orchestrator,Filter,Format step
    class LintCheck,O2 decision
    class NoLint skip
```

### 工具归因卡片结构（formatToolAttribution）

```mermaid
flowchart LR
    Report["LintReport"] --> Check{"有 lint findings?"}
    Check -->|否| None["(不输出 Tools 卡片)"]
    Check -->|是| Build["构建卡片"]
    Build --> Output["<pre>🧰 Tools<br/>- ESLint (3 findings)<br/>- tsc (1 finding)</pre>"]
```

---

## 图 4：Web 搜索与 Shell 执行（对应 3.6）

```mermaid
flowchart TD
    Review([heavyBot.chat 审查]) --> ToolDecision{"AI 判断是否需要<br/>工具调用?"}
    
    ToolDecision -->|需要验证 API 用法| WebSearch
    ToolDecision -->|需要检查依赖/版本| Shell
    ToolDecision -->|无需工具| DirectReply[直接输出评论]

    subgraph WebSearch [Web Search — enableWebSearch]
        WS1["发起 web_search_call"]
        WS1 --> WS2["搜索最新文档/API 用法"]
        WS2 --> WS3["将结果注入上下文"]
    end

    subgraph Shell [Shell 执行 — enableShell]
        SH1["发起 shell_call"]
        SH1 --> SH2["执行命令<br/><small>如 npm info / cat package.json</small>"]
        SH2 --> SH3["将结果注入上下文"]
    end

    WS3 --> AIResponse["AI 基于搜索/Shell 结果生成评论"]
    SH3 --> AIResponse
    DirectReply --> Done
    AIResponse --> Done([输出行级评论])

    %% Analysis steps 记录
    WS1 -.- AS1["AnalysisStep: type='web_search'"]
    SH1 -.- AS2["AnalysisStep: type='shell'"]

    %% 测试标注
    WebSearch -.- T361["<small>测试 3.6.1: web search 触发</small>"]
    Shell -.- T362["<small>测试 3.6.2: shell 执行</small>"]

    classDef tool fill:#e3f2fd,stroke:#2196f3
    classDef decision fill:#fff3e0,stroke:#ff9800
    class WebSearch,Shell tool
    class ToolDecision decision
```

---

## 测试覆盖映射总表

| 测试编号 | 测试场景 | 对应图中节点 |
|----------|----------|--------------|
| 3.1.1 | 行级评论追问 | 图1: User → Conv → Bot → Reply 完整路径 |
| 3.1.2 | 续轮追问 | 图1: 多次循环（chain 累积） |
| 3.1.3 | 不带 @bot 不触发 | 图1: parse → kind='none' → 跳过 |
| 3.1.4 | Bot 不自触发 | 图1: Dispatcher 过滤 Bot 身份 |
| 3.1.5 | 引用文件 diff | 图1: BuildPrompt (file diff) |
| 3.1.6 | 引用 PR 摘要 | 图1: BuildPrompt (PR context) |
| 3.2.1 | 10 轮限制 | 图1: countBotTurns ≥ 10 分支 |
| 3.2.2 | 长对话截断 | 截断策略图: CheckLength → Truncate |
| 3.2.3 | 保留最近内容 | 截断策略图: 从尾部保留 |
| 3.2.4 | issue_comment 不支持 | 图1: issue_comment → 跳过 |
| 3.3.1 | 严重级别徽标 | 图2: Classify → Badge |
| 3.3.2 | 级别排序 | 图2: Sort |
| 3.3.3 | 评论截断 | 图2: Truncate (maxComments) |
| 3.3.4 | 截断保留高优 | 图2: Sort → Truncate 顺序保证 |
| 3.3.5 | 同类合并 | 图2: Dedup |
| 3.3.6 | 不截断(max=0) | 图2: Truncate maxComments=0 分支 |
| 3.4.1 | ESLint | 图3: ESLint Adapter |
| 3.4.2 | tsc | 图3: tsc Adapter |
| 3.4.3 | Biome | 图3: Biome Adapter |
| 3.4.4 | 工具归因卡片 | 图3: formatToolAttribution |
| 3.4.5 | lint 总开关 | 图3: enable_lint_tools → false |
| 3.4.6 | 单独禁用 | 图3: O2 各开关 |
| 3.4.7 | Semgrep | 图3: Semgrep Adapter |
| 3.5.1 | lint 合并 | 图2: MergeByTopic (同 ruleId) |
| 3.5.2 | 不同 lint 不合并 | 图2: MergeByTopic (不同 ruleId) |
| 3.5.3 | 合并行号扩展 | 图2: M3 扩展 startLine~endLine |
| 3.5.4 | AI 同行去重 | 图2: Dedup (同首行) |
| 3.6.1 | Web 搜索 | 图4: WebSearch |
| 3.6.2 | Shell 执行 | 图4: Shell |
| 3.6.3 | 关闭 web search | 图4: enableWebSearch=false → 无 web_search |
| 3.6.4 | 关闭 shell | 图4: enableShell=false → 无 shell |
