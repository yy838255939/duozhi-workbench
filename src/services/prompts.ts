import Browser from 'webextension-polyfill'

export interface Prompt {
  id: string
  title: string
  prompt: string
}

export async function loadLocalPrompts() {
  const { prompts: value } = await Browser.storage.local.get('prompts')
  return (value || []) as Prompt[]
}

export async function saveLocalPrompt(prompt: Prompt) {
  const prompts = await loadLocalPrompts()
  let existed = false
  for (const p of prompts) {
    if (p.id === prompt.id) {
      p.title = prompt.title
      p.prompt = prompt.prompt
      existed = true
      break
    }
  }
  if (!existed) {
    prompts.unshift(prompt)
  }
  await Browser.storage.local.set({ prompts })
  return existed
}

export async function removeLocalPrompt(id: string) {
  const prompts = await loadLocalPrompts()
  await Browser.storage.local.set({ prompts: prompts.filter((p) => p.id !== id) })
}

export async function loadRemotePrompts(): Promise<Prompt[]> {
  return [
    {
      id: 'builtin-compare',
      title: '方案比较',
      prompt: '请比较以下方案的优缺点、成本和适用场景，并给出你的推荐理由：\n',
    },
    { id: 'builtin-writing', title: '中文润色', prompt: '请用自然、清楚的中文润色以下内容，保留原意，减少套话：\n' },
    {
      id: 'builtin-research',
      title: '问题分析',
      prompt: '请分析以下问题，说明关键原因、可选方案和下一步行动；不确定的地方请明确标注：\n',
    },
    {
      id: 'builtin-code',
      title: '代码讲解',
      prompt: '请先用大白话解释以下代码的目的，再说明主要步骤和可以改进的地方：\n',
    },
  ]
}
