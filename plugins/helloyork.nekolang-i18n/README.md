# 猫娘语翻译 (helloyork.nekolang-i18n)

一个 NarraLeaf Studio 语言包，把编辑器界面变成软萌可爱的**猫娘语**（喵~）。

## 它做了什么

安装并启用后，「设置 → 语言」里会多出一项 **「喵语（猫娘语）」**。选中它，Studio
的界面文字就会变成猫娘语气：菜单、启动器、仪表盘、对话框、向导、构建面板等常读界面
都会带上「喵」。

- **不改动内置简体中文。** 本包注册的是一个全新的独立语言 `zh-x-neko`，和内置
  `简体中文` 互不干扰 —— 随时可以切回去。
- **只翻主要内容。** 高可见度、常读的界面做了猫娘化；蓝图 / 表达式 / 属性 / 动效 /
  UI 编辑器等密集技术界面保留忠实中文 —— 本包会把 Studio 简体中文的**全部**键原样带上，
  所以没被猫娘化的地方读起来和内置简体中文一模一样。

## 技术说明

- `contributes.locales` 声明式提供 `locales/zh-x-neko.json`（扁平的
  `dotted.key -> string` 表，键取自 Studio 自己的翻译键）。宿主在主进程聚合，无需运行
  时注册，所以 studio 入口是空的 no-op（仅因清单校验要求至少一个入口而存在）。
- `locales/zh-x-neko.json` 由 Studio 的 `src/shared/i18n/catalog/zh` 目录扁平化生成，
  再对高可见度命名空间套用猫娘语。它是构建产物，随包发布。

## 维护：跟随 Studio 的键清单

这份 JSON 是**某一次** Studio 翻译键清单的快照。Studio 新增翻译键之后，本包缺的那些键
不会回退到简体中文 —— i18n 的 `FALLBACK_LOCALE` 是 `en`，缺键直接显示英文。所以每次
Studio 的 `catalog/zh` 有增删，都要重新生成一次：

1. 把 Studio 的 `src/shared/i18n/catalog/zh` 扁平化成 `dotted.key -> string`；
2. 以它为底，套回本包已有的猫娘译文（键仍存在的那些）；
3. 新增键里落在已猫娘化命名空间（`launcher` / `settings` / `devMode` / `menu` /
   `actions` / `build` / `common` / `dialogs` / `wizard` / `dashboard` / `project` /
   `welcome`）的，补写猫娘译文；其余原样带上中文；
4. 校对 `{placeholder}` 占位符与中文源一致 —— 漏掉一个就是运行时空洞。
- `build.mjs` 在打包时把 `locales/*.json` 一并拷入 `dist/`（模板的构建脚本只拷贝入口
  与清单，语言文件是数据、需要额外拷贝）。

## 构建

```bash
yarn install
yarn build      # 输出到 dist/：main.js、locales/zh-x-neko.json、manifest.json
```

## 许可

MPL-2.0
