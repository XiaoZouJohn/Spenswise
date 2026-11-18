const dialog = document.querySelector('dialog')
const body = dialog.querySelector('.dialog-body')
const views = {
  ledger: ['账本', '已保存的记录可持续查询和核对。这里承接现有账本、分类和编辑组件。'],
  plan: ['预算与推演', '选择预算、目标或消费模拟。可以从已有计划开始，也可以把当前问题带入对话。'],
  family: ['家庭空间', '进入家庭收支、共同预算、目标和议事。家庭成员与私账访问权沿用现有权限。'],
  settings: ['账户与设置', '管理个人资料、DeepSeek 连接、账户资产和数据导出。'],
  source: ['资料范围', '此页面为静态原型。真实版本在此显示账本覆盖日期、记录数和导入时间，并提供更新入口。'],
  history: ['历史对话', '从已有讨论继续，账本不需要重新上传。'],
  review: ['待确认事项', '集中显示会影响判断的分类、重复记录与转账歧义。没有待处理事项时保持空白。'],
}
let lastFocus
function open(name) {
  lastFocus = document.activeElement
  dialog.querySelector('h2').textContent = views[name][0]
  dialog.querySelector('p').textContent = views[name][1]
  body.replaceChildren()
  if (name === 'source') {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.csv,.txt,.xlsx'; input.setAttribute('aria-label', '选择用于演示的账单文件')
    body.append(input)
  }
  if (name === 'plan') {
    for (const label of ['个人预算', '消费模拟', '账户与资产']) {
      const button = document.createElement('button'); button.textContent = label + ' ↗'
      button.addEventListener('click', () => { dialog.querySelector('p').textContent = `这里将打开现有的${label}组件。当前为界面演示。` })
      body.append(button)
    }
  }
  dialog.showModal()
}
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => open(button.dataset.open)))
dialog.querySelector('.close').addEventListener('click', () => dialog.close())
dialog.addEventListener('close', () => lastFocus?.focus())
dialog.addEventListener('click', event => { if (event.target === dialog) { const r=dialog.getBoundingClientRect(); if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) dialog.close() } })
const form = document.querySelector('form')
const textarea = form.querySelector('textarea')
function send(event) {
  event?.preventDefault()
  if (!textarea.value.trim()) { textarea.focus(); return }
  const response = document.querySelector('.response')
  response.replaceChildren()
  const heading = document.createElement('strong'); heading.textContent = textarea.value.trim()
  const text = document.createElement('p'); text.textContent = '这是交互预览。真实回答会结合已保存的账本与计划，并提供相关记录作为依据。'
  response.append(heading, text); response.hidden = false
}
form.addEventListener('submit', send)
textarea.addEventListener('keydown', event => { if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing) send(event) })
