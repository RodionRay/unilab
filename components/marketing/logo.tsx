import Link from "next/link";

type Props = {
  href?: string;
  className?: string;
  wordmark?: boolean;
  size?: number;
};

export function UniLabMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      className="us-logo-mark"
    >
      <rect width="32" height="32" rx="9" fill="url(#ul-grad)" />
      <path
        d="M9 8v10a7 7 0 0 0 14 0V8h-3.4v10a3.6 3.6 0 0 1-7.2 0V8z"
        fill="#1a1208"
      />
      <defs>
        <linearGradient id="ul-grad" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#ffd58a" />
          <stop offset="1" stopColor="#ffa92c" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function UniLabLogo({
  href = "/",
  className = "us-logo",
  wordmark = true,
  size = 32,
}: Props) {
  const inner = (
    <>
      <UniLabMark size={size} />
      {wordmark ? <span className="us-logo-word">UniLab</span> : null}
    </>
  );
  if (!href) {
    return <span className={className}>{inner}</span>;
  }
  return (
    <Link href={href} className={className} aria-label="UniLab">
      {inner}
    </Link>
  );
}
