# 本地 CPU PoW 可行性实验

三个仓库均使用 `feat/vault-pow-compute`。这是本地实验分支，尚未发布 SDK、部署、提交链上交易或通过正式上传/绑定流程。

## 已实现的边界

- 组件通过 `sdk.compute.start({ profile: "flapcred-keccak-cpu-v1", job })` 取得任务，使用 `getSnapshot()`、`subscribe()`、`stop()` 管理状态。
- Provider 默认注入不可用服务。只有宿主显式启用、manifest 声明能力、宿主给出允许的 chain/contract/miner/domain 范围，且用户在可见页面触发操作时才能开始。
- 宿主的 `createPowComputeHost` 只创建固定同源地址的 Worker，不接受组件提供的脚本、URL 或钱包接口；只将七个计算字段传入 Worker。
- 宿主与矿工内部使用 Comlink 4.4.2，通过 `initialize` 初始化、`nextBatch` 拉取有上限的计算批次。组件仍只使用 `sdk.compute`，不能导入 Comlink，也不能取得 Worker 或远程代理。Comlink 负责通信，授权、预算和终止仍由宿主执行。
- 停止时释放 Comlink 代理、解除监听、在本地结束尚未返回的等待并立即终止 Worker；不依赖矿工响应停止请求，也不传递组件回调或额外代理通道。
- 每个页面运行时最多一个 Worker；最多 30 秒或 1,000 万次哈希。隐藏页面、离开页面、停止、宿主 dispose、Worker 错误都会终止。宿主更换账户/链/合约范围时必须 dispose 并重新创建服务。
- Worker 文件完全打包、没有外部依赖。响应使用强制 CSP：网络、导入脚本、子 Worker 均禁止。组件原有 Worker/WebGPU 禁令不变。
- 优化内核来自用户提供的 demo，主线程使用 viem 独立计算完整 256 位 Keccak 后确认结果。修正了前 64 位恰好等于目标前缀时可能漏掉候选的问题。
- 此实验只实现 CPU；未实现 WebGPU、铸造、真实任务读取、连续长时间挖矿或合约 ABI 适配。

## 三个项目的修改

模板项目增加 SDK 类型、宿主控制器、固定矿工、打包步骤、能力声明及测试；Workbench 同步能力检查、使用本地 SDK，并通过现有 `componentBuildOptions` 生成测试成品；beta 同步本地 SDK 和旧式 TypeScript 声明，使用现有 runtime 注册函数加载这份成品。三个项目都有 `/dev/pow` 和固定 Worker 路由，仅 `NODE_ENV=development` 且 `FLAP_POW_LOCAL=1` 时可访问。

Workbench 与 beta 的测试加载器校验文件 SHA-256 后导入 Blob ESM。它使用正式构建选项，但测试夹具使用模拟地址，**不代表 source package 验证、真实合约验证、完整生产加载器或 Safe Bind 通过**。正式 Vault 渲染器没有开启计算权限。

## 重现

三个目录保持同级。先在模板项目执行：

```sh
yarn runtime:package:pow-local
yarn test:pow
yarn test:pow-capability
node --test scripts/pow-package.test.mjs
FLAP_POW_LOCAL=1 yarn dev --hostname 127.0.0.1 --port 3231
```

在 Workbench 中执行：

```sh
yarn install --ignore-scripts --force
yarn test:pow-capability
FLAP_POW_LOCAL=1 yarn dev --hostname 127.0.0.1 --port 3232
```

在 beta 中执行（Workbench 必须已启动）：

```sh
yarn install --ignore-scripts --force
mkdir -p .pow-local
curl --fail http://127.0.0.1:3232/api/dev/pow-artifact -o .pow-local/component.mjs
FLAP_POW_LOCAL=1 yarn dev --hostname 127.0.0.1 --port 3233
```

打开各端口的 `/dev/pow`。点击开始、停止、再次开始、重置宿主上下文；隐藏页面后再次查看，状态应停止。开始计算必须由用户操作触发。工作量和已验证结果应增长，心跳应持续更新。

本地包位于 `dist/vault-runtime-pow`，版本带 `pow.local` 和内容摘要，`private: true`。消费项目通过 `file:../flap-vault-component-template/dist/vault-runtime-pow` 引用它，**不能把这个依赖直接部署**。正常发布的 freshness/canary 检查没有关闭。重新构建后，在消费者执行强制安装并重启 dev server，避免使用旧缓存。

## 正式接入前的工作

确定真实合约的 PoW 编码、难度、锚点更新规则和铸造 ABI；将生产账户/链/合约变化绑定到任务清理；增加经审核的宿主授权配置与用户资源使用提示；核对矿工代码的来源和再分发许可；完成移动端/功耗/WebGPU 独立评估与真实测试网链路。发布新 runtime 后再升级两端，并按正式 source-package/E2E/Workbench 流程重新生成成品。铸造仍由平台 SDK 请求钱包确认。

本次 beta/workbench 使用用户批准的本地主分支记录，未声称已获取私有远端最新代码。旧分支未提交工作保存在各自 stash 中，没有混入实验分支。

## 本次实测结果（2026-09-30）

- 模板：1,000 万次哈希、155 个完整校验通过结果，达到工作量上限自动停止；重启后手动停止，计数保持不变。
- Workbench 成品：首轮 7,623,399 次哈希、113 个完整校验通过结果，停止正常。
- beta 加载同一份成品：首轮 9,034,240 次哈希、131 个完整校验通过结果；第二轮 8,344,448 次哈希、127 个结果，重置宿主上下文后停止。运行期间心跳持续更新。
- 成品 SHA-256：`f780e70cd87951a527f5d25533c548a2776f02808ebde854c5f2faa309691f0d`。
- 13 项 PoW 专项检查通过（控制器 9、实际分发包 2、两端能力检查各 1）；60 项相关回归通过（包模式 4、Workbench artifact 25、beta artifact 31）。
- 模板/Workbench 类型检查通过；beta 改动范围的类型检查通过。三端改动代码 lint 通过。beta 全量类型检查仍报告未修改的测试文件中的 BigInt target、组件 props 等错误；未执行完整生产构建或全量 CI。
- 联调发现共享 SDK 经典 JSX 输出依赖全局 React，已将打包明确设置为 automatic JSX，并用无全局 React 的 SSR 分发包测试防止复发。

指标属于模拟任务功能验证，不是性能基准或真实网络产量。

## Comlink 切换验证（2026-10-01）

- 内部通信改用 Comlink 4.4.2；外部 `sdk.compute` API、宿主授权和审核提示保持不变。Comlink 随 host runtime 和固定 Worker 打包，消费项目不需要新增 Comlink 依赖。
- 新私有包：`0.1.31-pow.local.ad6dc5000ad7`。本地包内容摘要现在在写入 `use client` 后计算，对应实际分发字节。
- 三端分发相同 24,040 字节矿工，SHA-256 为 `d631f570860bd9f2cdd949e98b3fc77cbdb68a66004365da25df7a516ba4e9c8`；三端 CSP 均仍禁止网络、脚本导入、子 Worker。
- 模板完成 1,000 万次哈希、164 个完整校验通过结果，达到上限自动停止。
- Workbench 计算到 6,611,723 次哈希、97 个结果后手动停止，后续观察计数保持不变。
- beta 首轮完成 1,000 万次哈希、134 个结果；再次启动后计算到 2,915,319 次哈希、43 个结果，运行中重置宿主上下文使任务停止。界面心跳持续增长。
- 18 项 PoW 专项检查通过：控制器及真实 Comlink 消息通道 12、实际分发包 4、两端能力检查各 1。覆盖远程异常、未返回调用的终止、立即停止、旧任务隔离、独立 Keccak 校验、组件 Worker/Comlink 导入拦截和审核提示。
- 78 项回归通过：包模式 4、Workbench artifact 25、beta artifact 49。模板/Workbench 全量类型检查和 beta 本次改动范围类型检查通过；本次修改的 TypeScript/Worker 代码 lint 通过。beta 全量类型检查的既有错误与生产验证范围限制仍见上一节。
- 本轮没有新增或改变产品文案。三个仓库保持同名本地实验分支，没有提交、推送或发布。
