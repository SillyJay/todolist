/** 头像：有自定义图就用图，没有就用默认的「深色圆角方块 + 白色人像」 */
export function DefaultAvatar({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="avatar-default"
    >
      <rect x="0" y="0" width="24" height="24" rx="7" fill="currentColor" opacity="0.92" />
      <circle cx="12" cy="9.3" r="3.2" stroke="#fff" strokeWidth="1.7" />
      <path
        d="M5.9 19.4c.5-3 2.9-4.8 6.1-4.8s5.6 1.8 6.1 4.8"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function Avatar({
  src,
  size = 20
}: {
  src?: string
  size?: number
}): React.JSX.Element {
  if (src) {
    return <img className="avatar-img" src={src} alt="" width={size} height={size} />
  }
  return <DefaultAvatar size={size} />
}
