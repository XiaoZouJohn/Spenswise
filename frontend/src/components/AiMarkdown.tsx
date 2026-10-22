import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './AiMarkdown.css'

function safeMarkdownUrl(value: string) {
  const url = value.trim()
  if (/[\u0000-\u0020\\]/.test(url)) return ''
  if (url.startsWith('#') || (url.startsWith('/') && !url.startsWith('//'))) return url
  if (!/^(https?:\/\/|mailto:)/i.test(url)) return ''
  try {
    const parsed = new URL(url)
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? url : ''
  } catch {
    return ''
  }
}

export function AiMarkdown({ content, className = '' }: { content: string; className?: string }) {
  return <div className={`ai-markdown ${className}`.trim()}>
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={safeMarkdownUrl}
      components={{
        a({ href, children }) {
          if (!href) return <span>{children}</span>
          const external = /^https?:\/\//i.test(href) || /^mailto:/i.test(href)
          return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer nofollow' : undefined}>{children}</a>
        },
        img({ alt }) {
          return alt ? <span>{alt}</span> : null
        },
      }}
    >{content}</Markdown>
  </div>
}
