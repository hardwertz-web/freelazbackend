// Ícones em SVG inline (traço, 24x24, currentColor). Sem dependência externa:
// o app não usa biblioteca de ícones (Fase 1).

export type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function Svg({
  size = 22,
  className,
  strokeWidth = 1.8,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </Svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeWidth={2.2} />
    </Svg>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="M3 10h18" />
      <path d="M16.5 15h1.5" />
    </Svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </Svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </Svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 5 7 7-7 7" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m15 5-7 7 7 7" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 9 7 7 7-7" />
    </Svg>
  );
}

export function HeartIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props}>
      <path
        d="M12 20.3 4.9 13a4.6 4.6 0 0 1 6.5-6.5l.6.6.6-.6A4.6 4.6 0 0 1 19.1 13Z"
        fill={filled ? "currentColor" : "none"}
      />
    </Svg>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  );
}

export function StarIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props}>
      <path
        d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9Z"
        fill={filled ? "currentColor" : "none"}
      />
    </Svg>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6Z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="16" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function BanknoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 12h.01M18 12h.01" strokeWidth={2.4} />
    </Svg>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 17 17 7M9 7h8v8" />
    </Svg>
  );
}

export function ArrowDownLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 7 7 17M15 17H7V9" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8Z" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 8h.01" strokeWidth={2} />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </Svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m3.8 7 8.2 6 8.2-6" />
    </Svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
    </Svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </Svg>
  );
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18" />
    </Svg>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 21V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v15" />
      <path d="M15 10h3a2 2 0 0 1 2 2v9M2.5 21h19" />
      <path d="M8 8h3M8 12h3M8 16h3" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/* ---------------------------------------------------------------- *
 * Ícones de categoria (Fase 2.4a). O JobPosting não tem ícone no
 * backend: cada categoria conhecida ganha um desenho e o resto cai
 * em GridIcon, então nenhum chip fica vazio.
 * ---------------------------------------------------------------- */

export function SparklesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 1.7 4.6L18.3 9.3l-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7L12 3Z" />
      <path d="M18.5 14.5 19.4 17l2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9.9-2.5Z" />
    </Svg>
  );
}

export function GlassIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h16l-8 8-8-8Z" />
      <path d="M12 12v7M8.5 21h7" />
    </Svg>
  );
}

export function TrayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 14h18" />
      <path d="M4.8 14a7.2 7.2 0 0 1 14.4 0" />
      <path d="M12 4.8V7M9 21h6" />
    </Svg>
  );
}

export function ChefHatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 11.5a3.5 3.5 0 1 1 1-6.8 4 4 0 0 1 8 0 3.5 3.5 0 1 1 1 6.8v6.7a1.8 1.8 0 0 1-1.8 1.8H8.8A1.8 1.8 0 0 1 7 18.2v-6.7Z" />
      <path d="M7 15.5h10" />
    </Svg>
  );
}

export function BroomIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m14.5 3.5 6 6" />
      <path d="M16 5 8.5 12.5" />
      <path d="M9 11c1.6 1.6 1.9 4.2.6 6.1L7 21l-4-4 3.9-2.6C8.8 13.1 7.4 9.4 9 11Z" />
      <path d="m5.5 16.5 2 2" />
    </Svg>
  );
}

export function HammerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m14 6 4 4" />
      <path d="M4 20l7.5-7.5" />
      <path d="M12.5 4.5 15 2l7 7-2.5 2.5-2-2-4-4-2 2-1.5-1.5 2.5-2.5Z" />
    </Svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z" />
    </Svg>
  );
}

export function WrenchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.7 6.3a4.2 4.2 0 0 0 5.6 5.6l-9.4 9.4a2.3 2.3 0 0 1-3.2-3.2l9.4-9.4Z" />
      <path d="M14.7 6.3 17 4a4.2 4.2 0 0 1 3.3 6" />
    </Svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7.5h2.6L8.2 5h7.6l1.6 2.5H20a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-9A1.5 1.5 0 0 1 4 7.5Z" />
      <circle cx="12" cy="13" r="3.4" />
    </Svg>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 6.5h10v10h-10z" />
      <path d="M12.5 10.5H17l3.5 3.5v2.5h-8" />
      <circle cx="6.5" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </Svg>
  );
}

export function LeafIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 4C11 4 5 8 5 15c0 2.5 1.5 4.5 4 4.5 7 0 11-6 11-15.5Z" />
      <path d="M4 21c1.5-6 5-9.5 11-12" />
    </Svg>
  );
}

export function MusicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </Svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </Svg>
  );
}
