# OpenClaw v2026.5.7 → v2026.5.22 升级实录

**日期**：2026-05-27
**总耗时**：~80 min（Phase A 5min + Phase B 30min + Phase C 10min + Phase D cutover 27s + 验证 + 文档）
**production 中断窗口**：**27 秒**（restart 9s + 4 channels 全部 auth 18s）
**最终结果**：✅ 8 plugins / 4 channels (Discord/飞书/企微/微信公众号) 全通；私有特性 12 项 + Fix A/D/F 全部保留；意外修好 v5.7 时遗留的 `channels` plugin
**Cutover commit**：`e4bd42f153` (parents: `52c0df1ca8` 旧 little-grape + `a374c3a5bf` v2026.5.22)
**备份分支**：`little-grape-backup-pre-v2026.5.22` @ `52c0df1ca8`

---

## TL;DR

跨 v2026.5.7 → v2026.5.22，**17 天 10,480 upstream commits / 11,273 files / +942K -390K 行**。私有 fork 自 v5.7 仅 6 commits（Fix A/D/F + Part IX 文档 + feishu manifest）。`git merge` 表面 354 conflicts，但 **347 是 v4.20-era mechanical 残留**（bulk `checkout --theirs`），**真正需要手工的只有 7 个**。其中 1 个 critical（schema.base.generated.ts modify/delete）通过 `git rm` + 源头 zod literal 重定向解决。**比 v5.7 升级风险显著低**：上游没动 channel plugin 架构，也没改私有路由的插入位点（路由块 38 行自动合并干净）。

---

## 阶段总结

### Phase A — Pre-cutover prep（~5 min，零 production 风险）

- 备份分支：`little-grape-backup-pre-v2026.5.22` @ `52c0df1ca8`
- 快照外部依赖：`~/openclaw-upgrade-snapshot-2026-05-27/`（196K，8 files + 2 子目录）
  - auth-proxy.mjs / package.json / 3 systemd units / openclaw.json (994 行) / GCP creds / wecom-api.env / discord.env
- 创建 worktree：`~/openclaw-upgrade-v2026.5.22/` (branch `upgrade/v2026.5.22-trial`)
- 写 ROLLBACK.md（含双层 nuclear fallback：v5.22 backup dist + v5.7 trial worktree）
- 30 秒嗅探：3 services active / 3 ports LISTEN / WS 101 / 公网 LB 200 / 8 active WS

### Phase B — Worktree 试合并（~30 min，全部在 trial worktree）

**Merge base = v4.20-era `46a04099a4`**（不是 v5.7，因为 trial branch 通过 `8ea4c22c37` merge commit 还能追溯到 v4.20）→ 表面 **354 conflicts**。

分类：

- **347 mechanical**（v4.20-era residue：120 package.json + 99 .test.ts + 18 docs + 181 extensions 等）→ bulk `git checkout --theirs` (with safe fallback via `git show v2026.5.22:<file>`)
- **7 真冲突**（私有 6 commits 与上游 v5.22 真实交集）

**7 真冲突解决配方**：

| #   | 文件                                                      | 配方                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `qa/scenarios/models/anthropic-opus-setup-token-smoke.md` | 接受上游 `requiredModel: claude-opus-4-7` + 保留我们的 `requiredEnv: OPENCLAW_LIVE_SETUP_TOKEN_VALUE`                                                                                                                                                                            |
| 2   | `skills/coding-agent/SKILL.md`                            | v5.22 把 Rules 重组为 bullet 列表 → 接受 v5.22 baseline + 重新插入私有 "🔴 MUST KILL all coding agent processes" 规则                                                                                                                                                            |
| 3   | `skills/nano-pdf/SKILL.md`                                | take ours（私有 CJK 字体说明 + 扩展命令是 strict superset）                                                                                                                                                                                                                      |
| 4   | **`src/config/schema.base.generated.ts`**                 | **modify/delete** — 上游 commit `55d1cf87d7` "refactor: compute base config schema at runtime" 删除整个 29,440 行 generated 文件，迁移到运行时计算。**`git rm`** 接受删除 → `"persist"` 自动保留在 zod source（L712-713）+ types source（L43）                                   |
| 5   | `src/config/zod-schema.agent-runtime.ts`                  | take v5.22 的 `validateSandboxBindEntries(data.binds, ctx)` helper extraction（L203）                                                                                                                                                                                            |
| 6   | `src/gateway/client.ts`                                   | take ours `maxPayload: 50 * 1024 * 1024` + 丢弃 `directAgent`（v5.22 移除该变量）                                                                                                                                                                                                |
| 7   | `src/gateway/server/ws-connection/message-handler.ts`     | **仅 imports 1 hunk**：BOTH halves（保留 v5.22 新增 `ADMIN_SCOPE, APPROVALS_SCOPE` + `GatewayMethodRegistry` + 保留私有 `WRITE_SCOPE from operator-scopes.js`）。**🎉 38 行私有路由块在 L1699-1720 自动合并干净**（resolveAgentRoute call + scope 降级 + snapshot 擦除全部存在） |

**Silent auto-merge watchlist（18/18 PASS）**：MAX_PAYLOAD_BYTES=50MB、DEFAULT_CHAT_ATTACHMENT_MAX_MB=30、MEDIA_MAX_BYTES=30MB、zod persist literal、types persist、MCP `_meta.openclaw_workspace`、Discord reconnect guard、UI device-identity 纯 JS、UI gateway crypto fallback、URL session-key sync、Dockerfile 工具链、openshell 5 persist 分支、sandbox 各 persist 分支、context.ts:54 skip-syncSkills、Feishu onStartup=true、Fix A、Fix D `preserveOrPickFallbackAlias`、Fix F sanity 脚本 + build-all + postinstall wire-in。

**Fix D 在 v5.22 新结构下自动 rebase**：v5.22 把旧 `resolveAliasCandidate(positional)` 重命名为 `resolveStableRootRuntimeAliasCandidate({object args})` 并新增 helper，但 git 3-way merge **正确地把我们的 preserve-or-fallback 逻辑 + install.runtime 例外 + `preserveOrPickFallbackAlias` 调用都迁移到了新的 `if (!candidate)` 分支**，无需手工编辑。

**Post-merge 修复（Phase B 内发现并解决）**：

| 文件                                                     | 问题                                                                                                                   | 修复                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auto-reply/reply/commands-export-session.ts`        | bulk-restore script 意外 append 而非 overwrite，留下 duplicate `addCollisionSuffix` + `writeNewDefaultExportFile` 函数 | 单独 `git show v2026.5.22:<file> > <file>` 重新覆盖                                                                                     |
| `src/security/exec-filesystem-policy.ts`（v5.22 新文件） | 用 narrow union `"none" \| "ro" \| "rw"`，不接受我们的 `"persist"`                                                     | 改 import `SandboxWorkspaceAccess` type（含 persist），同时修 `isExecFilesystemConstrained` 让 persist 像 rw 一样不被视为 "constrained" |

**质量门**（B.6 全过）：

- `pnpm install`：4m13s（部分 optional binaries 网络问题但 core install OK）
- `pnpm build`：158 alias pair(s) intact under dist/，Fix F sanity gate exit 0
- `pnpm tsgo:prod`：0 errors
- `pnpm test test/scripts/runtime-postbuild.test.ts test/scripts/package-dist-imports.test.ts`：30/30 passed (含 6 Fix D + 5 Fix A + 17 existing + 2 ambiguous-alias warning 触发)
- `pnpm test extensions/openshell`：34/34 passed
- `pnpm test src/agents/sandbox`：166/166 passed

**Phase B commit**：`e4bd42f153`（parents `52c0df1ca8` + `a374c3a5bf`），含 pnpm-lock.yaml 更新（amend）。

### Phase C — 多用户路由运行时验证（~10 min）

在 trial worktree dev port 19001 起 gateway（loopback only，不动 production），用 Node `ws` 客户端发合成 connect 帧。

**v5.22 协议演进**（探针需要适配，对真实客户端透明）：

- `PROTOCOL_VERSION` 从 3 升到 4
- 请求帧 `id` 必须是 string（v5.7 接受 integer）
- Control UI WebSocket 强制 `Origin` header（`CONTROL_UI_ORIGIN_NOT_ALLOWED`）

适配后 **5/5 全过**：

```json
{
  "scope_is_write_only": true, // auth.scopes === ["operator.write"] ✅
  "route_to_staff": true, // snapshot.sessionDefaults.defaultAgentId === "staff" ✅
  "no_configPath": true, // snapshot.configPath === undefined ✅
  "no_stateDir": true, // snapshot.stateDir === undefined ✅
  "no_authMode": true // snapshot.authMode === undefined ✅
}
```

**安全清理**：specific PID kill (NOT `pkill -f openclaw`)，4 trial PIDs (3817327/3817510/3817354/3817353/3817342) 全部 terminated；production gateway PID 3569142 全程未变；3 services active；3 ports LISTEN；WS upgrade 仍 101。

### Phase D — Cutover（**27 秒中断**，远低于 50s 预计）

**预处理**：

- `cp -a ~/openclaw/dist ~/.openclaw-dist-backup-pre-v2026.5.22-1779870856/dist`（117M，3755 files，nuclear fallback）

**切换序列**：

1. `git merge --ff-only upgrade/v2026.5.22-trial` → HEAD = `e4bd42f153`
2. `rm -rf dist/` → `CI=true pnpm install` (4m13s) → `pnpm build`（含 Fix F sanity exit 0）
3. `sed -i 's/v2026\.5\.7/v2026.5.22/g; s/=2026\.5\.7/=2026.5.22/g' ~/.config/systemd/user/openclaw-gateway.service`
4. `systemctl --user daemon-reload`
5. `systemctl --user restart openclaw-gateway.service`（auth-proxy + discord-tunnel 不动）
6. **9s** 内 `:18790 LISTEN`，**18s** 内 4 channels 全部 auth

**时间线（16:42:00 → 16:42:27）**：

- 16:42:00 - restart issued
- 16:42:09 - `:18790 LISTEN`
- 16:42:18 - `[gateway] http server listening (8 plugins: ...)`
- 16:42:19 - `[gateway] ready`
- 16:42:20 - `[discord] gateway proxy enabled`
- 16:42:25 - `[wecom] WebSocket connection established`
- 16:42:27 - `[wecom] Authentication successful`
- 16:42:27 - `[openclaw-weixin] weixin monitor started`
- 16:42:27 - `[feishu] WebSocket client started`
- 16:42:27 - `[discord] client initialized`

**Cutover 当时活跃 WS 连接 8 个** → 浏览器自动重连，无用户感知中断报告。

### 🎁 意外发现（v5.22 自动修好 v5.7 遗留问题）

v5.7 cutover 时 `channels` plugin 因 `@openclaw-china/shared/src/index.ts` 触发 Node v25 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 永久 fail to load（详见 UPGRADE-v2026.5.7.md Phase E §"channels 外部插件加载失败"）。v5.22 cutover 后 **`channels` plugin 在 8 plugins 列表中加载成功**：

```
http server listening (8 plugins: browser, channels, discord, feishu, google,
  memory-core, openclaw-weixin, wecom-openclaw-plugin; 12.9s)
```

vs v5.7 时只有 7 plugins（缺 channels）。**v5.22 上游应该是更新了 `@openclaw-china/shared` 或修了 ts-stripping 路径**。这是 Phase E/F/G 之前"放弃 channels 插件、改用单独装 feishu/wecom/openclaw-weixin"决策的天然回正。

我们的 4 个独立 channel 插件依然在跑（`~/.openclaw/extensions/feishu`、`wecom-openclaw-plugin`、`openclaw-weixin`），加上 `channels` 重新工作 = **冗余 + 健壮**。后续如果想清理冗余可在低峰窗口决策。

---

## 12 项私有特性 + 3 个 build pipeline 补丁全部携带

| #     | 私有项                                          | 文件:行 (v5.22 production)                                                                                                                                           | 状态                                  |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| a     | WebChat 多用户路由 + scope 降级 + snapshot 擦除 | `src/gateway/server/ws-connection/message-handler.ts:1699-1720`                                                                                                      | ✅ Phase C 运行时验证                 |
| b     | `workspaceAccess: "persist"` enum               | `zod-schema.agent-runtime.ts:712-713` / `types.agents-shared.ts:43`                                                                                                  | ✅ grep 验证                          |
| c     | 30MB chat 附件                                  | `src/gateway/chat-attachments.ts:59` `DEFAULT_CHAT_ATTACHMENT_MAX_MB = 30`                                                                                           | ✅                                    |
| d     | 50MB WS payload + 100MB buffer                  | `src/gateway/server-constants.ts:3-4`                                                                                                                                | ✅                                    |
| e     | MCP `_meta.openclaw_workspace`                  | `src/agents/pi-bundle-mcp-runtime.ts:361`                                                                                                                            | ✅                                    |
| f     | Discord reconnect-exhausted guard               | `extensions/discord/src/monitor/gateway-plugin.ts:127-133`                                                                                                           | ✅                                    |
| g     | UI device-identity 纯 JS                        | `ui/src/ui/device-identity.ts:1-2` `@noble/ed25519` + `@noble/hashes/sha2.js`                                                                                        | ✅                                    |
| h     | UI gateway crypto fallback                      | `ui/src/ui/gateway.ts:321,486-493,569,623` `pendingDeviceTokenRetry`                                                                                                 | ✅                                    |
| i     | URL session-key sync                            | `ui/src/ui/app-gateway.ts:18,444-445` `syncUrlWithSessionKey`                                                                                                        | ✅                                    |
| j     | Feishu activation.onStartup=true                | `extensions/feishu/openclaw.plugin.json:4`                                                                                                                           | ✅                                    |
| k     | Dockerfile sandbox 工具链                       | `scripts/docker/sandbox/Dockerfile.common:26,30` ffmpeg/pandoc/CJK                                                                                                   | ✅                                    |
| l/m/n | Sandbox persist 分支 + skip-syncSkills          | `src/agents/sandbox/{fs-bridge,fs-paths,remote-fs-bridge,workspace-mounts,types}.ts` + `context.ts:54` + `extensions/openshell/src/fs-bridge.ts:210/250/269/287/302` | ✅                                    |
| Fix A | runtime alias 配对 (install-time)               | `scripts/lib/package-dist-imports.mjs:170-197`                                                                                                                       | ✅                                    |
| Fix D | runtime alias preserve-or-fallback (build-time) | `scripts/runtime-postbuild.mjs::preserveOrPickFallbackAlias`                                                                                                         | ✅ auto-rebased onto v5.22 new helper |
| Fix F | runtime alias sanity check                      | `scripts/check-runtime-alias-files.mjs` + wired into `scripts/build-all.mjs` + `scripts/postinstall-bundled-plugins.mjs`                                             | ✅                                    |

---

## 本轮 vs v5.7 升级对比

| 维度                       | v4.20→v5.7 (上轮)                                                                | **v5.7→v5.22 (本轮)**                                               |
| -------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 上游 commits               | 8,322                                                                            | **10,480** ⬆️                                                       |
| 上游 files                 | 11,946                                                                           | **11,273** ≈                                                        |
| 时间跨度                   | ~6 周                                                                            | **17 天** ⬇️（节奏更快）                                            |
| 私有 fork commits          | 23                                                                               | **6** ⬇️                                                            |
| 真冲突数                   | 8                                                                                | **7** ⬇️                                                            |
| 最高难度冲突               | `chat-attachments.ts`（重构 + 值冲突）+ `message-handler.ts`（routing 精细插入） | `schema.base.generated.ts`（modify/delete）                         |
| message-handler.ts 复杂度  | 复杂（routing 块需精细重插入）                                                   | **trivial（仅 imports 1 hunk）** ⬇️                                 |
| Channel plugin 重大变更    | 🔴 4 channels 全断要重新装                                                       | **🟢 无 channel 架构换代** + 反而修好了 v5.7 遗留的 channels plugin |
| Cutover 后期需 fix-forward | 🔴 必需（Phase E/F/G/H/I/J）                                                     | **🟢 0 fix-forward**                                                |
| **Cutover 中断窗口**       | ~50s                                                                             | **27s** ⬇️                                                          |
| 总耗时                     | ~6 小时（含 fix-forward）                                                        | **~80 min**                                                         |

**结论**：本轮升级风险与实际复杂度都**显著低于上轮**。3 个核心原因：

1. 我们 fork 自 v5.7 后只有 6 commits（vs 上次 23）→ carry-forward 面积小
2. v5.22 没动 channel plugin 架构（上次最大坑）+ 反向修好了 v5.7 的 channels 问题
3. message-handler.ts 上游 churn 都在 imports 区，**私有路由块的插入位点完整保留** → git 3-way merge 自动合并干净

---

## 备份位置（建议保留至 v2026.6.x 升级前）

| 路径                                                              | 内容                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `little-grape-backup-pre-v2026.5.22` (git branch @ `52c0df1ca8`)  | cutover 前完整 snapshot                                                           |
| `~/openclaw-upgrade-snapshot-2026-05-27/`                         | auth-proxy + 3 systemd unit + openclaw.json + 2 secrets + GCP creds + ROLLBACK.md |
| `~/.openclaw-dist-backup-pre-v2026.5.22-1779870856/dist`          | cutover 前 production dist (117M)，nuclear fallback                               |
| `~/openclaw-upgrade-v2026.5.22/` trial worktree                   | branch `upgrade/v2026.5.22-trial` @ `e4bd42f153`，验证用                          |
| **`~/openclaw-upgrade-v2026.5.7/`** trial worktree (上轮升级保留) | **保留至 v5.22 cutover 1 周后再删**（per user 决策）—— 含完整 v5.7 dist 兜底      |

历史备份分支：

- `little-grape-backup-pre-v2026.4.11`
- `little-grape-backup-pre-v2026.4.20`
- `little-grape-backup-pre-v2026.5.7` @ `a620be37ae`
- `little-grape-backup-pre-v2026.5.22` @ `52c0df1ca8` ← **新增**

---

## 验证矩阵

| 项                                    | 状态                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Discord 收发消息                      | ✅（probe @ 16:42:27）                                                                                   |
| 飞书 WebSocket                        | ✅（client started @ 16:42:27）                                                                          |
| 企微 (WeCom)                          | ✅（authenticated @ 16:42:27）                                                                           |
| 微信公众号 (openclaw-weixin)          | ✅（monitor started @ 16:42:27）                                                                         |
| **`channels` plugin (v5.7 遗留问题)** | ✅ **现已修复**（v5.22 加载成功）                                                                        |
| WebChat 多用户路由 5/5 断言           | ✅（Phase C trial gateway 验证）                                                                         |
| 30MB 附件                             | ✅（DEFAULT_CHAT_ATTACHMENT_MAX_MB = 30）                                                                |
| 50MB WS payload                       | ✅（MAX_PAYLOAD_BYTES = 50 _ 1024 _ 1024）                                                               |
| Fix F runtime-alias sanity            | ✅ exit 0，158 alias pair(s) intact                                                                      |
| 8 plugins loaded                      | browser, **channels** (新), discord, feishu, google, memory-core, openclaw-weixin, wecom-openclaw-plugin |
| 3 systemd service active              | gateway + auth-proxy + discord-tunnel                                                                    |
| 3 端口 LISTEN                         | 18789 + 18790 + 18080                                                                                    |
| systemd unit version 字符串           | `OPENCLAW_SERVICE_VERSION=2026.5.22` ✅                                                                  |
| 公网 LB ingress                       | 200 OK（pre + post cutover）                                                                             |

---

## 升级 SOP 改进（沉淀给未来升级用）

### 复用经验

1. **5 阶段 (A/B/C/D + 可选 E) pattern** 仍然有效，本轮 Phase E（fix-forward）首次没用到
2. **trial worktree + bulk `checkout --theirs` for mechanical conflicts** —— 上轮的 24 mechanical → 本轮的 347 mechanical 都是同一处理方式
3. **silent auto-merge watchlist** 是关键防线 —— 18/18 PASS 给了 Phase C 的运行时验证充足信心
4. **Phase D 双层 nuclear fallback**（v5.22 dist snapshot + v5.7 trial worktree） —— 即使三层 patch 全失效也能在 30 秒内回 v5.7

### 本轮新增 sub-rule

1. **bulk `git checkout --theirs` 不可靠**：当数百文件需要批量取上游时，`xargs git checkout --theirs` 可能 silently 失败（git 已"认为"resolved 但内容仍含 markers）。**替代方案**：`git show v2026.5.22:<file> > <file>` 逐文件覆盖 → 然后 `git add`。但即使这个方案也可能 append 而非 overwrite（commands-export-session.ts 案例），所以**最后必须 grep 找 marker / 二次 diff 验证**。

2. **v5.22 协议演进对探针的影响**：
   - 探针必须用 `minProtocol`/`maxProtocol`（不再是 `protocol`）
   - `id` 必须是 string
   - WebSocket 必须带 `Origin` header
   - 真实客户端（浏览器 + auth-proxy 透传）自动适配，但合成探针需 update

3. **NEVER `pkill -f openclaw`**：v5.7 升级时被这条 footgun 杀掉过 production gateway。**正确做法**：启动时记录 PID 到 `/tmp/<task>.pid` → kill 时只用具体 PID → 再用 `pgrep -f` 找特定进程串 → kill 前再次 sanity check 该 PID 不是 production（`pgrep -f 'openclaw/dist/index.js gateway --port 18790'`）

4. **CI=true 环境变量**：`rm -rf dist && pnpm install` 不在 TTY 下需要 `CI=true pnpm install` 才会跳过 modules-dir-purge confirm

### 待 v2026.5.23+ 时考虑

- `channels` plugin 在 v5.22 重新工作 → 可以决策是否退役 `~/.openclaw/extensions/{feishu,wecom-openclaw-plugin,openclaw-weixin}` 以减少冗余
- Fix A + Fix D 是否仍需 carry：grep upstream changelog 看是否有等价修复入主线
- v5.7 trial worktree `~/openclaw-upgrade-v2026.5.7/` v5.22 cutover 后 1 周（≥ 2026-06-03）可清理

---

## Rollback runbook 摘要

完整版见 `~/openclaw-upgrade-snapshot-2026-05-27/ROLLBACK.md`。简版：

```bash
# 1) 停 gateway
systemctl --user stop openclaw-gateway.service

# 2) git reset
git -C ~/openclaw reset --hard 52c0df1ca865d11c41161a4697da69b9fc4017a7

# 3) dist 恢复（优先 backup，兜底 v5.7 trial）
SNAP=$(ls -td ~/.openclaw-dist-backup-pre-v2026.5.22-* | head -1)
rm -rf ~/openclaw/dist && cp -a $SNAP/dist ~/openclaw/dist

# 4) systemd unit 版本字符串回退
sed -i 's/v2026\.5\.22/v2026.5.7/g; s/=2026\.5\.22/=2026.5.7/g' \
  ~/.config/systemd/user/openclaw-gateway.service
systemctl --user daemon-reload

# 5) restart
systemctl --user restart openclaw-gateway.service
```

预计回退耗时：**≤60 秒**（无 rebuild 路径）。
