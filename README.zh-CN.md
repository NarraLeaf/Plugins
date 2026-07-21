# NarraLeaf Plugins

[NarraLeaf Studio](https://github.com/NarraLeaf/NarraLeaf-Studio) 的官方插件索引。

这里收录的每个插件都由 NarraLeaf 团队审核并发布。每个插件位于 [`plugins/`](plugins/) 下的独立目录中，各自解析依赖，并通过推送 git tag 独立发布。[`index.json`](index.json) 是生成的机器可读索引，供未来 Studio 内置的插件浏览器拉取。

[English](README.md)

## 安装插件

1. 从插件的 [Release](https://github.com/NarraLeaf/Plugins/releases) 下载 `.zip` 并解压，得到一个包含 `manifest.json` 的文件夹。
2. 在 Studio 中：**启动器 → 插件 → 从文件夹安装**，选择该文件夹。

完整步骤见 **[安装插件](https://narraleaf.com/zh/docs/studio/plugin/install-plugin)**。

> **插件没有沙箱。** 插件以其 manifest 声明的权限运行，Studio 会在安装时向你确认。安装任何插件前都请先阅读 `permissions` 字段 —— 包括从这里安装的插件。

## 编写插件

复制 [`template/`](template/) 目录开始，然后参考文档站点上的指南：

- **[制作插件](https://narraleaf.com/zh/docs/studio/plugin/create-first-plugin)** —— 从空目录到已安装插件。
- **[API 参考](https://narraleaf.com/zh/docs/studio/plugin/api-reference)** —— studio 与 runtime 两个接口的逐个方法说明。
- **[插件概览](https://narraleaf.com/zh/docs/studio/plugin)** —— 两个入口目标以及各部分如何配合。

```bash
cp -r template plugins/yourname.your-plugin
cd plugins/yourname.your-plugin
corepack enable
yarn install
yarn build
```

发起 PR 前，在本地校验并打包：

```bash
node scripts/validate.mjs yourname.your-plugin       # Studio manifest 校验器的移植版本
node scripts/generate-index.mjs                      # 重新生成 index.json
node scripts/package-plugin.mjs yourname.your-plugin # 构建并打包到 .out/
```

## 参与贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。简版：

1. 从 `develop` 拉分支。
2. 在 `plugins/` 下新增或修改插件。
3. 运行 `node scripts/generate-index.mjs` 并提交生成结果。
4. 向 `develop` 发起 Pull Request。

| 分支      | 用途                                     |
| --------- | ---------------------------------------- |
| `master`  | 已发布状态。所有 release tag 都从这里打。 |
| `develop` | 集成分支。所有 PR 都指向这里。            |

发布以插件为单位：更新 `manifest.json` 和 `package.json` 中的 `version`，重新生成 `index.json`，合入 `master`，再推送 tag（`git tag narraleaf.example@1.0.0`）。发布工作流会在 tag、manifest、index 三者不一致时拒绝发布。

## 许可证

本仓库的索引工具采用 [MPL-2.0](LICENSE)，与 NarraLeaf Studio 一致。**每个插件在各自的 `package.json` 中声明自己的许可证**，依赖前请先确认。
