import * as React from "react";

export interface SolidIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

export type LucideIcon = React.ComponentType<SolidIconProps>;

function Icon({
  size = 20,
  className,
  children,
  strokeWidth: _sw,
  ...props
}: SolidIconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

function StrokeIcon({
  size = 20,
  className,
  children,
  strokeWidth = 2.4,
  ...props
}: SolidIconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
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
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---- Solid Filled Navigation & Domain Icons (2026 SF / Solar Bold) ---- */

export function SquaresFour(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="3" width="8" height="8" rx="2.2" />
      <rect x="13" y="3" width="8" height="8" rx="2.2" />
      <rect x="3" y="13" width="8" height="8" rx="2.2" />
      <rect x="13" y="13" width="8" height="8" rx="2.2" />
    </Icon>
  );
}

export function UsersThree(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2.5 19.5c0-3.2 2.9-5.5 6.5-5.5s6.5 2.3 6.5 5.5v.5h-13v-.5Z" />
      <circle cx="17" cy="8.5" r="2.7" opacity="0.78" />
      <path d="M16.5 14.3c2.8.3 5 2.1 5 4.7v1h-4.5v-.5c0-2-.9-3.8-2.3-5 .6-.1 1.2-.2 1.8-.2Z" opacity="0.78" />
    </Icon>
  );
}
export const Users = UsersThree;

export function User(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5v1H4v-1Z" />
    </Icon>
  );
}

export function UserCheck(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <circle cx="9.5" cy="7.5" r="3.8" />
      <path d="M2.5 20c0-3.5 3.1-6 7-6s7 2.5 7 6v.5h-14V20Z" />
      <path d="m16.5 11.5 2 2 4-4.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function Receipt(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5 3.5A1.5 1.5 0 0 1 6.5 2h11A1.5 1.5 0 0 1 19 3.5v17.3a.8.8 0 0 1-1.3.6l-1.9-1.4a.8.8 0 0 0-1 0l-1.8 1.4a.8.8 0 0 1-1 0l-1.8-1.4a.8.8 0 0 0-1 0l-1.9 1.4a.8.8 0 0 1-1.3-.6V3.5ZM8.5 7a1 1 0 0 0 0 2h7a1 1 0 1 0 0-2h-7Zm0 4a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2h-7Zm0 4a1 1 0 1 0 0 2h4.5a1 1 0 1 0 0-2H8.5Z"
      />
    </Icon>
  );
}

export function Bank(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M12 2.2 2.5 7.4A1 1 0 0 0 3 9.2h18a1 1 0 0 0 .5-1.8L12 2.2Z" />
      <rect x="4.5" y="10.8" width="2.8" height="7.4" rx="0.8" />
      <rect x="10.6" y="10.8" width="2.8" height="7.4" rx="0.8" />
      <rect x="16.7" y="10.8" width="2.8" height="7.4" rx="0.8" />
      <rect x="2.5" y="19.5" width="19" height="2.3" rx="1.1" />
    </Icon>
  );
}

export function ClipboardText(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M9 2.5A1.5 1.5 0 0 0 7.5 4v.5h9V4A1.5 1.5 0 0 0 15 2.5H9Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.5 4.5A1.5 1.5 0 0 0 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a1.5 1.5 0 0 0-1.5-1.5h-1v1.2A1.8 1.8 0 0 1 15.7 7.5H8.3a1.8 1.8 0 0 1-1.8-1.8V4.5h-1Zm3 6.5a1 1 0 0 0 0 2h7a1 1 0 1 0 0-2h-7Zm0 4a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2h-5Z"
      />
    </Icon>
  );
}

export function Sparkle(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M11.2 2.4c.3-.8 1.3-.8 1.6 0l1.9 5.2 5.2 1.9c.8.3.8 1.3 0 1.6l-5.2 1.9-1.9 5.2c-.3.8-1.3.8-1.6 0l-1.9-5.2-5.2-1.9c-.8-.3-.8-1.3 0-1.6l5.2-1.9 1.9-5.2Z" />
      <path d="M18.8 15.6c.2-.5.8-.5 1 0l.7 1.8 1.8.7c.5.2.5.8 0 1l-1.8.7-.7 1.8c-.2.5-.8.5-1 0l-.7-1.8-1.8-.7c-.5-.2-.5-.8 0-1l1.8-.7.7-1.8Z" />
    </Icon>
  );
}

export function CloudArrowUp(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.4 4.5a6.2 6.2 0 0 0-6 4.7A4.6 4.6 0 0 0 2 13.8a4.7 4.7 0 0 0 4.7 4.7h11.1a4.2 4.2 0 0 0 .6-8.3A6.2 6.2 0 0 0 12.4 4.5Zm.3 4.8a1 1 0 0 0-1.4 0l-2.6 2.6a1 1 0 1 0 1.4 1.4l.9-.9v3.4a1 1 0 1 0 2 0v-3.4l.9.9a1 1 0 0 0 1.4-1.4l-2.6-2.6Z"
      />
    </Icon>
  );
}

export function Scan(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8a1 1 0 1 0 0-2H5.5A3.5 3.5 0 0 0 2 5.5V8a1 1 0 1 0 2 0Zm16 0V5.5A1.5 1.5 0 0 0 18.5 4H16a1 1 0 1 1 0-2h2.5A3.5 3.5 0 0 1 22 5.5V8a1 1 0 1 1-2 0ZM4 16v2.5A1.5 1.5 0 0 0 5.5 20H8a1 1 0 1 1 0 2H5.5A3.5 3.5 0 0 1 2 18.5V16a1 1 0 1 1 2 0Zm16 0v2.5a1.5 1.5 0 0 1-1.5 1.5H16a1 1 0 1 0 0 2h2.5a3.5 3.5 0 0 0 3.5-3.5V16a1 1 0 1 0-2 0Z" />
      <rect x="6" y="7" width="12" height="10" rx="2" opacity="0.25" />
      <rect x="5" y="11" width="14" height="2.2" rx="1.1" />
    </Icon>
  );
}

export function CreditCard(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2 7.5A2.5 2.5 0 0 1 4.5 5h15A2.5 2.5 0 0 1 22 7.5V9H2V7.5Zm0 3.8v5.2A2.5 2.5 0 0 0 4.5 19h15a2.5 2.5 0 0 0 2.5-2.5v-5.2H2Zm4 3.4a1 1 0 0 1 1-1h3a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1Z"
      />
    </Icon>
  );
}

export function SlidersHorizontal(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5.5" width="18" height="2" rx="1" />
      <circle cx="9" cy="6.5" r="2.5" />
      <rect x="3" y="11" width="18" height="2" rx="1" />
      <circle cx="15.5" cy="12" r="2.5" />
      <rect x="3" y="16.5" width="18" height="2" rx="1" />
      <circle cx="8" cy="17.5" r="2.5" />
    </Icon>
  );
}

export function GearSix(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.2 2.4a1.8 1.8 0 0 1 3.6 0l.3 1.4a7.7 7.7 0 0 1 1.7.7l1.2-.8a1.8 1.8 0 0 1 2.5 2.5l-.8 1.2c.3.5.5 1.1.7 1.7l1.4.3a1.8 1.8 0 0 1 0 3.6l-1.4.3a7.7 7.7 0 0 1-.7 1.7l.8 1.2a1.8 1.8 0 0 1-2.5 2.5l-1.2-.8c-.5.3-1.1.5-1.7.7l-.3 1.4a1.8 1.8 0 0 1-3.6 0l-.3-1.4a7.7 7.7 0 0 1-1.7-.7l-1.2.8a1.8 1.8 0 0 1-2.5-2.5l.8-1.2a7.7 7.7 0 0 1-.7-1.7l-1.4-.3a1.8 1.8 0 0 1 0-3.6l1.4-.3c.2-.6.4-1.2.7-1.7l-.8-1.2A1.8 1.8 0 0 1 7 3.7l1.2.8c.5-.3 1.1-.5 1.7-.7l.3-1.4ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
      />
    </Icon>
  );
}

export function Buildings(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.5 4.5A1.5 1.5 0 0 1 5 3h7a1.5 1.5 0 0 1 1.5 1.5V8H19a1.5 1.5 0 0 1 1.5 1.5V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V4.5ZM6.5 6.5a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 0 1.6H7.3a.8.8 0 0 1-.8-.8Zm0 3.5a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 0 1.6H7.3a.8.8 0 0 1-.8-.8Zm0 3.5a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 0 1.6H7.3a.8.8 0 0 1-.8-.8Zm8-2.3a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 0 1.6h-2a.8.8 0 0 1-.8-.8Zm0 3.5a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 0 1.6h-2a.8.8 0 0 1-.8-.8Z"
      />
    </Icon>
  );
}

/* ---- Status & Security Icons (Solid) ---- */

export function CheckCircle(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.2 8.1a1 1 0 0 0-1.4-1.4l-4 4-1.6-1.6a1 1 0 1 0-1.4 1.4l2.3 2.3a1 1 0 0 0 1.4 0l4.7-4.7Z"
      />
    </Icon>
  );
}

export function XCircle(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.2 6.8a1 1 0 0 0-1.4 0L12 10.6l-1.8-1.8a1 1 0 0 0-1.4 1.4l1.8 1.8-1.8 1.8a1 1 0 1 0 1.4 1.4l1.8-1.8 1.8 1.8a1 1 0 1 0 1.4-1.4L13.4 12l1.8-1.8a1 1 0 0 0 0-1.4Z"
      />
    </Icon>
  );
}

export function WarningCircle(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5.2a1 1 0 0 1 1 1v4.6a1 1 0 1 1-2 0V8.2a1 1 0 0 1 1-1Zm0 9.8a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z"
      />
    </Icon>
  );
}

export function Warning(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.3 3.4a2 2 0 0 1 3.4 0l7.7 13.5A2 2 0 0 1 19.7 20H4.3a2 2 0 0 1-1.7-3.1L10.3 3.4ZM12 8.2a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Zm0 8.8a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Z"
      />
    </Icon>
  );
}

export function Clock(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5.5a1 1 0 1 0-2 0V12a1 1 0 0 0 .4.8l3 2.2a1 1 0 1 0 1.2-1.6L13 11.5v-4Z"
      />
    </Icon>
  );
}
export const ClockCountdown = Clock;

export function Coins(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <ellipse cx="9.5" cy="7" rx="6.5" ry="3" />
      <path d="M3 10.3v2.5c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3v-2.5c-1.4 1.1-3.8 1.7-6.5 1.7S4.4 11.4 3 10.3Z" />
      <path d="M3 15.3v2.5c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3v-2.5c-1.4 1.1-3.8 1.7-6.5 1.7s-5.1-.6-6.5-1.7Z" />
      <circle cx="17.5" cy="14.5" r="4" opacity="0.82" />
    </Icon>
  );
}

export function Prohibit(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM6.7 8.1l9.2 9.2a7.5 7.5 0 0 1-9.2-9.2Zm10.6 7.8L8.1 6.7a7.5 7.5 0 0 1 9.2 9.2Z"
      />
    </Icon>
  );
}

export function ShieldCheck(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.2c.3 0 .6.1.9.2l6.5 2.8A1.5 1.5 0 0 1 20.3 6.6v4.8c0 5.1-3.3 9.4-7.9 10.5a1.6 1.6 0 0 1-.8 0C7 20.8 3.7 16.5 3.7 11.4V6.6a1.5 1.5 0 0 1 .9-1.4l6.5-2.8c.3-.1.6-.2.9-.2Zm3.9 7.5a1 1 0 0 0-1.4-1.4l-3.3 3.3-1.5-1.5a1 1 0 1 0-1.4 1.4l2.2 2.2a1 1 0 0 0 1.4 0l4-4Z"
      />
    </Icon>
  );
}

export function ShieldWarning(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.2c.3 0 .6.1.9.2l6.5 2.8A1.5 1.5 0 0 1 20.3 6.6v4.8c0 5.1-3.3 9.4-7.9 10.5a1.6 1.6 0 0 1-.8 0C7 20.8 3.7 16.5 3.7 11.4V6.6a1.5 1.5 0 0 1 .9-1.4l6.5-2.8c.3-.1.6-.2.9-.2Zm0 5.3a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Zm0 8.5a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Z"
      />
    </Icon>
  );
}

export function LockKey(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7 9V7a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v2Zm3 4a1.5 1.5 0 0 1 1 2.6V17a1 1 0 1 1-2 0v-1.4A1.5 1.5 0 0 1 12 13Z"
      />
    </Icon>
  );
}

/* ---- Solid Communication, Actions & Analytics Icons ---- */

export function Bell(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5v3.4l-1.3 2.2a1 1 0 0 0 .9 1.5h13.8a1 1 0 0 0 .9-1.5L18.5 12.4V9A6.5 6.5 0 0 0 12 2.5Z" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0h-5Z" />
    </Icon>
  );
}
export const BellRinging = Bell;

export function BellSlash(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5v3.4l-1.3 2.2a1 1 0 0 0 .9 1.5h10.2L6.6 7.4A6.5 6.5 0 0 1 12 2.5Zm6.5 9.9V9a6.5 6.5 0 0 0-9.6-5.7l9.6 9.1ZM9.5 18a2.5 2.5 0 0 0 5 0h-5Z" opacity="0.7" />
      <path d="M3.3 3.3a1 1 0 0 1 1.4 0l16 16a1 1 0 0 1-1.4 1.4l-16-16a1 1 0 0 1 0-1.4Z" />
    </Icon>
  );
}

export function CalendarCheck(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7 2.5a1 1 0 0 1 1 1V5h8V3.5a1 1 0 1 1 2 0V5h1.5A2.5 2.5 0 0 1 22 7.5v12a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 19.5v-12A2.5 2.5 0 0 1 4.5 5H6V3.5a1 1 0 0 1 1-1Zm8.7 9.8a1 1 0 0 0-1.4-1.4l-3.3 3.3-1.3-1.3a1 1 0 1 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z"
      />
    </Icon>
  );
}

export function CalendarBlank(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M7 2.5a1 1 0 0 1 1 1V5h8V3.5a1 1 0 1 1 2 0V5h1.5A2.5 2.5 0 0 1 22 7.5V9H2V7.5A2.5 2.5 0 0 1 4.5 5H6V3.5a1 1 0 0 1 1-1ZM2 10.8h20v8.7a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 19.5v-8.7Z" />
    </Icon>
  );
}

export function Camera(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.4 4.3A1.5 1.5 0 0 1 9.7 3.5h4.6a1.5 1.5 0 0 1 1.3.8L16.7 6H19.5A2.5 2.5 0 0 1 22 8.5v10a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-10A2.5 2.5 0 0 1 4.5 6h2.8l1.1-1.7ZM12 9.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
      />
    </Icon>
  );
}

export function ChatCircleDots(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.5C6.5 2.5 2 6.6 2 11.7c0 2.3.9 4.4 2.4 6l-.8 3.1a.9.9 0 0 0 1.2 1.1l3.3-1.3c1.2.4 2.5.6 3.9.6 5.5 0 10-4.1 10-9.5S17.5 2.5 12 2.5ZM8.5 13a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Zm3.5 0a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Zm3.5 0a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Z"
      />
    </Icon>
  );
}

export function Robot(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a1 1 0 0 1 1 1v2h3.5A3.5 3.5 0 0 1 20 8.5v7a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 15.5v-7A3.5 3.5 0 0 1 7.5 5H11V3a1 1 0 0 1 1-1Zm-3 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-5.5 5a.8.8 0 0 0 0 1.6h5a.8.8 0 0 0 0-1.6h-5Z"
      />
    </Icon>
  );
}

export function Lightning(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M13.2 2.3a.8.8 0 0 1 1.4.6l-1.1 6.6h5.1a.8.8 0 0 1 .6 1.3l-8.4 10.9a.8.8 0 0 1-1.4-.6l1.1-6.6H5.4a.8.8 0 0 1-.6-1.3l8.4-10.9Z" />
    </Icon>
  );
}

export function Crown(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M3.2 7.5a1 1 0 0 1 1.5-.3l4.2 3.3 2.3-5.2a1 1 0 0 1 1.8 0l2.3 5.2 4.2-3.3a1 1 0 0 1 1.5.9l-1.3 9.7a1.5 1.5 0 0 1-1.5 1.3H5.8a1.5 1.5 0 0 1-1.5-1.3L3.2 7.5Z" />
    </Icon>
  );
}

export function Gauge(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 4a9.5 9.5 0 0 0-9.5 9.5c0 2.1.7 4 1.9 5.5a1.5 1.5 0 0 0 1.2.5h12.8c.5 0 .9-.2 1.2-.5a9.5 9.5 0 0 0-7.6-15Zm3.8 6.2a1 1 0 0 1 0 1.4l-2.6 2.6a1.8 1.8 0 1 1-1.4-1.4l2.6-2.6a1 1 0 0 1 1.4 0Z"
      />
    </Icon>
  );
}

export function ChartLineUp(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="3" width="18" height="18" rx="4" opacity="0.16" />
      <path d="M5.5 16.5a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0l2.1 2.1 4.3-4.3h-1.8a1 1 0 1 1 0-2h4a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-1.8l-5 5a1 1 0 0 1-1.4 0L10.2 13l-3.3 3.5a1 1 0 0 1-1.4 0Z" />
    </Icon>
  );
}

export function FileText(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6 2.5A2 2 0 0 0 4 4.5v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.2a2 2 0 0 0-.6-1.4l-4.2-4.2A2 2 0 0 0 13.8 2H6v.5Zm2.5 7.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2h-7Zm0 4a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2h-5Z"
      />
    </Icon>
  );
}
export const FileCsv = FileText;
export const Notebook = FileText;

export function Wallet(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.5 5A2.5 2.5 0 0 0 2 7.5v9A2.5 2.5 0 0 0 4.5 19h15a2.5 2.5 0 0 0 2.5-2.5v-7A2.5 2.5 0 0 0 19.5 7H5.2a.7.7 0 0 1 0-1.4H19a1 1 0 1 0 0-2H4.5ZM17 12a1.5 1.5 0 1 0 0 3h2.5v-3H17Z"
      />
    </Icon>
  );
}

export function HandCoins(p: SolidIconProps) {
  return <Coins {...p} />;
}

export function Handshake(p: SolidIconProps) {
  return <ShieldCheck {...p} />;
}

export function Phone(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M6.6 3.5a1.5 1.5 0 0 1 1.7.9l1.1 2.7a1.5 1.5 0 0 1-.4 1.6l-1.2 1.1a11 11 0 0 0 4.4 4.4l1.1-1.2a1.5 1.5 0 0 1 1.6-.4l2.7 1.1a1.5 1.5 0 0 1 .9 1.7l-.5 2.8a1.5 1.5 0 0 1-1.5 1.2C9.5 21 3 14.5 3.5 6.8a1.5 1.5 0 0 1 1.2-1.5l1.9-1.8Z" />
    </Icon>
  );
}

export function PencilSimple(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M16.9 3.6a2.2 2.2 0 0 1 3.1 3.1l-1.5 1.5-3.1-3.1 1.5-1.5Zm-2.9 2.9L4.6 15.9a1.5 1.5 0 0 0-.4.8l-.7 3.2a.8.8 0 0 0 1 1l3.2-.7a1.5 1.5 0 0 0 .8-.4l9.4-9.4-3.1-3.1Z" />
    </Icon>
  );
}

export function Trash(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M9 3a1.5 1.5 0 0 0-1.5 1.5V5H4a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2h-3.5v-.5A1.5 1.5 0 0 0 15 3H9Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.5 8.5h13l-.8 10.6a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 8.5Zm4.5 3a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0v-4a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0v-4a1 1 0 0 0-1-1Z"
      />
    </Icon>
  );
}

export function Copy(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <rect x="8" y="8" width="12" height="13" rx="2.5" />
      <path d="M5.5 3A2.5 2.5 0 0 0 3 5.5v10A2.5 2.5 0 0 0 5.5 18H6.5V8A2.5 2.5 0 0 1 9 5.5h7V5.5A2.5 2.5 0 0 0 13.5 3h-8Z" opacity="0.72" />
    </Icon>
  );
}

export function DownloadSimple(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3a1 1 0 0 1 1 1v7.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4l2.3 2.3V4a1 1 0 0 1 1-1Z" />
      <path d="M4 16.5a1 1 0 0 1 1 1V19h14v-1.5a1 1 0 1 1 2 0V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1 1 0 0 1 1-1Z" />
    </Icon>
  );
}

export function UploadSimple(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3.3a1 1 0 0 1 .7.3l4 4a1 1 0 1 1-1.4 1.4L13 6.7V15a1 1 0 1 1-2 0V6.7L8.7 9a1 1 0 1 1-1.4-1.4l4-4a1 1 0 0 1 .7-.3Z" />
      <path d="M4 16.5a1 1 0 0 1 1 1V19h14v-1.5a1 1 0 1 1 2 0V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1 1 0 0 1 1-1Z" />
    </Icon>
  );
}

export function Eye(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 5C6.8 5 2.7 8.4 1.6 12c1.1 3.6 5.2 7 10.4 7s9.3-3.4 10.4-7C21.3 8.4 17.2 5 12 5Zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
      />
    </Icon>
  );
}

export function EyeSlash(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M12 5c5.2 0 9.3 3.4 10.4 7-.5 1.7-1.6 3.3-3.1 4.6l-2.3-2.3A3.5 3.5 0 0 0 11.7 9L9.4 6.7A11 11 0 0 1 12 5ZM4.7 3.3a1 1 0 0 0-1.4 1.4l1.9 1.9C3.3 8 2.1 10 1.6 12c1.1 3.6 5.2 7 10.4 7 1.8 0 3.5-.4 5-1.1l2.3 2.3a1 1 0 0 0 1.4-1.4l-16-16Z" />
    </Icon>
  );
}

export function FloppyDisk(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.5 3A1.5 1.5 0 0 0 3 4.5v15A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5V7.6a1.5 1.5 0 0 0-.4-1L17.4 3.4a1.5 1.5 0 0 0-1-.4H4.5ZM8 5h6v3.5H8V5Zm4 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
      />
    </Icon>
  );
}

export function PaperPlaneTilt(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M21.4 2.6a1 1 0 0 0-1.1-.2l-17 7.2a1 1 0 0 0 0 1.8l6.2 2.7 2.7 6.2a1 1 0 0 0 1.8 0l7.2-17a1 1 0 0 0 .2-1.1Z" />
    </Icon>
  );
}

export function MagnifyingGlass(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.5 3a7.5 7.5 0 1 0 4.6 13.4l4.1 4.1a1.1 1.1 0 0 0 1.6-1.6l-4.1-4.1A7.5 7.5 0 0 0 10.5 3Zm0 2.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"
      />
    </Icon>
  );
}

export function Moon(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path d="M20.4 14.8A8.5 8.5 0 0 1 9.2 3.6a.8.8 0 0 0-1-.9A9.5 9.5 0 1 0 21.3 15.8a.8.8 0 0 0-.9-1Z" />
    </Icon>
  );
}

export function Sun(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 16.5a1 1 0 0 1 1 1V21a1 1 0 1 1-2 0v-1.5a1 1 0 0 1 1-1ZM4.9 4.9a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 1 1-1.4 1.4L4.9 6.3a1 1 0 0 1 0-1.4Zm11.7 11.7a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 0 1-1.4 1.4l-1.1-1.1a1 1 0 0 1 0-1.4ZM2 12a1 1 0 0 1 1-1h1.5a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm16.5 0a1 1 0 0 1 1-1H21a1 1 0 1 1 0 2h-1.5a1 1 0 0 1-1-1ZM4.9 19.1a1 1 0 0 1 0-1.4l1.1-1.1a1 1 0 0 1 1.4 1.4l-1.1 1.1a1 1 0 0 1-1.4 0Zm11.7-11.7a1 1 0 0 1 0-1.4l1.1-1.1a1 1 0 1 1 1.4 1.4l-1.1 1.1a1 1 0 0 1-1.4 0Z" />
    </Icon>
  );
}

export function Globe(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 2.1v2.9H7.4A8 8 0 0 1 11 4.1Zm2 0a8 8 0 0 1 3.6 2.9H13V4.1ZM5.9 9h5.1v2H4.2c.2-.7.4-1.4.8-2Zm7.1 0h5.1c.4.6.6 1.3.8 2H13V9Zm-8.8 4H11v2H5.9a8 8 0 0 1-1.7-2Zm8.8 0h6.8a8 8 0 0 1-1.7 2H13v-2Zm-5.6 4H11v2.9A8 8 0 0 1 7.4 17Zm5.6 0h3.6a8 8 0 0 1-3.6 2.9V17Z"
      />
    </Icon>
  );
}

export function TableIcon(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.5 4A2.5 2.5 0 0 0 2 6.5v11A2.5 2.5 0 0 0 4.5 20h15a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 19.5 4h-15ZM4 10h6v3.5H4V10Zm8 0h8v3.5h-8V10Zm-8 5.5h6V18H4.5a.5.5 0 0 1-.5-.5v-2Zm8 0h8v2a.5.5 0 0 1-.5.5H12v-2.5Z"
      />
    </Icon>
  );
}

export function Cpu(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9 2v2m3-2v2m3-2v2M9 20v2m3-2v2m3-2v2M2 9h2m-2 3h2m-2 3h2m16-6h2m-2 3h2m-2 3h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Icon>
  );
}

export function CurrencyDollar(p: SolidIconProps) {
  return (
    <Icon {...p}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 4.5a1 1 0 1 0-2 0v.6a2.9 2.9 0 0 0-.3 5.7l1.8.5c.8.2 1.2.6 1.2 1.1s-.6 1-1.5 1a2.2 2.2 0 0 1-1.8-.8 1 1 0 1 0-1.6 1.2c.6.8 1.5 1.3 2.4 1.5v.7a1 1 0 1 0 2 0v-.6c1.6-.3 2.7-1.5 2.7-3 0-1.4-.9-2.5-2.6-3l-1.8-.5c-.7-.2-1-.5-1-1s.5-.9 1.3-.9c.6 0 1.2.2 1.5.6a1 1 0 1 0 1.6-1.2 3.8 3.8 0 0 0-1.9-1.2V6.5Z"
      />
    </Icon>
  );
}
export const CurrencyCircleDollar = CurrencyDollar;

/* ---- Bold Crisp Directional & Utility Controls ---- */

export function ArrowLeft(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </StrokeIcon>
  );
}

export function ArrowRight(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </StrokeIcon>
  );
}

export function ArrowUp(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </StrokeIcon>
  );
}

export function ArrowSquareOut(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </StrokeIcon>
  );
}

export function ArrowCounterClockwise(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </StrokeIcon>
  );
}

export function ArrowsClockwise(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </StrokeIcon>
  );
}

export function ArrowsInSimple(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M4 14h6v6" />
      <path d="M20 10h-6V4" />
      <path d="m14 10 7-7" />
      <path d="m3 21 7-7" />
    </StrokeIcon>
  );
}

export function ArrowsOutSimple(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
    </StrokeIcon>
  );
}

export function CaretDoubleRight(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="m6 17 5-5-5-5" />
      <path d="m13 17 5-5-5-5" />
    </StrokeIcon>
  );
}

export function CaretRight(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="m9 18 6-6-6-6" />
    </StrokeIcon>
  );
}

export function CaretUp(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="m18 15-6-6-6 6" />
    </StrokeIcon>
  );
}

export function Check(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M20 6 9 17l-5-5" />
    </StrokeIcon>
  );
}

export function Checks(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </StrokeIcon>
  );
}

export function LinkSimple(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" x2="16" y1="12" y2="12" />
    </StrokeIcon>
  );
}

export function List(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </StrokeIcon>
  );
}

export function Minus(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M5 12h14" />
    </StrokeIcon>
  );
}

export function Plus(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </StrokeIcon>
  );
}

export function SignOut(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </StrokeIcon>
  );
}

export function SortAscending(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="m3 8 4-4 4 4" />
      <path d="M7 4v16" />
      <path d="M11 12h4" />
      <path d="M11 16h7" />
      <path d="M11 20h10" />
    </StrokeIcon>
  );
}

export function SpinnerGap(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </StrokeIcon>
  );
}

export function X(p: SolidIconProps) {
  return (
    <StrokeIcon {...p}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </StrokeIcon>
  );
}
