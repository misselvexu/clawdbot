# 多用户隔离架构设计

> 版本: v1.0 | 日期: 2026-03-25 | 作者: 小葡萄 + 老徐

## 1. 背景与目标

### 当前状态

- 飞书机器人面向老徐一人使用，所有渠道（飞书/Discord/WebChat）共享一个 `main` agent
- WebChat 已有多位 LDAP 用户和访客使用，但共享 workspace 和 session 上下文
- `dmScope` 已配置为 `per-channel-peer`，session 级对话上下文已隔离

### 目标

让企业内部多位同事通过同一个飞书机器人使用 AI 助手，实现：

1. **对话隔离** — 不同用户的对话历史互不可见
2. **文件隔离** — 不同用户的 workspace 文件物理隔离
3. **记忆隔离** — 不同用户的记忆、称呼、偏好各自独立
4. **管理员不受影响** — 老徐的所有渠道保持完整权限，不进沙箱

## 2. 架构方案

### 2.1 整体架构

```
飞书机器人（单一入口）
    │
    ├─ 老徐 (ou_5396...) ──binding──→ main agent
    │                                   ├── workspace: ~/.openclaw/workspace（完整权限）
    │                                   ├── sandbox: off
    │                                   └── sessions: ~/.openclaw/agents/main/sessions/
    │
    ├─ 同事A (ou_xxxx) ──binding──→ staff agent
    │                                   ├── workspace: ~/.openclaw/workspace-staff（seed 模板）
    │                                   ├── sandbox: mode=all, scope=session
    │                                   ├── workspaceAccess: "persist"（新模式）
    │                                   │     └── 实际 workspace: ~/.openclaw/sandboxes/{session-slug}/
    │                                   └── sessions: ~/.openclaw/agents/staff/sessions/
    │
    └─ 同事B (ou_yyyy) ──binding──→ staff agent（同一 agent，不同 session）
                                        └── 实际 workspace: ~/.openclaw/sandboxes/{另一个session-slug}/
```

### 2.2 核心组件

#### Agent 路由（已有能力）

- `main` agent: 老徐专属，sandbox off，完整工具权限
- `staff` agent: 共用一个 agent 定义，不同用户通过 session 级沙箱隔离
- `bindings`: 按飞书 `peer.id` (open_id) 精确匹配老徐 → main，其余兜底 → staff

#### Session 隔离（已有能力）

- `dmScope: "per-channel-peer"` — 每个渠道的每个用户独立 session
- Session key 格式: `agent:{agentId}:feishu-china:direct:{open_id}`
- 对话历史存储: `~/.openclaw/agents/{agentId}/sessions/{sessionId}.jsonl`
- **对话历史天然隔离，无需额外改造**

#### Workspace 隔离（需要改造 ⚠️）

- 新增 `workspaceAccess: "persist"` 模式
- 每个 session 对应宿主机独立目录: `~/.openclaw/sandboxes/{session-slug}/`
- bind-mount 到容器内（读写）
- 容器销毁后文件保留在宿主机
- 下次同一用户进来，新容器挂载同一目录

#### 人格与行为（需要准备文件）

- staff agent 准备通用的 SOUL.md / AGENTS.md
- seed 到每个沙箱 workspace（首次自动复制，已有内容不覆盖）
- USER.md 不预设，AI 首次对话时询问并创建

### 2.3 各渠道路由

| 渠道    | 用户                       | Session Key                                 | 路由到                |
| ------- | -------------------------- | ------------------------------------------- | --------------------- |
| 飞书    | 老徐 `ou_5396...`          | `agent:main:feishu-china:direct:ou_5396...` | main（peer binding）  |
| 飞书    | 同事 `ou_xxxx`             | `agent:staff:feishu-china:direct:ou_xxxx`   | staff（channel 兜底） |
| Discord | 老徐 `1113661364670574642` | `agent:main:discord:direct:1113661...`      | main（peer binding）  |
| WebChat | 老徐 `elve.xu`             | `agent:main:web:a737a26c`                   | main（peer binding）  |
| WebChat | LDAP 用户                  | `agent:staff:web:{peer_id}`                 | staff（channel 兜底） |
| WebChat | 访客                       | `agent:staff:web:{hash}`                    | staff（channel 兜底） |

## 3. 隔离矩阵

| 维度                | main (老徐)             | staff (同事)                    | 隔离方式               |
| ------------------- | ----------------------- | ------------------------------- | ---------------------- |
| 对话历史            | `agents/main/sessions/` | `agents/staff/sessions/`        | agent 级物理隔离       |
| Workspace 文件      | `~/.openclaw/workspace` | `~/.openclaw/sandboxes/{slug}/` | 沙箱 persist 模式      |
| SOUL.md / AGENTS.md | 老徐专属版本            | staff 通用版本（seed）          | agent workspace 隔离   |
| USER.md / 记忆      | workspace 下            | 各沙箱 workspace 独立           | persist 模式物理隔离   |
| 工具权限            | 全部可用                | 受限（按需开放）                | agent tools allow/deny |
| 模型                | 当前配置                | 共享（Gateway 统一）            | 无需隔离               |
| Skills              | 全部                    | 按需配置                        | agent skills 列表      |
| OV 知识库           | 全局可查                | 公共 + 私有目录                 | 行为层规则             |

## 4. 数据流

### 4.1 新用户首次对话

```
同事 A 首次发消息给飞书机器人
  → Gateway 收到 (sender: ou_xxxx)
  → binding 匹配: channel=feishu-china, 无 peer 精确匹配 → staff agent
  → session key: agent:staff:feishu-china:direct:ou_xxxx
  → sandbox resolve: mode=all → 需要沙箱
  → resolveSandboxWorkspaceDir: ~/.openclaw/sandboxes/agent-staff-feishu-china-direct-ou-xxxx-{hash}/
  → ensureSandboxWorkspace: 目录不存在 → 创建 + seed SOUL.md/AGENTS.md
  → workspaceAccess=persist → bind-mount rw 到容器
  → AI 启动对话 → 读 AGENTS.md → 问"怎么称呼你？"
  → 用户回复 → AI 创建 USER.md 到沙箱 workspace
  → 文件落盘到宿主机 ~/.openclaw/sandboxes/{slug}/USER.md
```

### 4.2 老用户再次对话

```
同事 A 再次发消息
  → 同样路由到 staff agent
  → 同一 session key → 同一 sandboxWorkspaceDir
  → 目录已存在 → seed 跳过（flag: "wx"）
  → 新容器挂载同一目录 → USER.md 和 memory/ 都在
  → AI 读到 USER.md → 用正确称呼打招呼
```

### 4.3 容器生命周期

```
容器被 prune 清理（idle 超时）
  → docker rm -f（删除容器）
  → 宿主机 ~/.openclaw/sandboxes/{slug}/ 目录保留
  → 下次消息进来 → 创建新容器 → 挂载同一目录
  → 数据完整，无损失
```

## 5. 安全边界

### 5.1 系统级隔离（硬）

- 不同 agent 的 session store 物理分离
- 沙箱容器间文件系统隔离
- 工具 allow/deny 系统级强制

### 5.2 行为级隔离（软）

- OV 知识库按用户目录查询范围（AGENTS.md 约束）
- 管理员私人信息不在 staff 的 seed 文件中

### 5.3 不保证的边界

- 沙箱不是完美安全边界（OpenClaw 文档原话）
- 同一 staff agent 的不同沙箱 session 共享同一 Docker 网络（如果配了的话）
- AI 行为层约束可被 prompt injection 突破（理论上）

## 6. 未来扩展

### 6.1 按岗位拆 Agent

```
staff-dev   → 开发团队（给 git/coding 工具权限）
staff-ops   → 运营团队（给 OV/搜索 工具权限）
staff-sales → 销售团队（给 qichacha/企业查询权限）
```

### 6.2 飞书部门路由

如果飞书开放了部门 API，可以根据用户部门自动路由到对应 agent。

### 6.3 更多渠道

同一架构可直接扩展到企业微信、Slack 等渠道，只需加 binding。
