export type GroupMemberKind = 'website' | 'cli'
export type GroupMessageStatus = 'queued' | 'sending' | 'streaming' | 'done' | 'error' | 'cancelled' | 'unconfirmed'
export type GroupRunMode = 'parallel' | 'relay'

export interface GroupMember {
  id: string
  name: string
  kind: GroupMemberKind
  color: string
  mark: string
  supported: boolean
  available?: boolean
  detail?: string
}

export interface GroupConversation {
  id: string
  title: string
  members: string[]
  roles: Record<string, string>
  workspace?: string
  createdAt: number
  updatedAt: number
  archived?: boolean
}

export interface GroupMessage {
  id: string
  conversationId: string
  runId?: string
  speakerId: string
  speakerName: string
  content: string
  status: GroupMessageStatus
  detail?: string
  createdAt: number
  step?: string
  sourceUrl?: string
}

export interface GroupActiveRun {
  id: string
  conversationId: string
  mode: GroupRunMode
  memberIds: string[]
}

export interface GroupSnapshot {
  conversations: GroupConversation[]
  messages: Record<string, GroupMessage[]>
  members: GroupMember[]
  activeRun: GroupActiveRun | null
}

export interface GroupChatBridge {
  list: () => Promise<GroupSnapshot>
  save: (conversation: {
    id?: string
    title: string
    members: string[]
    roles: Record<string, string>
    workspace?: string
  }) => Promise<GroupConversation>
  archive: (id: string) => Promise<void>
  send: (request: {
    conversationId: string
    content: string
    targets: string[]
    mode: GroupRunMode
  }) => Promise<{ runId: string }>
  stop: (runId: string) => Promise<void>
  openMember: (conversationId: string, memberId: string) => Promise<void>
  chooseWorkspace: () => Promise<string | null>
  onChange: (listener: (snapshot: GroupSnapshot) => void) => () => void
}
