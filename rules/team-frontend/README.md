# Team Frontend Semgrep Rules

团队前端代码规范的 Semgrep 规则化沉淀。规则按 `<rule-id>.yaml` + `<rule-id>.ts` 配对，用 `semgrep --test` 做回归。

## 当前规则索引

| Rule ID | 规范出处 | 优先级 | severity | 状态 |
|:--------|:---------|:------:|:--------:|:-----|
| `no-direct-fetch` | 团队前端规范 §X.X "API 调用统一走 apiClient" | P0 | WARNING | 草稿 |
| `no-sensitive-localstorage` | 团队前端安全规范 §X.Y "敏感数据不落 localStorage" | P0 | ERROR | 草稿 |

## 验证（开发者本机或 CI 都可跑）

```bash
# 1) 安装 semgrep（与 ai-reviewer 沙箱版本对齐：1.95.0）
pipx install semgrep==1.95.0

# 2) 跑规则自检 —— 读 yaml + 配对的 ts 文件，比对 ruleid:/ok: 注释
semgrep --test rules/team-frontend/

# 3) 在仓库代码上跑一遍真扫描（看历史命中数，评估 FP）
semgrep scan --config rules/team-frontend/ --json src/ | jq '.results | length'

# 4) 看具体命中位置
semgrep scan --config rules/team-frontend/ src/
```

`semgrep --test` 输出健康长这样：

```
1/1: ✓ All tests passed
```

如果有失败：

```
✗ no-direct-fetch
  expected lines [12, 17, 22], got [12, 22]   ← line 17 漏报了
  expected NOT to match line 35, but matched   ← line 35 误报了
```

## 接入 ai-reviewer

在工作流里：

```yaml
- uses: CodesSentinels/ai-reviewer@v1
  with:
    enable_semgrep: 'true'
    # 指向目录，semgrep 会递归加载所有 yaml
    semgrep_config: 'rules/team-frontend/'
```

也可以与 `p/default` 联用——见 [docs/06-iteration-semgrep-rules.md §3.5](../../docs/06-iteration-semgrep-rules.md)。

## 新增规则流程

每条新规则按下面五步：

1. **写测试样例**：`<rule-id>.ts`，用 `// ruleid:` / `// ok:` 注释标好期望
2. **写规则草稿**：`<rule-id>.yaml`，先用最粗的 `pattern` 跑通 `--test`
3. **加约束收窄**：`patterns` + `pattern-not-inside` + `metavariable-regex` 处理 FP/FN
4. **历史代码回测**：在 src/ 上跑，统计命中数 + 看分布
5. **灰度上线**：severity 从 INFO 起步，2 周后升 WARNING，再 2 周升 ERROR
