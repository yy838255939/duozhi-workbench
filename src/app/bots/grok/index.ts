import { ChatError, ErrorCode } from '~utils/errors'
import { AbstractBot, SendMessageParams } from '../abstract-bot'

// The inherited Twitter API integration depended on a fixed client credential.
// Desktop Grok uses the user's official website session instead.
export class GrokWebBot extends AbstractBot {
  async doSendMessage(_params: SendMessageParams): Promise<void> {
    throw new ChatError('旧版 Grok 接口已停用，请使用桌面版的 Grok 官网窗口。', ErrorCode.GROK_UNAVAILABLE)
  }

  resetConversation() {}

  get name() {
    return 'Grok'
  }
}
