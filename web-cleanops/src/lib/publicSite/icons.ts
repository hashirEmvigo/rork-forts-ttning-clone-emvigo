import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Clock,
  FileText,
  HeartHandshake,
  KeyRound,
  Languages,
  Layers,
  Leaf,
  LineChart,
  Lock,
  MapPin,
  Receipt,
  Route,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * Curated icon set available to config-driven public pages. Keeping this a fixed
 * registry (rather than free-form icon imports in content) lets page content
 * reference icons by a stable string key while staying fully type-safe.
 */
export const ICON_REGISTRY = {
  analytics: BarChart3,
  bell: Bell,
  building: Building2,
  calendar: CalendarClock,
  checklist: ClipboardCheck,
  clock: Clock,
  document: FileText,
  handshake: HeartHandshake,
  key: KeyRound,
  language: Languages,
  layers: Layers,
  eco: Leaf,
  growth: LineChart,
  lock: Lock,
  map: MapPin,
  invoice: Receipt,
  route: Route,
  shield: ShieldCheck,
  mobile: Smartphone,
  sparkles: Sparkles,
  customer: UserCheck,
  team: Users,
  workflow: Workflow,
} satisfies Record<string, LucideIcon>;

/** Allowed icon keys for public page content. */
export type IconKey = keyof typeof ICON_REGISTRY;
