# 第二轮：四种 AI 对话式账本界面

直接打开 `index.html`。四个页面都是纯 HTML/CSS/JavaScript 原型，不接入真实账本或 AI，不要求重复导入，也不改现有前后端组件。

本轮先参考了 [Apple 的界面原则](https://developer.apple.com/design/human-interface-guidelines/design-principles/)、[Apple 的动效指导](https://developer.apple.com/design/human-interface-guidelines/motion)、[IBM Carbon 的网格](https://www.carbondesignsystem.com/building-blocks/foundations/2x-grid/guidelines)、[IBM Carbon 的字体层级](https://www.carbondesignsystem.com/building-blocks/foundations/typography/overview/) 和 [Fluent 的布局指导](https://fluent2.microsoft.design/layout)。具体取舍：用版式与文字建立层级；动效表达焦点或操作反馈；缩窄窗口时调整布局而不删除功能。

| 方向 | 主导形式 | 对话与账本的关系 |
| --- | --- | --- |
| Editorial | 编辑式长页面、细线与留白 | 对话像一则可核查的分析稿，证据在旁边 |
| Grid | 瑞士式网格、强对比、明确编号 | 对话是一项主操作，其他功能是可定位的模块 |
| Console | 命令工作台、键盘优先 | AI 对话与查询、导入、模拟共享一个命令入口 |
| Atlas | 深色空间索引、细线轨道 | AI 在中心，账本及功能是周围可展开的资料域 |

所有金额和状态均为界面占位，不代表用户真实财务数据。输入问题、点击入口可看到演示面板。浏览器的“减少动态效果”设置会关闭动画。
