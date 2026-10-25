import clsx from 'clsx'
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline'
import openai from '~/assets/official-ai/openai.png'
import claude from '~/assets/official-ai/claude.png'
import claudeCode from '~/assets/official-ai/claude-code.png'
import gemini from '~/assets/official-ai/gemini.png'
import deepseek from '~/assets/official-ai/deepseek.svg'
import doubao from '~/assets/official-ai/doubao.png'
import qwen from '~/assets/official-ai/qwen.png'
import kimi from '~/assets/official-ai/kimi.png'
import perplexity from '~/assets/official-ai/perplexity.svg'
import grok from '~/assets/official-ai/grok.png'
import copilot from '~/assets/official-ai/copilot.svg'
import mistral from '~/assets/official-ai/mistral.svg'
import './ai-logo.scss'

const logos: Record<string, string> = {
  chatgpt: openai,
  claude,
  gemini,
  deepseek,
  doubao,
  qwen,
  kimi,
  perplexity,
  grok,
  copilot,
  mistral,
  'cli:codex': openai,
  'cli:claude': claudeCode,
}

export default function AiLogo({ id, className }: { id: string; className?: string }) {
  const src = logos[id.replace(/^web:/, '')]
  return (
    <span className={clsx('ai-logo', className)} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : <QuestionMarkCircleIcon />}
    </span>
  )
}
