# 编写 NarraLeaf Studio 插件

从构建、测试到发布的完整指南。

[English](authoring.md) · [返回索引仓库](../README.zh-CN.md)

---

## 目录

- [插件是什么](#插件是什么)
- [两个入口](#两个入口)
- [项目结构](#项目结构)
- [manifest](#manifest)
- [类型](#类型)
- [构建](#构建)
- [studio API](#studio-api)
- [runtime API](#runtime-api)
- [蓝图节点](#蓝图节点)
- [Widget](#widget)
- [权限](#权限)
- [在 Studio 中测试](#在-studio-中测试)
- [发布到本索引仓库](#发布到本索引仓库)
- [当前限制](#当前限制)

---

## 插件是什么

一个插件就是一个**目录**，其中包含 `manifest.json` 和一到两个已打包的 ESM 文件。
Studio 安装插件的方式是把该目录复制到 `userData/plugins/<plugin-id>`，然后通过内部的
`app://` 协议提供入口文件。

目前没有插件商店、没有远程源、也没有自动更新。分发渠道就是本仓库：你发布一个 zip，
用户解压后让 Studio 指向该文件夹。

有三点需要先建立认知：

- **入口必须预先打包。** Studio 不会解析插件里的裸导入、不会安装你的依赖、也不会替你
  执行构建。你交付的每个入口都必须已经是自包含的单个 ESM 文件。
- **插件没有沙箱。** 已安装的插件拥有真实权限。Studio 会在安装时向用户展示你的
  `permissions`，而这就是全部的安全边界。
- **注册的一切都必须声明**在 manifest 中。Studio 在不执行插件代码的情况下校验项目的
  蓝图图，因此必须仅凭 manifest 就知道你的节点和 widget 类型。

---

## 两个入口

插件可以面向编辑器、面向游戏，或两者都要。

| | `studio` 入口 | `runtime` 入口 |
| --- | --- | --- |
| 运行于 | 编辑器 | 游戏 —— Dev Mode、预览、正式构建 |
| 拿到 | `app.services`（白名单）和 `app.privileged` | 仅 `app.game` |
| 能做 | 面板、动作、编辑器页、快捷键、通知、存储、资源、故事动作、蓝图节点、widget | 蓝图节点 `execute`、widget `render`、`log` |
| 生命周期 | 打开工作区时加载，禁用/卸载时卸载 | 每个进程加载一次，不会卸载 |
| React | 可用（`react`、`react-dom`、`react-dom/client`） | 可用（无 `react-dom/client`） |

两者在**物理上是隔离的**。在 runtime 入口里 import `narraleaf-studio/plugin` 会抛错 ——
游戏宿主没有 Studio 的服务，这里会直接报错，而不是给你一个残缺的对象。

你需要哪个？

- 仅编辑器工具（面板、资源工作流、故事动作）→ `studio`。
- 需要在正式构建中生效的蓝图节点或 widget → **两个都要**。
- 纯游戏行为、编辑器中不出现 → `runtime`。

如果一个蓝图节点只出现在编辑器面板里而没有 runtime 绑定，它在创作时正常、在正式构建里
什么都不做。这是最常见的插件 bug。请从两个入口都注册。

---

## 项目结构

从模板开始：

```bash
cp -r template plugins/yourname.your-plugin
cd plugins/yourname.your-plugin
corepack enable && yarn install && yarn build
```

```
plugins/yourname.your-plugin/
  manifest.json      Studio 在安装时读取的文件
  package.json       npm 元数据 + "narraleaf" 下的索引元数据
  yarn.lock          需提交 —— 每个插件独立解析依赖
  tsconfig.json
  build.mjs          把声明的各个入口打包进 dist/
  src/
    main.ts          studio 入口
    runtime.ts       runtime 入口
    nodes.ts         共享定义，被两个入口引用
  dist/              构建产物 —— 这就是要分发的内容
```

每个插件目录都是**独立的包**，拥有自己的 `node_modules`、lockfile 和固定的工具链版本。
不存在 workspace，也不做依赖提升，因此两位贡献者同时开发两个插件时不会共用依赖树。

---

## manifest

```json
{
  "manifestVersion": 2,
  "id": "yourname.your-plugin",
  "name": "Your Plugin",
  "version": "1.0.0",
  "description": "一句话描述，会显示在 Studio 中。",
  "publisher": "Your Name",
  "entries": {
    "studio": "main.js",
    "runtime": "runtime.js"
  },
  "contributes": {
    "blueprintNodes": ["yourname.your-plugin.do-thing"],
    "widgets": []
  },
  "permissions": []
}
```

| 字段 | 规则 |
| --- | --- |
| `manifestVersion` | 必须正好是 `2`。v1 会被直接拒绝。 |
| `id` | `publisher.plugin-name`，小写，需匹配 `/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/`。目录名必须与之一致。 |
| `name` | 显示名。必填、非空。 |
| `version` | 语义化版本 `x.y.z`，可带 prerelease/build。必须与 `package.json` 的 version 相同。 |
| `entries` | `studio` / `runtime` 至少一个。必须是包内相对路径 —— 不能是绝对路径，不能含 `..`。 |
| `contributes` | 只有 `blueprintNodes` 和 `widgets`。每个类型都要以插件 id 为前缀。 |
| `permissions` | 见[权限](#权限)。默认 `[]`。 |

`contributes` 不是文档，而是强制约束。注册未声明的类型会在加载时抛错，且每个声明的类型都
必须以 `<你的插件 id>.` 开头。正因如此，Studio 才能在不运行你的代码的前提下打开项目并提示
"这个图需要一个你没有安装的插件节点"。

---

## 类型

安装类型包：

```bash
yarn add -D narraleaf-studio
```

它**只有类型** —— 实现由 Studio 在加载时提供。这些声明是从 Studio 源码生成的，因此与实际
运行的宿主保持一致，而不是依赖某人的手写记录。

```ts
import { definePlugin } from "narraleaf-studio/plugin";
import { defineRuntimePlugin } from "narraleaf-studio/runtime";
```

两个标识符共享同一套底层声明，这正是下文"共享定义"模式能够通过类型检查的原因：来自
`/plugin` 的 `BlueprintNodeDef` 可以直接用在 `/runtime` 需要 `RuntimeBlueprintNodeDef`
的位置。

---

## 构建

入口必须是**预打包的 ESM**，并把宿主模块保持为 external：

```js
external: [
    "narraleaf-studio/plugin",
    "narraleaf-studio/runtime",
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
]
```

这不是可选项。Studio 通过 import map 解析这些标识符，并提供宿主自己的 React。把 React 打
进去会让插件持有第二个 React 实例，hook 会以各种看不出真实原因的方式失效。如果你把
`narraleaf-studio/*` 打包而不是设为 external，类型包中的桩会在 import 时抛错，并直接告诉你
这一点。

模板中的 `build.mjs` 已经处理好全部细节：读取 `manifest.json`，把每个声明的入口
（`main.js`）映射到对应源文件（`src/main.ts`），打包，并把 manifest 复制到 `dist/`。通常
你不需要改动它。

```bash
yarn build       # 打包到 dist/
yarn dev         # 不压缩，带 sourcemap
yarn typecheck   # tsc --noEmit
```

---

## studio API

```ts
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
    setup(app) {
        // app.plugin     —— { pluginId, version }
        // app.manifest   —— 规范化后的 manifest
        // app.services   —— 精选的 API 面
        // app.privileged —— fs/bash，由 manifest 权限控制

        return () => {
            // 可选的清理函数
        };
    },
});
```

`setup` 可以是异步的，也可以返回一个清理函数。多数情况下你不需要：通过 `app.services`
注册的一切都由宿主跟踪，卸载时自动回收 —— 即使 `setup` 中途抛错也是如此。只有宿主不拥有
的资源（你自己创建的定时器、监听器、打开的句柄）才需要返回清理函数。

`app.services` 刻意设计为白名单。插件**拿不到**工作区服务注册表。

| 服务 | 作用 |
| --- | --- |
| `storage` | `readJson(ns)` / `writeJson(ns, data)` —— 插件私有的持久化 JSON |
| `assets` | `getMap`、`list`、`get`、`fetch`、`createObjectUrl`、`revokeObjectUrl` |
| `ui.panels` | 注册 / 注销工作区面板 |
| `ui.actions` | 注册 / 注销动作及动作组 |
| `ui.editors` | 打开 / 关闭编辑器页 |
| `ui.keybindings` | `register` / `registerMany`，返回清理函数 |
| `ui.notifications` | `info` / `success` / `warning` / `error` |
| `widgets` | `register`、`registerMany`、`get`、`list`、`has` |
| `story.actions` | 注册创建故事块的场景编辑器面板动作 |
| `blueprintNodes` | `register`、`registerMany`、动态 select 选项源 |

从 `narraleaf-studio/plugin` 导入的 `ui` 是一套预置组件（按钮、输入框、模态框、面板原语），
用它可以让插件 UI 与 Studio 的外观一致，而不是靠近似还原。

故事动作值得单独说明：它创建的块是**标准故事块**。创建之后，文档不再依赖你的插件。卸载
插件不会破坏故事。

---

## runtime API

```ts
import { defineRuntimePlugin } from "narraleaf-studio/runtime";

export default defineRuntimePlugin({
    setup(app) {
        app.game.blueprintNodes.registerMany(myNodes());
        app.game.log("info", "ready");
    },
});
```

这就是全部的面：`blueprintNodes.register/registerMany`、
`widgets.register/registerMany`，以及 `log(level, message)`。没有服务、没有特权门面、
没有清理 —— 游戏环境每个进程只加载一次。

---

## 蓝图节点

把节点定义放在共享模块中，然后从两个入口分别注册：

```ts
// src/nodes.ts
import type { BlueprintNodeDef } from "narraleaf-studio/plugin";

export const PLUGIN_ID = "yourname.your-plugin";

export function createNodes(): BlueprintNodeDef[] {
    return [{
        type: `${PLUGIN_ID}.do-thing`,   // 必须在 contributes 中声明
        displayName: "Do Thing",
        category: "Plugin",
        keywords: ["thing", "example"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "message", label: "Message", kind: "string" },
        ],
        execute: ctx => {
            console.log(ctx.params.message);
            return { nextPort: "next" };
        },
    }];
}
```

```ts
// src/main.ts        app.services.blueprintNodes.registerMany(createNodes());
// src/runtime.ts     app.game.blueprintNodes.registerMany(createNodes());
```

runtime 侧只读取 `type` 和 `execute`，多余的编辑器字段会被忽略。一份定义，不会走样。

### 引脚

| 字段 | 含义 |
| --- | --- |
| `kind` | `"input"` 或 `"output"` |
| `semantic` | `"exec"` 表示控制流，`"data"` 表示数据 |
| `valueType` | 数据引脚的宽松类型标记：`string`、`boolean`、`integer`、`float`、`json` |
| `optional` | 未连线前该输入显示为非激活状态 |
| `allowInlineLiteral` | 该数据输入可直接在节点卡片上填写 |

`execute` 返回 `{ nextPort }` 表示沿某个 exec 输出继续执行，返回 `{ outputValues }` 提供
数据输出。返回 `{ nextPort: undefined }` 则结束该分支。

### 读取输入值

`ctx.params` 保存 `inspectorParams` 的值，这是插件节点读取配置的受支持方式。

**目前插件无法读取*数据输入引脚*。** 内置节点使用的是插件 API 尚未导出的宿主内部辅助函数。
在导出之前，请把可配置的值建模为 `inspectorParams`。如果你确实需要由引脚驱动的输入，请提
issue —— 这是一个已知缺口，而非有意的限制。

### 标志位

- `isPure: true` —— 无副作用。纯节点按值图求值。
- `isLatent: true` —— 异步。函数图中不允许。
- `graphKinds` —— 节点可出现的位置：`"event"`、`"macro"`、`"function"`。

---

## Widget

Widget 是可在 UI 编辑器中使用的自定义 UI 元素类型。从 studio 入口注册模块，从 runtime 入口
注册渲染函数：

```ts
// studio
app.services.widgets.registerMany(myWidgets());
// runtime
app.game.widgets.registerMany([{ type: `${PLUGIN_ID}.badge`, render: renderBadge }]);
```

与节点一样，每个 widget 的 `type` 都必须以插件 id 为前缀，并列在 `contributes.widgets` 中。

---

## 权限

```json
"permissions": [
  { "kind": "filesystem", "path": "/some/path", "mode": "readwrite", "recursive": true },
  { "kind": "api", "capability": "bash" }
]
```

| 类型 | 字段 |
| --- | --- |
| `filesystem` | `path`、`mode`（`read` / `write` / `readwrite`）、`recursive`（必填布尔值） |
| `api` | `capability` |

权限控制的是 `app.privileged`，由主进程按插件强制执行 —— 渲染进程无法自行扩权。权限**仅对
studio 入口生效**，runtime 入口根本没有特权门面。

请只申请最小权限。用户会在安装时看到这份列表，而在本仓库中，每一项权限都需要在 PR 中说明
理由。

---

## 在 Studio 中测试

```bash
# 在索引仓库根目录执行
node scripts/package-plugin.mjs yourname.your-plugin
```

解压 `.out/` 中的压缩包，然后在 Studio 中打开
**启动器 → 插件 → 从文件夹安装**，选择解压出的文件夹。

迭代方式：重新构建，覆盖安装到同一文件夹，然后重新打开工作区。studio 入口会卸载并重新加载；
runtime 入口只随游戏进程重新加载，因此改动 runtime 代码后要重启 Dev Mode。

如果插件加载失败，Studio 会隔离该失败并把它标记在对应插件上（`status: "error"`），而不会
让整个工作区崩溃。具体信息可在插件页中查看。

---

## 发布到本索引仓库

1. 从 `develop` 拉分支。
2. 在 `plugins/<your-plugin-id>/` 下添加你的插件。
3. 校验并重新生成索引：

   ```bash
   node scripts/validate.mjs <your-plugin-id>
   node scripts/generate-index.mjs
   ```

4. 提交 `yarn.lock` 和重新生成的 `index.json`，然后向 `develop` 发起 PR。

`validate.mjs` 使用的是 Studio 自身 manifest 校验器的移植版本，因此在这里通过校验的插件，
Studio 在安装时也会接受。

维护者通过从 `master` 推送 `<plugin-id>@<version>` tag 来发布；CI 会构建、打包并把 zip
附加到 GitHub Release。详见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

---

## 当前限制

截至 manifest v2：

- 没有插件商店、远程源或自动更新 —— 只能从本地目录安装。
- 没有插件间依赖，也没有加载顺序控制。
- 没有沙箱。已安装的插件是受信任的代码。
- 不强制校验 `studioVersion`。该字段存在于索引元数据中，仅供参考，Studio 在安装时不检查。
- 插件节点无法读取数据输入引脚（见[读取输入值](#读取输入值)）。
- runtime 入口没有卸载生命周期。
