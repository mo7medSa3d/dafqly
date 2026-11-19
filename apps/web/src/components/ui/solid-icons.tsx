/**
 * App icon set. Lucide (outline, 1.75 stroke, rounded joins) is the single
 * source: every icon in the app goes through this file, so the style is
 * changed in one place. Names are kept so existing imports keep working.
 */
import * as React from "react";
import {
  ArrowDownUp, ArrowLeft as LArrowLeft, ArrowRight as LArrowRight, ArrowUp as LArrowUp, Ban,   Bell as LBell, BellOff, Bot, Building2, CalendarCheck2, CalendarDays, Camera as LCamera, Check as LCheck,
  CheckCheck, ChevronDown, ChevronRight, ChevronUp, ChevronsRight, CircleAlert, CircleCheck, CircleDollarSign, CircleX,
  ClipboardList, Clock3, CloudUpload, Coins as LCoins, Copy as LCopy, Cpu as LCpu, CreditCard as LCreditCard,
  Crown as LCrown, DollarSign, Download, ExternalLink, Eye as LEye, EyeOff, FileText as LFileText, Gauge as LGauge,
  Globe as LGlobe, HandCoins as LHandCoins, Handshake as LHandshake, Landmark, LayoutDashboard, Link2,
  LoaderCircle, LockKeyhole, LogOut, Maximize2, Menu, MessageCircleMore, Minimize2, Minus as LMinus,
  Moon as LMoon, Pencil, Phone as LPhone, Plus as LPlus, Receipt as LReceipt, RefreshCw, RotateCcw, Save,
  ScanLine, Search, Send, Settings, ShieldCheck as LShieldCheck, SlidersHorizontal as LSliders,
  Sparkles, Sun as LSun, Trash2, TrendingUp, TriangleAlert, Upload, User as LUser, UserCheck as LUserCheck,
  Users as LUsers, Wallet as LWallet, X as LX, Zap,
} from "lucide-react";

export interface SolidIconProps extends Omit<React.SVGProps<SVGSVGElement>, "ref"> {
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
}
export type LucideIcon = React.ComponentType<SolidIconProps>;

export const SquaresFour: LucideIcon = LayoutDashboard;
export const UsersThree: LucideIcon = LUsers;
export const Users: LucideIcon = LUsers;
export const User: LucideIcon = LUser;
export const UserCheck: LucideIcon = LUserCheck;
export const Receipt: LucideIcon = LReceipt;
export const Bank: LucideIcon = Landmark;
export const ClipboardText: LucideIcon = ClipboardList;
export const Sparkle: LucideIcon = Sparkles;
export const CloudArrowUp: LucideIcon = CloudUpload;
export const Scan: LucideIcon = ScanLine;
export const CreditCard: LucideIcon = LCreditCard;
export const SlidersHorizontal: LucideIcon = LSliders;
export const GearSix: LucideIcon = Settings;
export const Buildings: LucideIcon = Building2;
export const CheckCircle: LucideIcon = CircleCheck;
export const XCircle: LucideIcon = CircleX;
export const WarningCircle: LucideIcon = CircleAlert;
export const Warning: LucideIcon = TriangleAlert;
export const Clock: LucideIcon = Clock3;
export const ClockCountdown: LucideIcon = Clock3;
export const Coins: LucideIcon = LCoins;
export const Prohibit: LucideIcon = Ban;
export const ShieldCheck: LucideIcon = LShieldCheck;
export const LockKey: LucideIcon = LockKeyhole;
export const Bell: LucideIcon = LBell;
export const BellRinging: LucideIcon = LBell;
export const BellSlash: LucideIcon = BellOff;
export const CalendarCheck: LucideIcon = CalendarCheck2;
export const CalendarBlank: LucideIcon = CalendarDays;
export const Camera: LucideIcon = LCamera;
export const ChatCircleDots: LucideIcon = MessageCircleMore;
export const Robot: LucideIcon = Bot;
export const Lightning: LucideIcon = Zap;
export const Crown: LucideIcon = LCrown;
export const Gauge: LucideIcon = LGauge;
export const ChartLineUp: LucideIcon = TrendingUp;
export const TrendingUpIcon: LucideIcon = TrendingUp;
export { TrendingUp };
export const FileText: LucideIcon = LFileText;
export const FileCsv: LucideIcon = LFileText;
export const Notebook: LucideIcon = LFileText;
export const Wallet: LucideIcon = LWallet;
export const HandCoins: LucideIcon = LHandCoins;
export const Handshake: LucideIcon = LHandshake;
export const Phone: LucideIcon = LPhone;
export const PencilSimple: LucideIcon = Pencil;
export const Trash: LucideIcon = Trash2;
export const Copy: LucideIcon = LCopy;
export const DownloadSimple: LucideIcon = Download;
export const UploadSimple: LucideIcon = Upload;
export const Eye: LucideIcon = LEye;
export const EyeSlash: LucideIcon = EyeOff;
export const FloppyDisk: LucideIcon = Save;
export const PaperPlaneTilt: LucideIcon = Send;
export const MagnifyingGlass: LucideIcon = Search;
export const Moon: LucideIcon = LMoon;
export const Sun: LucideIcon = LSun;
export const Globe: LucideIcon = LGlobe;
export const Cpu: LucideIcon = LCpu;
export const CurrencyDollar: LucideIcon = DollarSign;
export const CurrencyCircleDollar: LucideIcon = CircleDollarSign;
export const ArrowLeft: LucideIcon = LArrowLeft;
export const ArrowRight: LucideIcon = LArrowRight;
export const ArrowUp: LucideIcon = LArrowUp;
export const ArrowSquareOut: LucideIcon = ExternalLink;
export const ArrowCounterClockwise: LucideIcon = RotateCcw;
export const ArrowsClockwise: LucideIcon = RefreshCw;
export const ArrowsInSimple: LucideIcon = Minimize2;
export const ArrowsOutSimple: LucideIcon = Maximize2;
export const CaretDoubleRight: LucideIcon = ChevronsRight;
export const CaretDown: LucideIcon = ChevronDown;
export const CaretRight: LucideIcon = ChevronRight;
export const CaretUp: LucideIcon = ChevronUp;
export const Check: LucideIcon = LCheck;
export const Checks: LucideIcon = CheckCheck;
export const LinkSimple: LucideIcon = Link2;
export const List: LucideIcon = Menu;
export const Minus: LucideIcon = LMinus;
export const Plus: LucideIcon = LPlus;
export const SignOut: LucideIcon = LogOut;
export const SortAscending: LucideIcon = ArrowDownUp;
export const SpinnerGap: LucideIcon = LoaderCircle;
export const X: LucideIcon = LX;
// kept for pages that want a cash glyph
