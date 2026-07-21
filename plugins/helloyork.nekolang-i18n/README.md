# 猫娘语翻译 (helloyork.nekolang-i18n)

一个 NarraLeaf Studio 语言包，把编辑器界面变成软萌可爱的**猫娘语**（喵~）。

## 它做了什么

安装并启用后，「设置 → 语言」里会多出一项 **「喵语（猫娘语）」**。选中它，Studio
的界面文字就会变成猫娘语气：菜单、启动器、仪表盘、对话框、向导、构建面板等常读界面
都会带上「喵」。

- **不改动内置简体中文。** 本包注册的是一个全新的独立语言 `zh-x-neko`，和内置
  `简体中文` 互不干扰 —— 随时可以切回去。
- **只翻主要内容。** 高可见度、常读的界面做了猫娘化；蓝图 / 表达式 / 属性 / 动效 /
  UI 编辑器等密集技术界面保留忠实中文，未覆盖的键沿用 Studio 的英文源回退，行为与内置
  简体中文一致。

## 技术说明

- `contributes.locales` 声明式提供 `locales/zh-x-neko.json`（扁平的
  `dotted.key -> string` 表，键取自 Studio 自己的翻译键）。宿主在主进程聚合，无需运行
  时注册，所以 studio 入口是空的 no-op（仅因清单校验要求至少一个入口而存在）。
- `locales/zh-x-neko.json` 由 Studio 的 `src/shared/i18n/catalog/zh` 目录扁平化生成，
  再对高可见度命名空间套用猫娘语。它是构建产物，随包发布。
- `build.mjs` 在打包时把 `locales/*.json` 一并拷入 `dist/`（模板的构建脚本只拷贝入口
  与清单，语言文件是数据、需要额外拷贝）。

## 构建

```bash
yarn install
yarn build      # 输出到 dist/：main.js、locales/zh-x-neko.json、manifest.json
```

## 许可

MPL-2.0
