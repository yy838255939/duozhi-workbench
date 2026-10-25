import claudeLogo from '~/assets/official-ai/claude.png'
import baichuanLogo from '~/assets/logos/baichuan.png'
import bardLogo from '~/assets/logos/bard.svg'
import bingLogo from '~/assets/logos/bing.svg'
import chatglmLogo from '~/assets/logos/chatglm.svg'
import chatgptLogo from '~/assets/official-ai/openai.png'
import falconLogo from '~/assets/logos/falcon.jpeg'
import geminiLogo from '~/assets/official-ai/gemini.png'
import grokLogo from '~/assets/official-ai/grok.png'
import llamaLogo from '~/assets/logos/llama.png'
import mistralLogo from '~/assets/official-ai/mistral.svg'
import piLogo from '~/assets/logos/pi.png'
import pplxLogo from '~/assets/official-ai/perplexity.svg'
import qianwenLogo from '~/assets/official-ai/qwen.png'
import vicunaLogo from '~/assets/logos/vicuna.jpg'
import wizardlmLogo from '~/assets/logos/wizardlm.png'
import xunfeiLogo from '~/assets/logos/xunfei.png'
import yiLogo from '~/assets/logos/yi.svg'
import { BotId } from './bots'

export const CHATBOTS: Record<BotId, { name: string; avatar: string }> = {
  chatgpt: {
    name: 'ChatGPT',
    avatar: chatgptLogo,
  },
  claude: {
    name: 'Claude',
    avatar: claudeLogo,
  },
  bard: {
    name: 'Bard',
    avatar: bardLogo,
  },
  bing: {
    name: 'Bing',
    avatar: bingLogo,
  },
  perplexity: {
    name: 'Perplexity',
    avatar: pplxLogo,
  },
  llama: {
    name: 'Llama 2',
    avatar: llamaLogo,
  },
  gemini: {
    name: 'Gemini Pro',
    avatar: geminiLogo,
  },
  mistral: {
    name: 'Mixtral',
    avatar: mistralLogo,
  },
  vicuna: {
    name: 'Vicuna',
    avatar: vicunaLogo,
  },
  falcon: {
    name: 'Falcon',
    avatar: falconLogo,
  },
  grok: {
    name: 'Grok',
    avatar: grokLogo,
  },
  pi: {
    name: 'Pi',
    avatar: piLogo,
  },
  wizardlm: {
    name: 'WizardLM',
    avatar: wizardlmLogo,
  },
  chatglm: {
    name: '智谱清言',
    avatar: chatglmLogo,
  },
  xunfei: {
    name: '讯飞星火',
    avatar: xunfeiLogo,
  },
  qianwen: {
    name: '通义千问',
    avatar: qianwenLogo,
  },
  baichuan: {
    name: '百川',
    avatar: baichuanLogo,
  },
  yi: {
    name: '零一万物',
    avatar: yiLogo,
  },
}

export const CHATGPT_HOME_URL = 'https://chat.openai.com'
export const CHATGPT_API_MODELS = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'] as const
export const ALL_IN_ONE_PAGE_ID = 'all'

export const DEFAULT_CHATGPT_SYSTEM_MESSAGE =
  '你是一位可靠的 AI 助手，请默认使用简体中文，清晰、准确地回答问题。当前日期：{current_date}'

export type Layout = 2 | 3 | 4 | 'imageInput' | 'twoVertical' | 'sixGrid' // twoVertical is deprecated
