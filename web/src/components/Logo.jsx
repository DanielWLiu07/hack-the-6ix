// Logo - the Battery, not Blood apple mark (inline SVG, matches favicon.svg and
// the landing scene's apple). Sizeable via the `size` prop; decorative by default.
export default function Logo({ size = 22, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M16.4 8.4c1-2.7 3.5-4.1 6.3-4.2.2 2.8-1.1 5.4-3.7 6.2-1.7.5-3.2-.4-2.6-2z"
        fill="#46a758"
        stroke="#2c6b38"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 9.6c-.2-2.1.2-3.6 1.4-4.9"
        fill="none"
        stroke="#5b3a22"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M16 10.5c-2.7-2.2-7.6-1.7-9.1 2.8-1.6 4.6 1 12.9 5 14.6 1.7.7 2.4-.6 3.1-.6.7 0 1.4 1.3 3.1.6 4-1.7 6.6-10 5-14.6-1.5-4.5-6.4-5-9.1-2.8z"
        fill="#e5484d"
        stroke="#8c1f24"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M11 14.6c-1 1.8-1.1 4.3-.2 6.4"
        fill="none"
        stroke="#f5a3a0"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  )
}
