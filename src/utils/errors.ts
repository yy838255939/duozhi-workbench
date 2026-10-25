export enum ErrorCode {
  CONVERSATION_LIMIT = 'CONVERSATION_LIMIT',
  UNKOWN_ERROR = 'UNKOWN_ERROR',
  CHATGPT_CLOUDFLARE = 'CHATGPT_CLOUDFLARE',
  CHATGPT_UNAUTHORIZED = 'CHATGPT_UNAUTHORIZED',
  CHATGPT_AUTH = 'CHATGPT_AUTH',
  GPT4_MODEL_WAITLIST = 'GPT4_MODEL_WAITLIST',
  BING_UNAUTHORIZED = 'BING_UNAUTHORIZED',
  BING_CAPTCHA = 'BING_CAPTCHA',
  API_KEY_NOT_SET = 'API_KEY_NOT_SET',
  BARD_EMPTY_RESPONSE = 'BARD_EMPTY_RESPONSE',
  BARD_UNAUTHORIZED = 'BARD_UNAUTHORIZED',
  MISSING_POE_HOST_PERMISSION = 'MISSING_POE_HOST_PERMISSION',
  POE_UNAUTHORIZED = 'POE_UNAUTHORIZED',
  MISSING_HOST_PERMISSION = 'MISSING_HOST_PERMISSION',
  XUNFEI_UNAUTHORIZED = 'XUNFEI_UNAUTHORIZED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  POE_MESSAGE_LIMIT = 'POE_MESSAGE_LIMIT',
  LMSYS_SESSION_EXPIRED = 'LMSYS_SESSION_EXPIRED',
  CHATGPT_INSUFFICIENT_QUOTA = 'CHATGPT_INSUFFICIENT_QUOTA',
  CLAUDE_WEB_UNAUTHORIZED = 'CLAUDE_WEB_UNAUTHORIZED',
  CLAUDE_WEB_UNAVAILABLE = 'CLAUDE_WEB_UNAVAILABLE',
  QIANWEN_WEB_UNAUTHORIZED = 'QIANWEN_WEB_UNAUTHORIZED',
  BAICHUAN_WEB_UNAUTHORIZED = 'BAICHUAN_WEB_UNAUTHORIZED',
  LMSYS_WS_ERROR = 'LMSYS_WS_ERROR',
  PPLX_FORBIDDEN_ERROR = 'PPLX_FORBIDDEN_ERROR',
  TWITTER_UNAUTHORIZED = 'TWITTER_UNAUTHORIZED',
  GROK_UNAVAILABLE = 'GROK_UNAVAILABLE',
}

const CHINESE_ERRORS: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.CONVERSATION_LIMIT]: '当前会话已达到上限，请重新开始。',
  [ErrorCode.UNKOWN_ERROR]: '请求失败，请确认平台可访问；旧接口可能需要适配。',
  [ErrorCode.CHATGPT_CLOUDFLARE]: '请先在 ChatGPT 官网完成登录和安全验证。',
  [ErrorCode.CHATGPT_UNAUTHORIZED]: '当前浏览器尚未登录 ChatGPT。',
  [ErrorCode.CHATGPT_AUTH]: 'ChatGPT 登录状态已失效，请重新登录。',
  [ErrorCode.GPT4_MODEL_WAITLIST]: '当前账号暂时不能使用所选模型。',
  [ErrorCode.BING_UNAUTHORIZED]: '请先登录微软账号。',
  [ErrorCode.BING_CAPTCHA]: '请在平台官网完成验证后重试。',
  [ErrorCode.API_KEY_NOT_SET]: '请在设置中填写对应平台的接口密钥。',
  [ErrorCode.BARD_EMPTY_RESPONSE]: '未收到 Google 网页模型的回答，旧接口可能需要适配。',
  [ErrorCode.BARD_UNAUTHORIZED]: '请先在 Google AI 官网登录。',
  [ErrorCode.MISSING_POE_HOST_PERMISSION]: '尚未授权访问 Poe，请检查插件权限。',
  [ErrorCode.POE_UNAUTHORIZED]: '请先登录 Poe 账号。',
  [ErrorCode.MISSING_HOST_PERMISSION]: '缺少对应平台官网的访问权限。',
  [ErrorCode.XUNFEI_UNAUTHORIZED]: '请先登录讯飞星火。',
  [ErrorCode.NETWORK_ERROR]: '网络连接失败，请检查对应平台官网能否打开。',
  [ErrorCode.POE_MESSAGE_LIMIT]: '已达到 Poe 的消息额度限制。',
  [ErrorCode.LMSYS_SESSION_EXPIRED]: '会话已过期，请重新开始。',
  [ErrorCode.CHATGPT_INSUFFICIENT_QUOTA]: '接口调用额度不足，请检查平台账单。',
  [ErrorCode.CLAUDE_WEB_UNAUTHORIZED]: '当前浏览器尚未登录 Claude。',
  [ErrorCode.CLAUDE_WEB_UNAVAILABLE]: 'Claude 网页服务当前不可访问。',
  [ErrorCode.QIANWEN_WEB_UNAUTHORIZED]: '请先登录通义千问。',
  [ErrorCode.BAICHUAN_WEB_UNAUTHORIZED]: '请先登录百川账号。',
  [ErrorCode.LMSYS_WS_ERROR]: '模型会话连接失败，请打开平台官网后重试。',
  [ErrorCode.PPLX_FORBIDDEN_ERROR]: 'Perplexity 拒绝了请求，请打开平台官网检查登录状态。',
  [ErrorCode.TWITTER_UNAUTHORIZED]: '当前浏览器尚未登录 X 账号。',
  [ErrorCode.GROK_UNAVAILABLE]: '旧版 Grok 接口已停用，请使用桌面版的 Grok 官网窗口。',
}

export class ChatError extends Error {
  code: ErrorCode
  originalMessage: string
  constructor(message: string, code: ErrorCode) {
    super(CHINESE_ERRORS[code] || message)
    this.originalMessage = message
    this.code = code
  }
}
