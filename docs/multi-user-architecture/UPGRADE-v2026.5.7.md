# OpenClaw v2026.4.20 → v2026.5.7 升级实录

**日期**：2026-05-08
**总耗时**：~6 小时（含 fix-forward 修复）
**production 中断窗口**：~50s 主切换 + ~5 次 ≤30s 小重启
**最终结果**：✅ 7 plugins / 4 channels（Discord、飞书、企微、微信公众号）全通；私有特性（多用户路由 + persist 沙箱 + 30MB 附件）全部保留
**Cutover commit**：`8ea4c22c37` (parents: `a620be37ae` 旧 little-grape + `eeef486449` v2026.5.7)

---

## TL;DR

跨 v4.21–v5.7 共 15 个稳定版本，上游 8322 commits / 11946 files / +1.1M-240K 行。私有 fork 23 commits / 40 files。**8 个真冲突**全部按 recipes 解决。Cutover 后**3/4 channels 全断**（feishu/wecom/weixin），通过 4 阶段 fix-forward 全数恢复。最大坑：v5.7 的 channel 插件**架构换代**（不是简单升级），需要换插件 + 转 schema。

---

## 阶段总结

### Phase A — Pre-cutover prep（~30 min）

- 备份分支：`little-grape-backup-pre-v2026.5.7` @ `a620be37ae`
- 快照外部依赖：`~/openclaw-upgrade-snapshot-2026-05-08/`
  - auth-proxy.mjs / package.json / 3 个 systemd unit / openclaw.json / 2 个密钥 / GCP creds
- 创建 worktree：`~/openclaw-upgrade-v2026.5.7/` (branch `upgrade/v2026.5.7-trial`)
- 写 ROLLBACK.md（105 行 8 步）
- 30 秒 auth-proxy 嗅探：HTTP 200 / WS 101 OK

### Phase B — Worktree 试合并（~10 min，远快于 2-4h 预计）

**Merge base 不是 v2026.4.20 是 `1cc2fc82ca`**（v4.19-beta.2 + 756 commits）—— 这是因为 little-grape 在 v4.20 之前就分叉了。

实际 git status 显示 **32 个冲突文件**（不是 merge-tree 输出的 8 个）。分类：

- **8 真冲突**（私有 40 文件 ∩ 上游改） → 按 recipes 手工合并
- **24 机械冲突**（合并历史副作用，私有未真改） → `git checkout --theirs` 取上游

8 真冲突的处理：

| 文件                                                                   | 处理                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/chat-attachments.ts`                                      | 取 theirs + 把 `DEFAULT_CHAT_ATTACHMENT_MAX_MB` 改为 30（保留 30MB 决策）                                                                                                                                              |
| `src/gateway/client.ts`                                                | 50MB maxPayload + 上游新增 directAgent 选项                                                                                                                                                                            |
| `src/gateway/server-methods/{agent,chat}.ts` + `server-node-events.ts` | 取 theirs（用 `resolveChatAttachmentMaxBytes(cfg)`，配合 default=30 返回 30MB）                                                                                                                                        |
| `ui/src/ui/gateway.ts`                                                 | 保留 try/catch + `pendingDeviceTokenRetry` 重置                                                                                                                                                                        |
| `skills/coding-agent/SKILL.md`                                         | 上游 #10 + 我们的进程清理规则升 #11                                                                                                                                                                                    |
| `src/gateway/server/ws-connection/message-handler.ts`                  | **复杂**：取 v5.7 干净版 → 加 `WRITE_SCOPE`（新位置 operator-scopes）+ `resolveAgentRoute` import → 私有路由块插入到 v5.7 重组后的 snapshot 构建处（`message-handler.ts:1452`）→ `loadConfig()` → `getRuntimeConfig()` |

质量门全过：`pnpm tsgo` / `pnpm tsgo:prod` / `pnpm build` / `pnpm test extensions/openshell` (4f/32t) / `pnpm test src/agents/sandbox` (18f/140t)

### Phase C — 部分烟雾测试（含一次 production 事故）

trial gateway dev 模式起 → `gateway call health` 通过。但**清理时 `pkill -KILL -f openclaw` 误杀 production gateway**，systemd `Restart=on-failure` 50s 自愈，无数据损失。**已加入 ROLLBACK.md 的禁用模式列表**。

### Phase C.5 — 多用户路由运行时验证（~30 min）

- 给 dev config 加 main + staff agent + webchat → staff binding
- 加 `gateway.controlUi.allowInsecureAuth: true`（绕过 Secure Context 要求）
- 用 Node `ws` 客户端发合成 connect 帧（id=openclaw-control-ui, displayName=webchat:test001）
- **5/5 全过**：
  - `auth.scopes === ["operator.write"]` ✅（ADMIN_SCOPE 剥离）
  - `snapshot.sessionDefaults.defaultAgentId === "staff"` ✅
  - `snapshot.{configPath, stateDir, authMode} === undefined` ✅（敏感字段擦除）

### Phase D — Cutover（~50s 中断窗口）

**预处理（v4.20 仍在跑，零影响）**：

- `git rm` 解决遗留 `DU skills/nano-banana-pro/*`（来自更早的 \_merge_test 残留）
- 备份 `~/.openclaw/openclaw.json.pre-v5.7-manual`
- `sed 's/"feishu-china"/"feishu"/g'` ×3 处（v5.7 catalog 不识别 feishu-china）

**切换序列**：

1. `git merge --ff-only upgrade/v2026.5.7-trial` → HEAD = `8ea4c22c37`
2. `rm -rf dist/` → `pnpm install` (4m8s) → `pnpm build`
3. systemd unit 字符串 `v2026.4.20` → `v2026.5.7`（`Description` + `OPENCLAW_SERVICE_VERSION`）
4. `systemctl --user daemon-reload`
5. `systemctl --user restart openclaw-gateway.service`
6. **6s** 内 :18790 LISTEN

**Cutover 当时 0 个 active WS 用户连接** → 用户感知中断 = 0。

### Phase E — 紧急 channel 修复（cutover 后发现严重 channel 全断）

启动后只 4 个 plugin loaded（browser/discord/google/memory-core），feishu / wecom / openclaw-weixin 全部静默。**v5.7 的 channels 插件架构整个换代了**：

| 通道                             | v4.20 用的 plugin                                                                                                                          | v5.7 修复方案                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **feishu**                       | `@openclaw-china/channels`（统一插件，提供 dingtalk/feishu-china/wecom/wecom-app/qqbot）—— v5.7 因 Node v25 TS-stripping 永久 fail to load | 装 `@openclaw/feishu` (npm catalog 官方) + 改 manifest `activation.onStartup: true`                                                                                    |
| **wecom**                        | `@yanhaidao/wecom@2.3.270`（TS-only no dist；v5.7 plugin loader 拒绝）                                                                     | 装 `@wecom/wecom-openclaw-plugin@2026.4.23` + 创建 `~/.openclaw/npm/node_modules/openclaw → ~/openclaw` 符号链接（修 ESM 'openclaw' 解析）+ 改 manifest onStartup=true |
| **openclaw-weixin (微信公众号)** | `@tencent-weixin/openclaw-weixin@2.1.1`（TS-only no dist）                                                                                 | 装新版 `@tencent-weixin/openclaw-weixin@2.4.2`（带 dist）+ 改 manifest onStartup=true + 加回 `channels.openclaw-weixin` block + binding                                |

`channels` 外部插件**永久放弃**（@openclaw-china/shared 在 node_modules 里直接 export `.ts`，Node v25 拒绝 TS-strip）。

### Phase F — WeCom Schema 转换（最关键的修复）

WSClient 连上 + 鉴权成功，但 bot **完全不响应消息**。深度读 `@wecom/wecom-openclaw-plugin@2026.4.23/dist/src/accounts.js` 找到根因：

**新插件用 FLAT schema，老 production config 用 NESTED schema**：

| 字段          | 老（production 现状）                | 新（plugin 期望）                           |
| ------------- | ------------------------------------ | ------------------------------------------- |
| Bot ID        | `accounts.default.bot.ws.botId`      | `accounts.default.botId` (拍平)             |
| Bot secret    | `accounts.default.bot.ws.secret`     | `accounts.default.secret` (拍平)            |
| Agent secret  | `accounts.default.agent.agentSecret` | `accounts.default.agent.corpSecret` (改名)  |
| dynamicAgents | `accounts.default.dynamicAgents`     | **`channels.wecom.dynamicAgents` (顶层！)** |

新 plugin 读 `merged.botId === undefined` → `hasBotCredentials = false` → 永久 fall through 到 "agent-only 等待 abort" 分支 → WSClient 永不创建。

启动日志 `[info]: [ '[ws]', 'ws client ready' ]` 是 OpenClaw gateway 自己的 HTTP server WS 子系统 ready，**不是企微 bot ws**，容易误判（曾误判过一次）。

转换完成后日志：

```
[wecom] starting wecom[default] (mode: websocket)
[wecom] [default] [2026.4.23] Initializing WSClient with SDK...
[wecom] [default] Connecting to WebSocket: wss://openws.work.weixin.qq.com...
[wecom] [default] WebSocket connection established, sending auth...
[wecom] [default] Authentication successful
[wecom] [default] Heartbeat timer started, interval: 30000ms
```

### Phase G — Dispatch alias 文件持久化

WeCom + feishu + weixin 收到消息但**回复 crash**：

```
[wecom] [plugin] Failed to process message: ERR_MODULE_NOT_FOUND
  Cannot find module '/home/misselvexu/openclaw/dist/runtime-plugins.runtime.js'
```

`dist/` 缺 4 个 alias 文件（`abort.runtime.js` / `get-reply-from-config.runtime.js` / `route-reply.runtime.js` / `runtime-plugins.runtime.js`）。**这些是 gateway-level dispatcher 代码，所有 plugin 用它们 deliver 消息到 agent**。

修复模式：从 trial worktree 拷过来 + restart。

⚠️ **每次 `pnpm openclaw plugins install` 操作后这 4 个文件会被 wipe**。本次升级期间被 wipe 3 次（每装一个新 plugin 就丢一次）。`scripts/runtime-postbuild.mjs` **不会重生**这 4 个文件（试过；它依赖 stamp 一致性优化）。

---

## 升级前 vs 升级后对比

### Plugin 加载列表

|          | v4.20                                                                                 | v5.7                                                                     |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Bundled  | acpx, browser, device-pair, file-transfer, memory-core, phone-control, talk-voice (7) | browser, discord, google, memory-core (4)                                |
| Channel  | (channels 外部插件统一)                                                               | feishu (npm), wecom-openclaw-plugin@2026.4.23, openclaw-weixin@2.4.2 (3) |
| **总数** | 7 (大量 bundled)                                                                      | **7 (4 bundled + 3 channel)**                                            |

注：v5.7 把 acpx / device-pair / file-transfer / phone-control / talk-voice 移出了 bundled 启动列表（按 manifest activation 判断），但代码仍在；google 是新增 bundled。

### 私有特性保留状态（12 项细分）

| #   | 私有功能                                       | 状态                                                                       |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| a   | WebChat 多用户路由 (`message-handler.ts:1452`) | ✅ Phase B 手工合并 + Phase C.5 运行时验证                                 |
| b   | 30MB 附件限制                                  | ✅ `DEFAULT_CHAT_ATTACHMENT_MAX_MB = 30`                                   |
| c   | WebSocket payload 50MB                         | ✅ 上游未改 server-constants.ts                                            |
| d-f | workspaceAccess "persist" 模式（5 处分支）     | ✅ 自动保留                                                                |
| g   | MCP `_meta.openclaw_workspace` 注入            | ✅ 自动保留                                                                |
| h   | Discord error guard                            | ✅ 自动保留                                                                |
| i   | Device identity 纯 JS（@noble）                | ✅ 自动保留                                                                |
| j   | URL 地址栏同步                                 | ✅ 自动保留                                                                |
| k   | gateway.ts crypto fallback                     | ✅ Phase B 手工合并                                                        |
| l   | Dockerfile 工具链扩展                          | ✅ 上游 rename 后 auto-merge 到 `scripts/docker/sandbox/Dockerfile.common` |

### 下游配置变化（openclaw.json）

- `channels.feishu-china` → `channels.feishu`（新 plugin 用 catalog 标准 id）
- `channels.feishu.sendMarkdownAsCard` → `channels.feishu.renderMode: "card"`（schema 字段改名）
- `channels.wecom.accounts.default.bot.ws.{botId,secret}` 拍平到 `accounts.default.{botId,secret}`
- `channels.wecom.accounts.default.agent.agentSecret` 改名 `corpSecret`
- `channels.wecom.accounts.default.dynamicAgents` 提到顶层 `channels.wecom.dynamicAgents`
- `channels.openclaw-weixin` 重新加回（带 `accounts: {}`）—— plugin 自管 state
- `plugins.entries.{channels,wecom,openclaw-weixin}` 旧条目移除
- `plugins.entries.{feishu,wecom-openclaw-plugin,openclaw-weixin}` 新条目加入

---

## 私有 fork 改动

`extensions/feishu/openclaw.plugin.json`：`activation.onStartup: false → true`

理由：bundled feishu 默认 `onStartup: false`（设计是按需加载），但我们 production 必须启用。本来想通过 `plugins.entries.feishu.activation.onStartup: true` 在 config 层 override，但 v5.7 的 PluginEntrySchema 是 `.strict()` 不接受 `activation` 字段。所以只能改 manifest 本身。

**未来上游升级时需要手工保持这个 patch**。

---

## 关键事故与教训

### 事故清单

1. **14:38 误杀 production gateway**：`pkill -KILL -f openclaw` 模式过宽，匹配并杀掉了 production `openclaw-gateway` 进程。systemd `Restart=on-failure` 50s 自愈。
2. **15:35 schema 字段不被接受导致启动失败**：plugins.entries 加了 `activation`/`source` 字段，被 `.strict()` schema 拒绝，systemd 进入 too-quickly cooldown。立即 cp 备份恢复。
3. **17:47 channels.feishu 字段不被接受**：sendMarkdownAsCard 不在新 schema，gateway 启动失败。立即恢复。
4. **17:45 dispatch alias 第三次被 wipe**：每次 `pnpm openclaw plugins install` 都会清掉 4 个 alias 文件。

### 防再发硬规则（已写入 ROLLBACK.md）

- ❌ **绝对禁止** `pkill -f openclaw` / `pkill -f gateway` / `pkill -f node` 等宽泛模式
- ✅ 用具体 PID（启动时 `echo $! > /tmp/.pid`）；备用模式必须含 `--dev`：`pkill -f "openclaw\.mjs.*--dev"`
- ✅ 任何 kill 后必须 `ss -ltn | grep ":18790"` + `systemctl --user is-active openclaw-gateway.service` 复检
- ❌ **绝对禁止** `openclaw doctor --fix` 在 production 上裸跑（会**静默删除** unknown channel 的 secrets，agent 取证）
- ⚠️ **每次 `pnpm openclaw plugins install` 操作必须 cp 4 个 dispatch alias 回来**：
  ```bash
  for f in abort.runtime.js get-reply-from-config.runtime.js route-reply.runtime.js runtime-plugins.runtime.js; do
    cp ~/openclaw-upgrade-v2026.5.7/dist/$f ~/openclaw/dist/$f
  done
  ```

### 一般教训

1. **不要相信 `git merge-tree --name-only` 输出的冲突数**：本次 truncate 显示 8，实际 32（merge base 不是预期的）。用 `--write-tree` + 实际 merge 才能数清。
2. **不要无脑 doctor --fix**：会按 v5.7 catalog 静默删除任何不在 catalog 里的 channel block（连同 secrets）。
3. **`runtime-postbuild` 不会重生 dispatch alias 文件**：经实测，跑了它 alias 文件还是没回来。alias 文件是 tsdown 阶段产物，runtime-postbuild 只做 stamp/aliases-of-other-kind。
4. **新插件可能用完全不同的 schema**：`@yanhaidao/wecom` 用 nested，`@wecom/wecom-openclaw-plugin` 用 flat。不要假设 channels.<id> 配置兼容跨插件版本。
5. **Plugin install 过程中 dist 会被改动**：每次 install 都 copy 一些文件、删一些文件，dispatch alias 是受害者之一。

---

## 后续维护事项

### 必做

- ❗ **不要再 `pnpm openclaw plugins install` 任何东西**（会再次 wipe alias），除非已经 ready 立刻 cp 回 4 个 alias
- 找时间跑一次干净的 `pnpm build`（不带任何 install）让 alias 持久化
- `extensions/feishu/openclaw.plugin.json` 的私有 patch 需要在下次升级时手工保留

### 可选（按需）

- `@openclaw-china/channels` 永久修复：fork `@openclaw-china/shared` 加 `dist` build；或迁移所有 channel 到上游官方插件
- 12 个 `~/arsenals/skills/*` 符号链接：用 `cp -RL` 替代 symlink（v5.7 与 v4.20 行为一致，都 reject symlink-escape，需要物理拷贝）
- 清理 worktree（如不需要保留）：`git worktree remove ~/openclaw-upgrade-v2026.5.7 && git branch -D upgrade/v2026.5.7-trial`
- systemd unit 文档化 `OPENCLAW_SERVICE_VERSION` 滚版到 release runbook
- 评估是否 fork-build 老 wecom plugin (`@yanhaidao/wecom`) 作为兜底（agent 评估为 "1-3 小时调试 + 大概率运行时炸"，不推荐）

### 备份位置（建议保留半年）

| 路径                                                            | 内容                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `little-grape-backup-pre-v2026.5.7` (git branch @ `a620be37ae`) | cutover 前 little-grape 完整 snapshot                                             |
| `~/openclaw-upgrade-snapshot-2026-05-08/`                       | auth-proxy + 3 systemd unit + openclaw.json + 2 secrets + GCP creds + ROLLBACK.md |
| `~/.openclaw/openclaw.json.pre-v5.7-manual`                     | cutover 之前的 production config                                                  |
| `~/.openclaw/openclaw.json.pre-channel-fix`                     | Phase E 之前                                                                      |
| `~/.openclaw/openclaw.json.pre-wecom-schema-fix`                | Phase F 之前                                                                      |
| `~/.openclaw/openclaw.json.bak` / `.bak.1` / `.bak.2`           | gateway 自动 rotation                                                             |
| `~/openclaw-upgrade-v2026.5.7/`                                 | trial worktree（dist alias 永久副本，dispatch alias 修复源）                      |

---

## 验证矩阵（升级完成后实测）

| 项                                                     | 状态                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Discord 收发消息                                       | ✅                                                                                    |
| 飞书收发消息                                           | ✅（admin pairing 已批准 `ou_5396a070b57532dc952776a3a7dca921`）                      |
| 企微收发消息                                           | ✅（admin XuHongWei + dynamicAgents 路由）                                            |
| 微信公众号收发                                         | ✅（plugin 自管 account `5586b614c04d-im-bot`）                                       |
| WebChat 多用户登录（LDAP / access-code / WeCom OAuth） | ✅                                                                                    |
| WebChat 路由非 admin → staff agent + 剥离 ADMIN_SCOPE  | ✅（Phase C.5 运行时验证 + production 复验）                                          |
| Snapshot 字段擦除（configPath/stateDir/authMode）      | ✅                                                                                    |
| 30MB 附件                                              | ✅（DEFAULT_CHAT_ATTACHMENT_MAX_MB = 30）                                             |
| 7 plugins loaded                                       | browser, discord, feishu, google, memory-core, openclaw-weixin, wecom-openclaw-plugin |
| 3 systemd service active                               | gateway + auth-proxy + discord-tunnel                                                 |
| 3 端口 LISTEN                                          | 18789 + 18790 + 18080                                                                 |

---

## Part IX：Runtime alias 持久化根因 + 三层防护（v2026.5.7 升级遗留）

### 背景

cutover 完成后两次出现 channel 全断（dispatch 报 `ERR_MODULE_NOT_FOUND` 找不到 `dist/abort.runtime.js` 等 4 个 alias 文件）。临时用 `cp` 从 trial worktree 恢复都能修，但每次 `pnpm openclaw plugins install` 或 `pnpm install` 后都会再丢。

### 根因（双重 bug）

**Bug A：postinstall closure expander 把 alias 当 unreachable 删掉**

- `scripts/postinstall-bundled-plugins.mjs::pruneInstalledPackageDist` 用 `dist/postinstall-inventory.json` 作为 seed
- 调用 `scripts/lib/package-dist-imports.mjs::expandPackageDistImportClosure` 做 BFS 找可达文件
- 真实消费者 (`dispatch-XXX.js`) 直接 `import "./abort.runtime-Bc5sEKqw.js"`（hashed）
- 稳定 alias `abort.runtime.js`（body：`export * from "./abort.runtime-Bc5sEKqw.js"`）**没有任何代码 import 它**
- 所以 BFS 把 alias 判为 unreachable → `unlink` 删除
- 每次 `pnpm install` 重复

**Bug B：runtime-postbuild 在 alias 候选 ambiguous 时直接删除**

- `scripts/runtime-postbuild.mjs::writeStableRootRuntimeAliases` 收集所有 `xxx.runtime-HASH.js` 候选
- `resolveAliasCandidate` 试图找"wrapper"（其他 candidate re-export 自己的那个）
- 找不到 wrapper → 返回 null → 旧代码 `fsImpl.rmSync?.(aliasPath, { force: true })` **删除 alias**
- 我们 5 个新发现的 missing alias 走的是这个路径：approval-handler / channel / register.sync / send / status 都有 2-4 个候选都不互相 re-export

### 三层防护（已 ship）

| Fix   | 文件                                           | 时机            | 行为                                                                                              |
| ----- | ---------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| **A** | `scripts/lib/package-dist-imports.mjs:171-197` | install-time    | closure 末尾扫一遍 alias↔hashed 配对，把 stable alias 和所有 hashed sibling 一起加 keep-set       |
| **D** | `scripts/runtime-postbuild.mjs:189-263`        | build-time      | ambiguous 时不删，先看现有 alias 是否仍指向有效 candidate（保留），否则按 mtime 选最新（warn）    |
| **F** | `scripts/check-runtime-alias-files.mjs`        | build + install | 扫 `dist/` 找 `xxx.runtime-HASH.js`，确认 `xxx.runtime.js` 存在；缺失 → build fail / install warn |

**install.runtime 例外**：marker-based 解析（plugin install vs daemon install API 不同），Fix D 不接管 —— 否则可能 mtime 选到错的实现。`writeStableRootRuntimeAliases` 内部判 `aliasFileName === PLUGIN_INSTALL_RUNTIME_ALIAS.aliasFileName` 时仍走原 `rmSync` 分支。

### 验证

```bash
# build-time gate
pnpm build   # 末尾应有 "[check-runtime-alias-files] OK: N runtime alias pair(s) intact under dist/"

# 单独跑 sanity check
node scripts/check-runtime-alias-files.mjs
echo $?   # 0 = OK, 1 = missing alias

# 单元测试
pnpm test test/scripts/runtime-postbuild.test.ts          # Fix D + 既有
pnpm test test/scripts/package-dist-imports.test.ts       # Fix A
```

### 维护 SOP

- 任何 `pnpm openclaw plugins install`、`pnpm install`、`pnpm build` 后跑 `node scripts/check-runtime-alias-files.mjs` 查看输出
- 出现 `ambiguous alias ... using newest=` warning 是**正常**的（Fix D 主动选 fallback，已 log 给运维）
- 出现 `ERROR: dispatch runtime alias files missing` → Fix A/D 失效，立即从 `~/openclaw-upgrade-v2026.5.7/dist/` cp 兜底，然后 grep `pruneInstalledPackageDist` log 找下一个被遗漏的删除路径

### 上游 PR

Fix A + Fix D + Fix F + 两组 unit test 已计划提交到 `openclaw/openclaw`：

- 原标题候选：`fix(scripts): preserve runtime alias↔hashed-sibling pairs (closure expander + ambiguous candidate handler)`
- 复现：在 v2026.5.7 dist 上跑 `pnpm install` 两遍，第二遍 `dist/abort.runtime.js` 等会消失
- 影响面：所有 v2026.5.7 部署都会踩，私有 fork 已 ship，公有用户暂时只能手工 `pnpm build` 兜底

### 兜底方案（如三层防护都失效）

```bash
# 1) 从 trial worktree cp 全量 dist（已知 working）
rm -rf ~/openclaw/dist && cp -a ~/openclaw-upgrade-v2026.5.7/dist/ ~/openclaw/dist/
# 2) 或单独 cp 4 个最常见的 alias
for f in abort.runtime.js get-reply-from-config.runtime.js route-reply.runtime.js runtime-plugins.runtime.js; do
  cp ~/openclaw-upgrade-v2026.5.7/dist/$f ~/openclaw/dist/$f
done
# 3) restart
systemctl --user restart openclaw-gateway.service
```

trial worktree (`~/openclaw-upgrade-v2026.5.7/`) 即使 patch 自洽后也建议保留 1-2 周作为 nuclear fallback，期间 production rebuild 多次确认无 regression 后再删。
