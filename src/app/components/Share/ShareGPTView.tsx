import { FC, useCallback, useState } from 'react'
import { trackEvent } from '~app/plausible'
import { ChatMessageModel } from '~types'
import Button from '../Button'
import { Input } from '../Input'
import { uploadToShareGPT } from './sharegpt'

interface Props {
  messages: ChatMessageModel[]
}

const ShareGPTView: FC<Props> = ({ messages }) => {
  const [uploading, setUploading] = useState(false)
  const [resultId, setResultId] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  const upload = useCallback(async () => {
    setUploading(true)
    trackEvent('share_chat_sharegpt')
    try {
      const id = await uploadToShareGPT(messages)
      setResultId(id)
    } finally {
      setUploading(false)
    }
  }, [messages])

  const copy = useCallback(() => {
    navigator.clipboard.writeText(`https://shareg.pt/${resultId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 500)
  }, [resultId])

  return (
    <div className="p-5 flex flex-col items-center justify-center gap-5 h-full">
      <p className="w-[400px] text-center text-primary-text">
        这会把当前会话上传到 <b>sharegpt.com</b>，并生成<b>公开可访问</b>的分享链接。
      </p>
      {resultId ? (
        <div className="flex flex-row items-center gap-3 w-[300px]">
          <Input value={`https://shareg.pt/${resultId}`} readOnly className="grow" />
          <Button size="small" color="primary" text={copied ? '已复制' : '复制'} onClick={copy} />
        </div>
      ) : (
        <Button text="发布分享" color="primary" onClick={upload} isLoading={uploading} />
      )}
    </div>
  )
}

export default ShareGPTView
