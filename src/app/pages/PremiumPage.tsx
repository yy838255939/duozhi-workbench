import { Link } from '@tanstack/react-router'
import PagePanel from '../components/Page'

export default function AboutPage() {
  return (
    <PagePanel title="关于多智工作台">
      <article className="max-w-2xl px-8 py-6 text-primary-text flex flex-col gap-5 leading-7">
        <p>多智工作台是基于 ChatHub 开源代码制作的中文本地版。你可以在同一个界面群发问题，也可以单独与某个模型聊天。</p>
        <p>本地界面功能直接可用。各 AI 平台的账号、会员和调用额度由对应平台管理。</p>
        <p>聊天记录和提示词保存在浏览器中。使用“设置 → 导出数据”可以备份。本版本不向原项目发送使用统计。</p>
        <p>当前基础版沿用公开源码中的模型接口。部分接口较旧，需要后续适配；界面可正常使用不代表每个旧接口都已可用。</p>
        <p className="text-sm text-secondary-text">
          开源来源：
          <a className="underline" href="https://github.com/chathub-dev/chathub" target="_blank" rel="noreferrer">
            ChatHub
          </a>
          。保留原项目版权声明与 GPL-3.0 许可证，本地修改同样采用 GPL-3.0。
        </p>
        <Link to="/" className="underline w-fit">
          返回多模型同屏
        </Link>
      </article>
    </PagePanel>
  )
}
