# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

AI Reviewer is a GitHub Action that performs AI-powered code review and summarization on pull requests. It uses OpenAI's Responses API (gpt-5.4-nano for summaries, gpt-5.4-mini for deep reviews) and posts review comments directly on PRs. It also handles interactive bot commands via PR comments (e.g., `@ai-reviewer help`).

## Build & Development Commands

```bash
npm run build        # Copy tiktoken wasm + tsc compile (src/ → lib/)
npm run package      # Bundle with @vercel/ncc into dist/
npm run lint         # ESLint on src/**/*.ts
npm run format       # Prettier write
npm run format-check # Prettier check
npm test             # Jest (all *.test.ts files)
npm run all          # build + format + lint + package + test

# Run a single test file
npx jest __tests__/command-parser.test.ts

# Local end-to-end via act (requires .secrets file with GITHUB_TOKEN + OPENAI_API_KEY)
npm run act
```

## Architecture

The action runs on `node20` with entry point `dist/index.js` (bundled from `src/main.ts`).

### Event Dispatch (main.ts)

- **pull_request / pull_request_target** → `review.ts` (full code review pipeline)
- **pull_request_review_comment / issue_comment** → `command-handler.ts` → command dispatcher or conversation fallback

### Two-Bot Design

- **lightBot** (gpt-5.4-nano): Fast, cheap — used for per-file summaries and change classification (NEEDS_REVIEW vs APPROVED)
- **heavyBot** (gpt-5.4-mini): High capability — used for deep code review, final summary generation, and interactive conversations. Supports web_search and local_shell tools.

### Core Modules

| File | Responsibility |
|------|---------------|
| `review.ts` | 4-phase review pipeline: diff prep → parallel file summaries → merged summary + release notes → line-level code review |
| `commenter.ts` | All GitHub comment CRUD; uses HTML comment tags for idempotent updates; buffers review comments for batch submission |
| `bot.ts` | OpenAI Responses API wrapper with p-retry; multi-turn via `previous_response_id`; shell command execution; analysis step tracking |
| `command-handler.ts` | Top-level entry for comment events; bootstraps command registry then dispatches |
| `commands/dispatcher.ts` | Full dispatch pipeline: event validation → parse → dedup → rate limit → permission check → ACK → execute |
| `commands/parser.ts` | Parses `@ai-reviewer <command>` from comment text; supports aliases, compound commands, safe arg validation |
| `commands/registry.ts` | Singleton command registry; handlers self-register on import |
| `dependency-analyzer.ts` | Cross-file dependency analysis via regex (no AST); extracts modified exports and finds references in dependent files |
| `repo-tree.ts` | Repository file tree fetching and language detection |
| `octokit.ts` | Singleton Octokit client with retry + throttling plugins |
| `options.ts` | Reads all action.yml inputs into typed Options class; includes PathFilter for glob-based file filtering |
| `limits.ts` | Token budget constants per model (maxTokens, requestTokens, responseTokens) |
| `tokenizer.ts` | tiktoken-based token counting |

### Command System (src/commands/)

Commands are triggered by `@ai-reviewer <command>` or `@codesentinel <command>` in PR comments. The system includes:
- Permission levels per command (anyone, collaborator, admin)
- Per-user rate limiting
- Idempotency via processed-comment tracking
- ACK reactions on recognized commands

### Key Design Decisions

- Uses OpenAI **Responses API** (not Chat Completions) — multi-turn context is maintained via `previous_response_id`
- Incremental review: stores reviewed commit IDs in summary comment tags; subsequent runs only review new commits
- Dependency analysis uses regex patterns (no AST libraries) to keep the action lightweight
- Concurrency controlled via `p-limit` for both OpenAI and GitHub API calls
- All bot comments are tagged with HTML comments for idempotent find-and-replace

## TypeScript Configuration

- Target: ESNext, Module: ESNext, strict mode enabled
- Source in `src/`, compiled to `lib/`, bundled to `dist/`
- Tests in `__tests__/` excluded from compilation

## Language

Code comments and documentation are primarily in Chinese (zh-CN). The default review output language is also zh-CN (configurable via `language` input).
