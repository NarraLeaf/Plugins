# NarraLeaf Plugins

[NarraLeaf Studio](https://github.com/NarraLeaf/NarraLeaf-Studio) 的官方插件索引。

这里收录的每个插件都由 NarraLeaf 团队审核并发布。每个插件位于
[`plugins/`](plugins/) 下的独立目录中，各自解析依赖，并通过推送 git tag 独立发布。

[English](README.md)

---

## 使用者

### 安装插件

1. 在 [`index.json`](index.json) 或 [`plugins/`](plugins/) 中找到插件。
2. 下载对应版本的 `.zip`：地址见插件条目的 `release.download` 字段，或直接浏览
   [Releases](https://github.com/NarraLeaf/Plugins/releases)。
3. 解压。得到一个以插件 id 命名的文件夹，例如 `narraleaf.example/`。
4. 在 Studio 中：**启动器 → 插件 → 从文件夹安装**，选择该文件夹。

Studio 目前只支持从本地目录安装插件。在应用内商店出现之前，本仓库就是分发渠道。

> **插件没有沙箱。** 插件以其 manifest 声明的权限运行，Studio 会在安装时向你确认。
> 安装任何插件前都请先阅读 `permissions` 字段 —— 包括从这里安装的插件。

### `index.json`

一份机器可读的已发布插件清单，由本仓库中的各个 manifest 生成。未来 Studio 内置的
插件浏览器将拉取这个文件。

```jsonc
{
  "formatVersion": 1,
  "repository": "https://github.com/NarraLeaf/Plugins",
  "plugins": [
    {
      "id": "narraleaf.example",           // 带命名空间的插件 id
      "name": "Example",
      "version": "1.0.0",
      "description": "…",
      "publisher": "NarraLeaf",
      "path": "plugins/narraleaf.example", // 本仓库中的源码目录
      "targets": ["studio", "runtime"],    // 插件声明了哪些入口
      "categories": ["blueprint"],
      "keywords": ["…"],
      "license": "MPL-2.0",
      "studioVersion": ">=0.0.1",          // 可选，仅供参考
      "contributes": {
        "blueprintNodes": ["narraleaf.example.node"],
        "widgets": []
      },
      "permissions": [],                   // 安装时插件请求的权限
      "release": {
        "tag": "narraleaf.example@1.0.0",
        "page": "https://github.com/…/releases/tag/…",
        "download": "https://github.com/…/releases/download/…/narraleaf.example-1.0.0.zip"
      }
    }
  ]
}
```

`index.json` 是**生成的，不要手改**。其中的 release 地址由 `(id, version)` 推导
得出，而不是查询 GitHub API —— 正因如此，版本号变更和对应的索引条目可以出现在同一个
可评审的 PR 里，无需等 tag 推送、Release 创建之后再补。

---

## 插件作者

### 仓库结构

```
plugins/<plugin-id>/     每个插件一个目录，目录名必须与插件 id 完全一致
  manifest.json          Studio 的契约 —— 安装时 Studio 读取的文件
  package.json           npm 元数据 + "narraleaf" 字段下的索引元数据
  yarn.lock              需提交；每个插件独立解析依赖
  build.mjs              把声明的各个入口打包进 dist/
  src/                   插件源码
  types/                 宿主模块的环境声明
 
template/                起步模板 —— 从复制它开始
scripts/                 索引工具（零依赖 Node ESM）
schema/                  manifest.json 与 index.json 的 JSON Schema
index.json               生成的索引文件
```

**不用 workspace，不做依赖提升。** 每个插件目录都是独立的包，拥有自己的
`node_modules`、自己的 lockfile 和自己固定的工具链版本。两位贡献者同时开发两个插件
时不会碰到同一棵依赖树，某个插件的依赖损坏也不会波及其他插件的构建。

### 开始

```bash
cp -r template plugins/yourname.your-plugin
cd plugins/yourname.your-plugin

corepack enable          # 每个插件通过 "packageManager" 固定自己的 Yarn 版本
yarn install
yarn build               # -> dist/
```

然后编辑 `manifest.json`：

| 字段              | 规则                                                          |
| ----------------- | ------------------------------------------------------------- |
| `manifestVersion` | 必须正好是 `2`。Studio 会直接拒绝 v1。                        |
| `id`              | `publisher.plugin-name`，小写。**目录名必须与之一致。**        |
| `version`         | 语义化版本，必须与 `package.json` 的 `version` 相同。          |
| `entries`         | `studio` / `runtime` 至少有一个，各指向 `dist/` 中已打包的 ESM 文件。 |
| `contributes`     | 你注册的所有蓝图节点与 widget 类型，必须以插件 id 为前缀。     |
| `permissions`     | 只写真正需要的 —— 用户在安装时会看到。                        |

任何运行时注册的东西都**必须**在 `contributes` 中声明，否则 Studio 在加载时会抛错。
这样设计是为了让 Studio 无需执行插件代码就能静态校验一个项目。

另外要在 `package.json` 中填写 `narraleaf.categories`（可选值：`blueprint`、`ui`、
`assets`、`story`、`workflow`、`integration`、`theme`、`other`）。

### 两个入口

插件可以面向编辑器、面向游戏，或两者都要。

| 入口      | 运行环境                                | 能拿到什么                                                  |
| --------- | --------------------------------------- | ----------------------------------------------------------- |
| `studio`  | 编辑器                                  | `app.services`（白名单）+ `app.privileged`（受审计）        |
| `runtime` | 游戏 —— Dev Mode、预览、正式构建        | 仅 `app.game`：蓝图节点、widget、`log()`                    |

两者在物理上是隔离的：在 runtime 入口里 import `narraleaf-studio/plugin` 会抛错。
如果某个蓝图节点既要出现在编辑器面板中、又要在正式构建里执行，就把定义放到共享模块，
然后从两个入口分别注册 —— `template/src/nodes.ts` 就是这么做的。

`studio` 入口有卸载生命周期，`runtime` 入口没有（游戏环境每个进程只加载一次）。

### 类型

Studio 目前尚未发布 `narraleaf-studio/plugin` 和 `narraleaf-studio/runtime` 的类型
包 —— 这两个标识符只在运行时通过宿主安装的 import map 解析。在类型包发布之前，每个
插件各自携带一份 [`types/narraleaf-studio.d.ts`](template/types/narraleaf-studio.d.ts)。
其中面向插件的接口是准确的；编辑器内部的深层结构则有意写得宽松。遇到那些宽松类型时，
请用运行时检查，不要依赖类型。

### 本地测试

```bash
node scripts/validate.mjs                            # 校验所有插件
node scripts/validate.mjs yourname.your-plugin       # 只校验你的插件
node scripts/generate-index.mjs                      # 重新生成 index.json
node scripts/package-plugin.mjs yourname.your-plugin # 构建并打包到 .out/
```

`validate.mjs` 使用的是 Studio 自身 manifest 校验器的移植版本，因此在这里通过校验的
插件，Studio 在安装时也会接受。把 `.out/` 里的压缩包解压后通过 Studio 安装，即可进行
真实环境测试。

---

## 参与贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。简版：

1. 从 `develop` 拉分支。
2. 在 `plugins/` 下新增或修改插件。
3. 运行 `node scripts/generate-index.mjs` 并提交生成结果。
4. 向 `develop` 发起 Pull Request。

### 分支

| 分支      | 用途                                     |
| --------- | ---------------------------------------- |
| `master`  | 已发布状态。所有 release tag 都从这里打。 |
| `develop` | 集成分支。所有 PR 都指向这里。            |

### 发布（维护者）

发布以插件为单位，而不是以仓库为单位：

1. 同时更新 `manifest.json` 和 `package.json` 中的 `version`。
2. 重新生成 `index.json`，先合入 `develop`，再合入 `master`。
3. 从 `master` 推送 tag：

   ```bash
   git tag narraleaf.example@1.0.0
   git push origin narraleaf.example@1.0.0
   ```

发布工作流会校验 tag 与 `manifest.json`、`index.json` 三者是否一致，不一致就拒绝发布；
一致则构建、打包，并把 zip 附加到 GitHub Release。打 tag 是唯一的发布方式 —— 由于 tag
中带有插件 id，各插件的版本互不干扰。

---

## 许可证

本仓库的索引工具采用 [MPL-2.0](LICENSE)，与 NarraLeaf Studio 一致。
**每个插件在各自的 `package.json` 中声明自己的许可证**，依赖前请先确认。
