# 数织求解器

一个基于 React、TypeScript 和 Vite 的数织（Nonogram）求解网页。求解器使用单线约束传播和回溯，不会枚举一条线的所有可能图案。

## 功能

- 支持 **1×1 到 60×60** 棋盘，棋盘会按窗口自动缩放，不在棋盘区域内滚动。
- 手动输入行列线索；线索支持空格、英文逗号和中文逗号分隔，例如 `3 1`、`3,1`、`3，1`。
- 在线索格中按 `Tab` 前进并清空目标格，按 `Shift+Tab` 后退并清空目标格。
- 粘贴题目网站 HTML，自动导入线索。
- 显示一个可行解；若线索矛盾则报告无解。

## 本地运行

需要 Node.js **22.12+** 或 **24+**。

```bash
npm ci
npm run dev
```

Vite 会在终端显示本地访问地址。

## 使用网站 HTML 导入

展开页面中的“从数织网站 HTML 导入”，粘贴包含以下结构的题目页面 HTML，然后点击“解析并导入线索”：

- 列线索组：`task-group task-col-N`
- 行线索组：`task-group task-row-N`
- 线索数字：组内带 `selectable` 类的 `task-cell`

解析器在浏览器本地处理粘贴内容，不会访问或抓取原网站。导入后可以直接开始求解。

## 求解方式

每条行列线索定义一组连续黑格长度。求解器通过前向/后向可行性分析计算每个格子的可能状态，以受影响的行列队列进行传播，并在传播停滞时使用启发式选择格子进行有限回溯。单次求解最多搜索 100,000 个节点。

## 开发检查

```bash
npm test          # 单元测试与小棋盘穷举对照
npm run typecheck # 严格 TypeScript 检查
npm run build     # 类型检查并生成生产构建
```

TypeScript 除 `strict` 外还启用了 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitReturns` 等检查。

## 当前范围

当前版本支持手动输入或导入题目并返回一个可行解；谜题生成和多解/唯一解检测尚未实现。
