import { Link } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import { useAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import allInOneIcon from '~/assets/all-in-one.svg'
import collapseIcon from '~/assets/icons/collapse.svg'
import settingIcon from '~/assets/icons/setting.svg'
import themeIcon from '~/assets/icons/theme.svg'
import icon from '~/assets/icon.svg'
import { cx } from '~/utils'
import { useEnabledBots } from '~app/hooks/use-enabled-bots'
import { sidebarCollapsedAtom } from '~app/state'
import ThemeSettingModal from '../ThemeSettingModal'
import Tooltip from '../Tooltip'
import NavLink from './NavLink'

function IconButton(props: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      className="p-[6px] rounded-[10px] w-fit cursor-pointer hover:opacity-80 bg-secondary bg-opacity-20"
      onClick={props.onClick}
    >
      <img src={props.icon} alt="" className="w-6 h-6" />
    </button>
  )
}

function Sidebar() {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)
  const [themeSettingModalOpen, setThemeSettingModalOpen] = useState(false)
  const enabledBots = useEnabledBots()
  return (
    <motion.aside
      className={cx(
        'flex flex-col bg-primary-background bg-opacity-40 overflow-hidden',
        collapsed ? 'items-center px-[15px]' : 'w-[230px] px-4',
      )}
    >
      <div className={cx('flex mt-8 gap-3 items-center', collapsed ? 'flex-col-reverse' : 'flex-row justify-between')}>
        <Link to="/" className="flex gap-2 items-center text-primary-text" aria-label="多智工作台首页">
          <img src={icon} alt="" className="w-8 h-8" />
          {!collapsed && <span className="font-semibold text-lg whitespace-nowrap">多智工作台</span>}
        </Link>
        <button type="button" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed((c) => !c)}>
          <motion.img src={collapseIcon} alt="" className="w-5 h-5" animate={{ rotate: collapsed ? 180 : 0 }} />
        </button>
      </div>
      {!collapsed && <p className="text-xs text-secondary-text mt-3 ml-1">一次提问，多方回答</p>}
      <nav className="flex flex-col gap-[13px] mt-8 overflow-y-auto scrollbar-none" aria-label="模型与会话">
        <NavLink to="/" text="多模型同屏" icon={allInOneIcon} iconOnly={collapsed} />
        {enabledBots.map(({ botId, bot }) => (
          <NavLink
            key={botId}
            to="/chat/$botId"
            params={{ botId }}
            text={bot.name}
            icon={bot.avatar}
            iconOnly={collapsed}
          />
        ))}
      </nav>
      <div className="mt-auto pt-4">
        {!collapsed && (
          <Link to="/premium" className="text-xs text-secondary-text hover:underline ml-1">
            关于多智工作台 · 本地版
          </Link>
        )}
        <div className={cx('flex mt-4 gap-[10px] mb-4', collapsed ? 'flex-col' : 'flex-row')}>
          <Tooltip content={t('Display')}>
            <IconButton icon={themeIcon} label="显示设置" onClick={() => setThemeSettingModalOpen(true)} />
          </Tooltip>
          <Tooltip content={t('Settings')}>
            <Link to="/setting" aria-label="设置">
              <img src={settingIcon} alt="设置" className="w-8 h-8 p-1 rounded-lg hover:bg-secondary" />
            </Link>
          </Tooltip>
        </div>
      </div>
      <ThemeSettingModal open={themeSettingModalOpen} onClose={() => setThemeSettingModalOpen(false)} />
    </motion.aside>
  )
}
export default Sidebar
