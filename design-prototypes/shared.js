document.querySelectorAll('.prototype').forEach(page => {
  const buttons = [...page.querySelectorAll('[data-step]')]
  const panels = [...page.querySelectorAll('[data-panel]')]
  function activate(name) {
    buttons.forEach(button => {
      const active = button.dataset.step === name
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
    })
    panels.forEach(panel => { panel.hidden = panel.dataset.panel !== name })
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => activate(button.dataset.step))
    button.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      event.preventDefault()
      const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]
      activate(next.dataset.step)
      next.focus()
    })
  })
  const textarea = page.querySelector('textarea')
  const result = page.querySelector('.demo-result')
  function send() {
    if (!textarea.value.trim()) { textarea.focus(); return }
    result.textContent = '这是交互样板：真实版本会结合账本和你的目标回答“' + textarea.value.trim() + '”。'
    result.hidden = false
  }
  page.querySelector('[data-send]').addEventListener('click', send)
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() }
  })
  page.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
    textarea.value = button.dataset.prompt
    textarea.focus()
  }))
  const file = page.querySelector('[data-file]')
  file.addEventListener('change', () => {
    page.querySelector('.file-name').textContent = file.files?.[0]?.name || '尚未选择文件'
  })
})
