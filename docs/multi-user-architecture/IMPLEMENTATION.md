# 多用户隔离 — 实施方案与执行计划

> 版本: v1.1 | 日期: 2026-03-26 | 前置文档: [ARCHITECTURE.md](./ARCHITECTURE.md)
> v1.1 修订：修复 Phase 1 文件清单遗漏、agentWorkspace 安全漏洞、移除错误的网络配置建议

## 实施概览

共 4 个阶段，建议按顺序执行。每个阶段独立可验证、可回滚。

```
Phase 1: 源码改造（workspaceAccess: "persist"）     → 需要重启
Phase 2: 配置变更（agent 路由 + binding + 沙箱）       → 需要重启
Phase 3: 准备 Staff Agent 文件                       → 不需要重启
Phase 4: 验证与上线                                   → 不需要重启
```

---

## Phase 1: 源码改造

### 目标

新增 `workspaceAccess: "persist"` 模式，让沙箱 workspace 在容器销毁后保留在宿主机。

### 改动清单（8 个文件）

#### 1.1 `src/agents/sandbox/types.ts` (:30)

```typescript
// 修改 SandboxWorkspaceAccess 类型，加 "persist"
export type SandboxWorkspaceAccess = "none" | "ro" | "rw" | "persist";
```

#### 1.2 `src/config/types.agents-shared.ts` (:22)

```typescript
// TypeScript 类型声明，加 "persist"
workspaceAccess?: "none" | "ro" | "rw" | "persist";
```

#### 1.3 `src/config/zod-schema.agent-runtime.ts` (:521)

```typescript
// Zod 运行时验证 schema，在 union 中加 z.literal("persist")
// 找到 workspaceAccess 的 z.union([...])，在 z.literal("rw") 后加:
z.literal("persist"),
```

> ⚠️ 缺了 1.2 和 1.3，`"persist"` 写进 openclaw.json 会被 Zod 验证拒绝，gateway 启动直接报错。

#### 1.4 `src/agents/sandbox/workspace-mounts.ts`

```typescript
// mainWorkspaceMountSuffix: 让 "persist" 模式下主 workspace bind-mount 为 rw
function mainWorkspaceMountSuffix(access: SandboxWorkspaceAccess): "" | ":ro" {
  return access === "rw" || access === "persist" ? "" : ":ro";
}

// ⚠️ agentWorkspaceMountSuffix: "persist" 模式下 agent workspace 必须只读！
// 否则沙箱用户可以写 /agent 路径修改 staff agent 的共享 seed 文件（安全漏洞）
function agentWorkspaceMountSuffix(access: SandboxWorkspaceAccess): "" | ":ro" {
  return access === "ro" || access === "persist" ? ":ro" : "";
}
```

#### 1.5 `extensions/openshell/src/fs-bridge.ts`

```typescript
// 5 处 workspaceAccess === "rw" 检查需要加 persist 支持：
// 第 195 行 — 写入验证
if ((this.sandbox.workspaceAccess !== "rw" && this.sandbox.workspaceAccess !== "persist") || !target.writable) {
// 第 232/250/267/281 行 — writable 标志
writable: this.sandbox.workspaceAccess === "rw" || this.sandbox.workspaceAccess === "persist",
```

> 不改此文件，"persist" 模式下沙箱内所有写操作（创建 USER.md、保存记忆等）都会被拒绝。

#### 1.6 `src/agents/sandbox/context.ts` (:49) — skills 同步条件

```typescript
// 排除 persist 模式，避免每次 resolveSandboxContext 都清空 skills/ 目录
if (cfg.workspaceAccess !== "rw" && cfg.workspaceAccess !== "persist") {
  await syncSkillsToWorkspace({ ... });
}
```

> 路径选择逻辑（:41）不需要改："persist" 不是 "rw"，自然走 sandboxWorkspaceDir。

#### 1.7 `src/agents/pi-embedded-runner/types.ts` (:96)

```typescript
// Plugin SDK 的沙箱信息类型也需要加 "persist"
workspaceAccess?: "none" | "ro" | "rw" | "persist";
```

#### 1.8 `src/agents/sandbox/config.ts` — **不需要改**

该文件只组装默认值，不做 workspaceAccess 验证。验证在 1.2 和 1.3 中完成。

#### 1.9 测试文件

- `workspace-mounts.test.ts` — 增加 `"persist"` 模式的测试用例（主挂载 rw，agent 挂载 ro）

### ⚠️ 副作用：存量容器重建

`workspaceAccess` 参与 Docker 容器的 `configHash` 计算。源码改造后现有沙箱容器会被检测到 hash 不匹配，自动删除重建。**Workspace 目录保留，数据不丢失**，但容器需重新拉起。

### 验证方法

```bash
# 构建
cd ~/openclaw && pnpm build

# 单元测试
pnpm test -- src/agents/sandbox/workspace-mounts.test.ts
pnpm test -- src/agents/sandbox/context.test.ts
```

### 回滚

如果构建失败或测试不过，代码改动全在 git 分支上，`git checkout` 即可回退。

---

## Phase 2: 配置变更

### 前提

Phase 1 已完成并构建成功。

### 2.1 openclaw.json 改动

```jsonc
{
  // ... 现有配置 ...

  "agents": {
    "defaults": {
      // ... 现有 defaults 保持不变 ...
    },
    "list": [
      // --- 保持现有 agents 不变 ---
      {
        "id": "main",
        "default": true,
        "sandbox": { "mode": "off" },
        "subagents": {
          "allowAgents": [
            "orchestrator",
            "rnd",
            "reviewer",
            "analyst",
            "qa",
            "deployer",
            "test-spec",
          ],
        },
      },
      // orchestrator, rnd, reviewer, analyst, qa, deployer, test-spec 不变
      // ...

      // --- 新增 staff agent ---
      {
        "id": "staff",
        "name": "Staff Assistant",
        "workspace": "~/.openclaw/workspace-staff",
        "model": {
          "primary": "anthropic/claude-sonnet-4-6",
          "fallbacks": ["google/gemini-3.1-pro-preview"],
        },
        "sandbox": {
          "mode": "all",
          "scope": "session",
          "backend": "docker",
          "workspaceAccess": "persist",
        },
        "tools": {
          "deny": [
            "exec",
            "process",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "sessions_yield",
            "subagents",
            "agents_list",
            "session_status",
          ],
        },
        "identity": {
          "name": "海管家助手",
          "emoji": "🐙",
        },
        "subagents": {
          "allowAgents": [],
        },
      },
    ],
  },

  // --- 新增 bindings ---
  "bindings": [
    // 老徐 — 飞书（精确 peer 匹配，优先级最高）
    {
      "agentId": "main",
      "match": {
        "channel": "feishu",
        "peer": { "kind": "direct", "id": "ou_5396a070b57532dc952776a3a7dca921" },
      },
    },
    // 老徐 — Discord
    {
      "agentId": "main",
      "match": {
        "channel": "discord",
        "peer": { "kind": "direct", "id": "1113661364670574642" },
      },
    },
    // 老徐 — WebChat
    {
      "agentId": "main",
      "match": {
        "channel": "webchat",
        "peer": { "kind": "direct", "id": "a737a26c" },
      },
    },
    // 其他飞书用户 → staff（channel 兜底）
    {
      "agentId": "staff",
      "match": { "channel": "feishu" },
    },
    // 其他 WebChat 用户 → staff
    {
      "agentId": "staff",
      "match": { "channel": "webchat" },
    },
  ],
}
```

### 2.2 Docker 沙箱镜像构建

沙箱功能依赖预构建的 Docker 镜像。**必须在 Phase 2 配置生效前完成。**

```bash
cd ~/openclaw

# Step 1: 构建基础镜像（Debian bookworm-slim + bash/curl/git/jq/python3/ripgrep）
scripts/sandbox-setup.sh
# → 产出: openclaw-sandbox:bookworm-slim
# → 用途: 最小沙箱环境，适合纯对话 + 文件读写场景

# Step 2（可选）: 构建增强镜像（+ nodejs/npm/golang/rust/pnpm/bun/brew 等）
scripts/sandbox-common-setup.sh
# → 产出: openclaw-sandbox-common:bookworm-slim
# → 用途: 需要 exec 跑代码的场景（staff 不需要，但未来 staff-dev 可能需要）

# 验证镜像
docker images | grep openclaw-sandbox
```

Staff agent 当前只需基础镜像（Step 1）。如果 agent 配置中未指定 `docker.image`，默认使用 `openclaw-sandbox:bookworm-slim`。

如需指定镜像，在 staff agent 的 sandbox 配置中添加：

```jsonc
"docker": { "image": "openclaw-sandbox:bookworm-slim" }
```

### 2.3 关于沙箱网络

`web_search`、`web_fetch` 等工具在 **Gateway 进程**中执行（工具 allow/deny 是 Gateway 层控制），不在 Docker 容器内。沙箱容器只是 `exec`/`process` 的执行环境。

**不需要为 staff agent 配置 `docker.network: "bridge"`。** 默认无网络即可，反而更安全。

````

### 验证方法
```bash
# 重启 gateway
openclaw gateway restart

# 检查 agent 列表
openclaw agents list --bindings

# 检查沙箱状态
openclaw sandbox list
````

### 回滚

备份 `openclaw.json`。回滚只需恢复旧配置 + 重启 gateway。

---

## Phase 3: 准备 Staff Agent 文件

### 3.1 创建 Staff Workspace

```bash
mkdir -p ~/.openclaw/workspace-staff
```

### 3.2 SOUL.md（Staff 版）

文件: `~/.openclaw/workspace-staff/SOUL.md`

定位：专业、友好、高效的企业内部助手。

关键要点：

- 不需要"贫嘴"个性，保持专业
- 中文为主要语言
- 简洁直接，不废话
- 遇到不确定的问题主动说"我不确定"

### 3.3 AGENTS.md（Staff 版）

文件: `~/.openclaw/workspace-staff/AGENTS.md`

关键要点：

- 去掉管理员识别逻辑
- 去掉 heartbeat/cron 相关
- 去掉 OV 全局查询权限
- 保留用户识别（通过飞书 open_id）
- 首次对话自动创建 USER.md
- 记忆存到 memory/ 目录（persist 模式下持久化）

### 3.4 IDENTITY.md（Staff 版）

```markdown
- **Name:** 海管家助手
- **Creature:** 海管家的企业内部 AI 助手
- **Vibe:** 专业、友好、高效
- **Emoji:** 🐙
```

### 3.5 USER.md（通用模板）

```markdown
# USER.md

_首次对话时请询问用户姓名和偏好，然后更新此文件。_
```

### 验证

这一步不需要重启，文件准备好即可。seed 逻辑会在首个 session 创建沙箱 workspace 时自动复制。

---

## Phase 4: 验证与上线

### 4.1 验证清单

#### 老徐（main agent）

- [ ] 飞书私聊正常，不进沙箱
- [ ] Discord 私聊正常，不进沙箱
- [ ] WebChat 正常，不进沙箱
- [ ] 所有工具可用（exec, browser, 等）
- [ ] 现有 heartbeat、cron 任务正常
- [ ] 现有 sub-agents（orchestrator, rnd 等）正常

#### 同事用户（staff agent）

- [ ] 飞书私聊路由到 staff agent
- [ ] AI 使用 Staff 版 SOUL.md 风格
- [ ] 首次对话问称呼，创建 USER.md
- [ ] 容器被 prune 后再次对话，USER.md 还在
- [ ] 不同同事的 workspace 文件互不可见
- [ ] 工具权限正确（web_search 可用，exec 不可用）
- [ ] 对话历史不与其他用户混淆

### 4.2 验证步骤

```bash
# 1. 检查 binding 路由
openclaw agents list --bindings

# 2. 用老徐飞书发消息 → 确认进 main
# 观察日志: grep "routing.*main" in gateway.log

# 3. 用另一个飞书用户发消息 → 确认进 staff
# 观察日志: grep "routing.*staff" in gateway.log

# 4. 检查沙箱容器
docker ps --filter "name=openclaw-sbx-"

# 5. 检查沙箱 workspace 持久化
ls ~/.openclaw/sandboxes/
# 应该看到 staff session 对应的目录
```

### 4.3 回滚方案

如果出现问题：

```bash
# 1. 恢复旧配置
cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json

# 2. 如果是源码改动导致，回退代码
cd ~/openclaw && git revert HEAD

# 3. 重新构建
pnpm build

# 4. 重启
openclaw gateway restart
```

---

## 执行关键点

### ⚠️ 重启问题（"自己给自己动手术"）

源码改造和配置变更都需要重启 gateway，**重启 = 小葡萄断线**。

**执行方式：**

1. 小葡萄写好所有代码改动（patch 文件或 git 分支）
2. 小葡萄写好构建和验证命令
3. **老徐手动执行**：应用 patch → 构建 → 备份配置 → 修改配置 → 重启
4. 重启后小葡萄恢复在线 → 验证功能

**建议执行时间：** 工作日白天，有时间排查问题。避免深夜操作。

### ⚠️ Docker 依赖

沙箱功能需要 Docker。需确认：

- Docker 已安装且 daemon 运行中
- 当前用户有 docker 执行权限（在 docker 组中）
- 沙箱镜像已构建

### ⚠️ 飞书 binding 注意

飞书机器人的可用范围需要在飞书管理后台设置。如果机器人当前只对老徐可见，需要先扩大可用范围，同事才能找到机器人发消息。

### ⚠️ 未来特权 Staff（如 staff-dev）镜像方案

当前 staff agent deny exec，基础镜像足够。未来如果新增开放 exec 的特权 agent，有两种做法：

**方案 A — 使用增强镜像（推荐）：**

```jsonc
{
  "id": "staff-dev",
  "sandbox": {
    "mode": "all",
    "scope": "session",
    "workspaceAccess": "persist",
    "docker": { "image": "openclaw-sandbox-common:bookworm-slim" },
  },
  // 不 deny exec → 可以跑代码
}
```

需提前构建: `scripts/sandbox-common-setup.sh`（含 nodejs/python3/golang/rust/pnpm/bun）

**方案 B — 自定义镜像：**
基于基础镜像编写 Dockerfile 加装特定工具链，适合只需某一种语言环境的场景。

### ⚠️ WebChat peer id 不确定性

部分 WebChat 用户的 peer id 是随机 hash（如 `a737a26c`），不是 LDAP 用户名。老徐的 binding 使用当前 hash，如果 auth proxy 重新分配 hash，binding 会失效。建议后续确认 peer id 的稳定性。
