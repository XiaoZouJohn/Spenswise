const content = {
  ledger: ['账本检索', '在此查看、筛选与核对已保存的交易记录。对话引用的金额应能回到对应账本。'],
  review: ['待确认事项', '只汇集会影响判断的重复、分类与数据归属问题；无需逐笔补充备注。'],
  plans: ['预算与推演', '从这里进入个人预算、目标和消费模拟。分析可引用它们，但不会替用户决定取舍。'],
  family: ['家庭空间', '共同收支、预算、目标、议事和成员权限使用各自已有的边界与入口。'],
  sources: ['资料与导入', '账本已经保存。只有出现新账单时才导入；资料范围应在分析结果中明确显示。'],
  more: ['全部功能', '账本、账户与资产、待确认、预算、消费模拟、家庭空间、设置和数据导出。'],
  answer: ['对话预览', '真实版本会使用已保存的账本回答，并列出依据、覆盖范围与需要确认的假设。此处不生成真实财务建议。'],
}
const detail = document.querySelector('.detail')
const question = document.querySelector('textarea')
let trigger = null
function openDetail(name, source) {
  trigger = source || document.activeElement
  const [heading, description] = content[name]
  detail.querySelector('h2').textContent = heading
  detail.querySelector('p').textContent = name === 'answer' ? `${description}\n\n问题：${question.value.trim()}` : description
  detail.hidden = false
  detail.querySelector('[data-close]').focus()
}
function closeDetail() { detail.hidden = true; trigger?.focus() }
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.view, button)))
document.querySelector('[data-close]').addEventListener('click', closeDetail)
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !detail.hidden) closeDetail() })
function submit() {
  const value = question.value.trim()
  if (!value) { question.focus(); return }
  if (value.startsWith('/')) {
    const command = value.slice(1).split(/\s/)[0]
    const target = { ledger: 'ledger', review: 'review', plan: 'plans', family: 'family', sources: 'sources' }[command]
    if (target) { openDetail(target, document.querySelector('[data-send]')); return }
  }
  openDetail('answer', document.querySelector('[data-send]'))
}
document.querySelector('[data-send]').addEventListener('click', submit)
question.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit() } })
document.querySelectorAll('[data-fill]').forEach(button => button.addEventListener('click', () => { question.value = button.dataset.fill; question.focus() }))
