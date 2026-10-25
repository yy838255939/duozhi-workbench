import { createRoot } from 'react-dom/client'
import './i18n'
import './base.scss'
import './sidepanel.css'
import SidePanelPage from './pages/SidePanelPage'

createRoot(document.getElementById('app')!).render(<SidePanelPage />)
