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

template/                起步模板 —— 从复制它开始
docs/                    插件开发指南
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

**→ [插件开发指南](docs/authoring.zh-CN.md)** 深入介绍了其余内容：两个入口分别在什么
场景下需要、manifest 的逐字段说明、蓝图节点与引脚、widget、权限、类型包，以及插件系统
当前的限制。

有三点最容易踩坑，先说在前面：

- **注册的一切都必须在 `contributes` 中声明**，并以插件 id 为前缀 —— 否则 Studio 会在
  加载时抛错。这样设计是为了让 Studio 无需执行插件代码就能校验项目。
- **宿主模块必须设为 `external`**（`narraleaf-studio/*`、`react`、`react-dom`）。把
  React 打包进去会产生第二个 React 实例，hook 会以各种看不出真实原因的方式失效。
- **蓝图节点需要两个入口**才能在正式构建中生效。只从 `studio` 入口注册，意味着它在创作
  时正常、在构建里悄无声息地什么都不做。

类型来自 `narraleaf-studio` 包，由 Studio 源码生成：

```bash
yarn add -D narraleaf-studio
```

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
