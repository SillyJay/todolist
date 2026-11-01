/** 细线条图标（对齐 MinimaList 的线性风格） */
type P = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const IconTodo = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={23} height={23}>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <path d="M8 12h8" />
  </svg>
)

export const IconTimer = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={23} height={23}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4.5l3 1.8" />
  </svg>
)

export const IconCal = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={23} height={23}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M8 3.5V6M16 3.5V6M3.5 10h17" />
    <path d="M8.5 13.5h1.2v4.2" />
    <path d="M13.6 17.7h2.6" />
  </svg>
)

export const IconHistory = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={23} height={23}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5V9H8" />
    <path d="M12 8.5V12l2.5 1.6" />
  </svg>
)

export const IconGear = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={23} height={23}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.6-1.2-1.6-2.8-1.9.7a7.6 7.6 0 0 0-2.6-1.5L14.5 3h-3.2l-.4 2.1a7.6 7.6 0 0 0-2.6 1.5l-1.9-.7L4.8 8.7l1.6 1.2a7.6 7.6 0 0 0 0 3l-1.6 1.2 1.6 2.8 1.9-.7a7.6 7.6 0 0 0 2.6 1.5l.4 2.1h3.2l.4-2.1a7.6 7.6 0 0 0 2.6-1.5l1.9.7 1.6-2.8-1.6-1.2Z" />
  </svg>
)

export const IconPlus = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={24} height={24} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconSearch = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={22} height={22} strokeWidth={1.8}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
)

export const IconMore = ({ className }: P): React.JSX.Element => (
  <svg className={className} viewBox="0 0 24 24" width={22} height={22} fill="currentColor">
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
  </svg>
)

export const IconChevron = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={16} height={16} strokeWidth={2}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const IconChevronDown = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={14} height={14} strokeWidth={2.2}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const IconCheck = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={13} height={13} strokeWidth={3}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
)

export const IconPlay = ({ className }: P): React.JSX.Element => (
  <svg className={className} viewBox="0 0 24 24" width={28} height={28} fill="currentColor">
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  </svg>
)

export const IconPause = ({ className }: P): React.JSX.Element => (
  <svg className={className} viewBox="0 0 24 24" width={26} height={26} fill="currentColor">
    <rect x="7" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </svg>
)

export const IconNote = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={22} height={22}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </svg>
)

export const IconClockSm = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={22} height={22}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
)

export const IconUser = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={22} height={22}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4S18.1 16.4 19.5 20" />
  </svg>
)

export const IconMoon = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={22} height={22}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
  </svg>
)

export const IconCloud = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={22} height={22}>
    <path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.5 3.5 0 0 0 7 18Z" />
  </svg>
)

export const IconBell = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={22} height={22}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
    <path d="M10.5 20a2 2 0 0 0 3 0" />
  </svg>
)

export const IconInfo = ({ className }: P): React.JSX.Element => (
  <svg className={className} {...base} width={22} height={22}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 8h.01" />
  </svg>
)
