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

## 发布（维护者）

发布以插件为单位，**只由推送 `<plugin-id>@<version>` tag 触发** —— 没有别的方式会发布。[发布工作流](.github/workflows/release.yml) 会在 tag、插件的 `manifest.json` 版本、以及 `index.json` 中的条目三者不一致时拒绝发布，因此注册表条目必须在打 tag **之前**合入。

1. **把插件 PR 合入 `develop`。** 此时只跑 CI，不发布。
2. **把 `develop` 合入 `master`** —— `master` 只通过发布合并前进，所以这是一个合并提交（一旦 `master` 带上发布合并历史，快进就不再适用）。可以从 `develop` 向 `master` 发起 PR 合并，或在本地：

   ```bash
   git checkout master && git pull
   git merge origin/develop        # 生成发布合并提交
   git push origin master
   ```

3. **在 `master` 上打 tag，再推送 tag** —— 推送才会发布：

   ```bash
   git tag <plugin-id>@<version>          # 例如 narraleaf.example@1.0.0
   git push origin <plugin-id>@<version>  # 只在本地 git tag 不会触发任何事
   ```

4. **观察发布：** `gh run watch --workflow Release`。工作流会校验、构建、打包，并把 `<plugin-id>-<version>.zip` 附加到一个 GitHub Release 上。下载地址是确定性的 —— `index.json` 已经指向它。

升级已有插件是同一个循环：把 `manifest.json` **和** `package.json` 里的 `version` 一起更新，运行 `node scripts/generate-index.mjs`，合并，然后为新的 `<plugin-id>@<version>` 打 tag。

## 许可证

本仓库的索引工具采用 [MPL-2.0](LICENSE)，与 NarraLeaf Studio 一致。**每个插件在各自的 `package.json` 中声明自己的许可证**，依赖前请先确认。
