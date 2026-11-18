const views = {
  home: ['现在就可以开始', '不用先完成任何步骤。选择一个想做的事，或者直接提问。'],
  ledger: ['账本', '现有账本始终可用。你可以搜索、核对和编辑记录，无需重新导入。'],
  review: ['只处理重要的事', '把重复交易、待确认分类和可能影响判断的歧义集中在这里；没有待处理项目时保持安静。'],
  plan: ['计划与推演', '预算、目标、未来现金流和消费模拟可以从这里进入，不用挤在首页。'],
  family: ['家庭空间', '家庭收支、共同预算、共同目标、议事和成员权限保留独立入口。'],
  import: ['补充账单', '想更新数据时再导入。之后的提问直接使用已保存、属于你的账本。'],
  history: ['继续对话', '对话记录是可返回的工作线索，而不是每次都要重新开始的流程。'],
  account: ['账户与设置', '连接、身份、数据导出和隐私设置放在次级位置，日常无需反复经过。'],
  more: ['更多功能', '账户与资产、消费模拟、家庭空间、设置和数据导出都能从这里抵达。'],
  answer: ['你的问题', '这里会结合已保存的账本和你提供的目标给出回答，并说明依据与数据覆盖范围。'],
}
const overlay = document.querySelector('#overlay')
const title = document.querySelector('#sheet-title')
const copy = document.querySelector('#sheet-copy')
const body = document.querySelector('#sheet-body')
const prompt = document.querySelector('#prompt')
let lastTrigger = null
function openView(name, trigger) {
  lastTrigger = trigger || document.activeElement
  const [heading, description] = views[name]
  title.textContent = heading
  copy.textContent = description
  body.replaceChildren()
  if (name === 'answer') {
    const question = document.createElement('blockquote')
    question.textContent = prompt.value.trim()
    body.append(question)
  }
  if (name === 'import') {
    const label = document.createElement('label')
    label.className = 'file-button'
    label.textContent = '选择账单文件'
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,.txt,.xlsx'
    const selected = document.createElement('p')
    selected.className = 'selected-file'
    selected.textContent = '尚未选择文件'
    input.addEventListener('change', () => { selected.textContent = input.files?.[0]?.name || '尚未选择文件' })
    label.append(input)
    body.append(label, selected)
  }
  overlay.hidden = false
  document.body.classList.add('sheet-open')
  overlay.querySelector('[data-close]').focus()
}
function closeView() {
  overlay.hidden = true
  document.body.classList.remove('sheet-open')
  lastTrigger?.focus()
}
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openView(button.dataset.open, button)))
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeView))
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.hidden) closeView() })
function send() { if (prompt.value.trim()) openView('answer', document.querySelector('#send')); else prompt.focus() }
document.querySelector('#send').addEventListener('click', send)
prompt.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() } })
