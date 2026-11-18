const modal = document.querySelector('dialog')
const modalBody = modal.querySelector('.modal-body')
const views = {
  ledger: ['账本', '查询、筛选与核对已保存的交易记录。主页中的场景标记与工具栏都能直接进入账本。'],
  review: ['待确认事项', '需要确认的分类、重复记录与转账歧义会汇集在这里。当前原型不包含真实账单。'],
  plan: ['计划空间', '进入预算、消费模拟与账户资产，或从已有计划继续对话。'],
  family: ['家庭空间', '家庭收支、共同预算、目标与议事的入口。实际访问仍由现有家庭权限决定。'],
  source: ['数据范围', '真实版本在这里展示已保存账本的覆盖日期、更新时间与来源。补充数据只在需要时进行。'],
  history: ['历史对话', '从已有讨论继续。已保存的账本始终可用，无需重新导入。'],
  settings: ['账户与设置', '个人资料、DeepSeek 连接、数据导出和隐私设置。'],
}
let lastFocus
function openView(name) {
  lastFocus = document.activeElement
  modal.querySelector('h2').textContent = views[name][0]
  modal.querySelector('p').textContent = views[name][1]
  modalBody.replaceChildren()
  if (name === 'source') {
    const input = document.createElement('input')
    input.type='file'; input.accept='.csv,.txt,.xlsx'; input.setAttribute('aria-label','选择演示账单文件')
    const status=document.createElement('p');status.className='selected-file';status.textContent='文件只在本地选择，不会上传。'
    input.addEventListener('change',()=>{status.textContent=input.files?.[0]?.name||'尚未选择文件'})
    modalBody.append(input,status)
  }
  if(name==='plan')for(const title of ['个人预算','消费模拟','账户与资产']){
    const button=document.createElement('button');button.textContent=title+' ↗'
    button.addEventListener('click',()=>{modal.querySelector('p').textContent=`此处承接现有的${title}页面。当前只展示入口。`})
    modalBody.append(button)
  }
  modal.showModal()
}
document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>openView(button.dataset.open)))
modal.querySelector('.close').addEventListener('click',()=>modal.close())
modal.addEventListener('close',()=>lastFocus?.focus())
modal.addEventListener('click',e=>{if(e.target!==modal)return;const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close()})
const form=document.querySelector('form'),textarea=document.querySelector('textarea'),response=document.querySelector('.response')
function send(e){
  e?.preventDefault();const question=textarea.value.trim();if(!question){textarea.focus();return}
  response.replaceChildren();const heading=document.createElement('strong');heading.textContent=question
  const text=document.createElement('p');text.textContent='这是交互演示。真实回答会使用已保存的账本与计划，并列出相关记录和覆盖范围。'
  response.append(heading,text);response.hidden=false;textarea.value='';textarea.focus()
}
form.addEventListener('submit',send)
textarea.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing)send(e)})
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{textarea.value=button.dataset.prompt;textarea.focus()}))
