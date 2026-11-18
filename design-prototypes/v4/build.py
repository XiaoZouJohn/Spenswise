from pathlib import Path

ROOT = Path(__file__).parent
designs = [
    ('astra', '01', '星图', 'ASTRA OBSERVATORY', '夜间观测站', '深蓝星空 / 紫色终端 / 遥远山脉'),
    ('port', '02', '晴港', 'PORT OF ACCOUNTS', '个人财务航图', '浅海群岛 / 航图坐标 / 橙色信号'),
    ('archive', '03', '档案室', 'THE LEDGER ROOM', '个人财务档案', '暖色室内 / 纸本档案 / 桌面终端'),
    ('moss', '04', '苔原', 'MOSS FIELD STATION', '财务观察记录', '森林切片 / 绿色资料域 / 像素精灵'),
]
icons = {
    'ledger': '<path d="M4 3h13v18H4zM8 3v18M11 8h3M11 12h3"/>',
    'plan': '<path d="M3 19h18M5 16l5-6 4 3 6-9M16 4h4v4"/>',
    'family': '<path d="M3 11l9-8 9 8v10H3zM9 21v-7h6v7"/>',
    'review': '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h2"/>',
    'source': '<path d="M3 7h7l2 3h9v11H3zM3 7V3h7l2 4M15 13v5M12 15h6"/>',
}
def icon(key):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">{icons[key]}</svg>'

for slug,num,title,english,heading,desc in designs:
    nav = ''.join(f'<button data-open="{key}">{icon(key)}<span>{label}</span></button>' for key,label in [('ledger','账本'),('plan','计划'),('family','家庭')])
    shortcuts = ''.join(f'<button data-open="{key}"><span class="shortcut-icon">{icon(key)}</span><span>{label}<small>{sub}</small></span><b>↗</b></button>' for key,label,sub in [('ledger','账本','查询与核对'),('review','待确认','分类与重复记录'),('plan','计划','预算与消费模拟')])
    html = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpendWise · {title}</title><link rel="stylesheet" href="style.css"></head>
<body class="{slug}" data-world="{slug}"><div class="world-frame" aria-hidden="true"><canvas id="world"></canvas></div><div class="scene-vignette" aria-hidden="true"></div>
<header><a class="brand" href="index.html"><span class="brand-sigil" aria-hidden="true"><i></i><i></i><i></i><i></i></span>SpendWise<span class="brand-edition">{title}</span></a><nav aria-label="主要功能">{nav}</nav><button class="profile" data-open="settings" aria-label="账户与设置">L<span class="profile-dot"></span></button></header>
<main><div class="location"><span class="location-mark">＋</span><span>{english}</span><span class="coordinate">{num} / PERSONAL SPACE</span></div><section class="workstation"><div class="station-title"><div><p class="eyebrow">SPENDWISE / PERSONAL FINANCE</p><h1>{heading}</h1></div><div class="station-emblem" aria-hidden="true"><span></span><span></span><span></span></div></div><div class="connection"><span class="led"></span>账本已保存<span class="connection-divider">/</span><button data-open="source">查看数据范围 ↗</button></div>
<section class="dialogue" aria-label="AI 对话"><div class="dialogue-heading"><span><i class="ai-mark" aria-hidden="true">✦</i> DeepSeek</span><button data-open="history">历史对话 <span>↗</span></button></div><div class="welcome"><span class="welcome-label">财务助理</span><p>查询记录、解释变化，<br>或比较一项新的计划。</p></div><div class="suggestions"><button data-prompt="本月有哪些支出变化值得关注？">支出变化 <span>↗</span></button><button data-prompt="检查我的预算与实际支出">预算检查 <span>↗</span></button></div><div class="response" hidden aria-live="polite"></div><form><label class="sr-only" for="question">输入问题</label><textarea id="question" rows="2" placeholder="输入问题，使用已有账本分析"></textarea><div class="composer-toolbar"><button type="button" class="attachment" data-open="source" aria-label="补充账单">＋</button><span>已保存账本</span><button class="send" type="submit" aria-label="发送问题">↑</button></div></form><p class="demo-note">交互样板 · 未连接真实数据</p></section>
<div class="shortcuts" aria-label="工作区入口">{shortcuts}</div></section>
<button class="world-marker marker-ledger" data-open="ledger"><span class="marker-dot">▤</span><span>账本档案<small>LEDGER STORAGE</small></span><b>↗</b></button><button class="world-marker marker-plan" data-open="plan"><span class="marker-dot">⌁</span><span>计划空间<small>PLAN & SIMULATE</small></span><b>↗</b></button><span class="scene-caption">{english}<small>ENVIRONMENT STUDY / {num}</small></span></main>
<footer><a href="index.html">← 全部场景</a><span>{num} / {title}</span><button class="motion-toggle" aria-pressed="false">暂停场景动态 Ⅱ</button></footer>
<dialog><div class="modal-top"><span>SPENDWISE / WORKSPACE</span><button class="close" aria-label="关闭">×</button></div><h2></h2><p></p><div class="modal-body"></div><small>静态原型，仅演示交互。</small></dialog><script src="scene.js"></script><script src="app.js"></script></body></html>'''
    (ROOT / f'{slug}.html').write_text(html, encoding='utf-8')

cards=''.join(f'<a href="{slug}.html" class="scene-card {slug}"><img src="{slug}-preview.png" alt="{title}主页场景预览"><div><span>{num} / {english}</span><h2>{title}<b>↗</b></h2><p>{desc}</p></div></a>' for slug,num,title,english,heading,desc in designs)
(ROOT/'index.html').write_text(f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpendWise · 场景界面研究</title><link rel="stylesheet" href="style.css"></head><body class="gallery"><main><div class="gallery-top"><a href="../index.html">SPENDWISE / DESIGN LAB</a><span>STUDY 04 — PIXEL WORLDS</span></div><div class="gallery-intro"><span class="gallery-kicker">第四轮 · 场景式界面</span><h1>四个世界。<br><span>同一份账本。</span></h1><p>像素场景构成空间，AI 对话构成操作中心。<br>选择一个场景，进入完整主页。</p></div><div class="scene-grid">{cards}</div><div class="gallery-bottom">HTML + CANVAS · 本地资源 · 无真实数据连接</div></main></body></html>',encoding='utf-8')
