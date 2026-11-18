# 富贵村 P0–P1 视觉交付

本轮以用户提供的 Design Specification v1.0 与参考图为依据。完成后停在 P1，供产品评审。

## P0

- `styles.css` 集中定义纸张、森林绿、麦穗金、砖瓦红及文字层级。
- 公共 Button、Input、Textarea、Badge 和 Radix 详情抽屉统一视觉。
- 复用开发用 `/components` 展示正常、禁用、输入错误及抽屉状态。
- 新增手绘位图图集，涵盖四建筑、收支、结余、洞察与小猫插画。

## P1

- 顶部56px导航，轻量地点导航，小型建筑标签和透明整建筑热点。
- 五章节 Story，固定月份、独立滚动、可展开阅读区、数据驱动标题、横向金额摘要、分类支出比例条、证据与业务动作。
- 现有视频负责环境动态。场景数据层显示真实金额及关联建筑，移除旧几何虚线动画。
- AI 默认收起，从右侧展开；Story 同时保留，跨路由继续使用同一聊天实例。
- 主动洞察复用匹配月份和账本事实的 Agent 简报。

## 截图

- [设计系统](p0-design-system.png)
- [详情抽屉](p0-drawer.png)
- [默认首页](p1-home.png)
- [展开阅读](p1-story-expanded.png)
- [收入关联聚焦](p1-income-focus.png)
- [支出关联聚焦](p1-spending-focus.png)
- [AI 助手展开](p1-assistant.png)

截图使用独立本地预览数据库与“设计预览”账号，金额通过真实 API 写入该预览账本并由服务端汇总。数据和密钥均未进入源码。按用户要求，本轮未运行测试、Lint、类型检查或构建，仅使用开发服务器渲染和采集截图。

## 数据范围与评审点

现有 overview 未提供收入来源类别、收入笔数、上月比较或逐账户资金分配。收入显示已有合计，缺失比较明确留白。场景使用关联建筑与金额聚焦，不绘制未经确认的转账路径。分类占比是已有分类净支出相对服务端净支出的展示比例，退款可能导致单类超过100%，横条仅在可用宽度内显示。

P2 账房、钱庄和 P3 模拟、MonthlyReview 继续等待评审。P0公共组件样式会同步影响已有业务页面。

## 手绘素材

素材使用内置 imagegen 生成，保存于 `frontend/public/media/village/illustrations-v1.png`。通过 CSS 图集坐标复用，没有用代码绘制替代图标。

生成提示词要求制作透明背景的4列3行手绘图集，依次为账簿、黄铜天平、集市篮筐、卷轴，钱袋、支出钱包、金币、油灯，持账簿的小猫、叶枝、花叶、商贸房屋。绘本墨线、平涂与水彩纸纹理，使用规格中的森林绿、奶油纸色、麦穗金和砖瓦红，不含文字、图框、几何矢量或3D效果。

最终生成提示词如下。

> Create a production sprite atlas of hand-painted UI illustration assets for SpendWise, a cozy medieval merchant village finance app. Transparent background. Exactly 4 columns x 3 rows equally spaced on a square canvas, each isolated object centered within its own equal cell with generous transparent padding, no object crossing a cell edge. Row1 left to right: open merchant ledger book, brass balance scale with coins, wicker market basket with apples and bread, rolled parchment scroll with wax seal. Row2: small cloth income coin pouch, terracotta spending purse, modest stack of gold coins, small warm brass oil lamp for financial insight. Row3: a friendly small brown woodland cat merchant holding a ledger (full body), delicate botanical sprig with small green leaves, delicate botanical corner cluster with leaves and tiny cream flowers, elegant village merchant house emblem. Style: refined 2D children's picture-book illustration, irregular dark warm brown ink outlines, flat muted warm colors, light watercolor and colored pencil texture. Palette warm cream #F9F4E8, sage #A8C38B, forest #47775B, wheat gold #D7A34F, terracotta #C9795E. Accurate recognizable silhouettes readable at 32 pixels, beautifully crafted at large size. No text, numbers, lettering, frames, checkerboard, gradients, vector geometry, 3D, glow, shadows outside the objects. This is an asset sheet, not a webpage. Match the supplied reference's hand-illustrated book, scale, basket and parchment visual language.
