import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from "react";
import { Responsive, WidthProvider, Layouts, Layout } from "react-grid-layout";
// Imported here rather than at the SPA root so marketing pages, which never
// render a dashboard grid, do not download this CSS.
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2, ChevronDown, ChevronUp, MoreVertical, GripVertical, MessageSquare, ImageDown, Trash2, Pencil, CalendarDays, Sparkles, History } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DateRange } from "react-day-picker";
import ChartRenderer from "@/components/charts/ChartRenderer";
import { useDashboard } from "@/hooks/useDashboard";
import { useEditMode, applyEditsToComponents } from "@/hooks/useEditMode";
import { EditProvider } from "@/components/charts/edit/EditContext";
import { ChangedBadge } from "@/components/charts/edit/ChangedBadge";
import { VersionHistoryDialog } from "@/components/charts/edit/VersionHistoryDialog";
import EditPanel from "@/components/charts/edit/EditPanel";
import InlineSvgTextEditor from "@/components/charts/edit/InlineSvgTextEditor";
import { useChatStore } from "@/chat/useChatStore";
import { DashboardGenerationRequest, LayoutType, ChartType, DashboardConfiguration, DashboardComponent } from "@/types/dashboard";
import {
  getMinSizeForType as getMinSizeForTypePure,
  computeStorageKey,
  sanitizeLayouts,
  sanitizeLayoutItems,
  shouldFillSparse,
  clampLayoutItem,
  getComponentLayoutFrame,
  compactLayoutVertically,
  compactLayoutsVertically,
  mergeLayoutIntoComponents,
  buildMinSizeMap,
  buildMinSizeMapForCols,
  layoutsCoverComponents,
  GRID_COLS,
} from "@/components/project-section/dashboardLayout";
import {
  extractNumericValue,
  extractSparklineData,
  filterDashboardDataByDateRange,
  parseDateLabel,
  resolveMetricSparklineData,
  shouldApplyDashboardDateRange,
} from "@/components/project-section/dashboardMetricData";

// Source of truth for the dashboard layout.
//   "s3"           — the `position` field on each component (loaded from S3) wins.
//                    localStorage is used only as a one-time legacy fallback,
//                    and writes are skipped in favor of debounced S3 saves
//                    triggered via the `onLayoutPersist` callback.
//   "localstorage" — pre-R6 behavior. Kept as an escape hatch in case the S3
//                    auto-save path needs to be disabled in production without
//                    a redeploy.
type LayoutSource = "s3" | "localstorage";

function getLayoutSource(): LayoutSource {
  return "s3";
}

const LAYOUT_SOURCE = getLayoutSource();
import {
  convertLLMStylingToChartStyling,
  validateChartStyling,
  getDefaultChartStyling,
  applyChartStyling,
  getChartStylingClasses,
  getDashboardBackgroundStyle,
  getColorPalette,
  CHART_THEME_COLORS,
  CHART_PRESET_THEMES,
  ChartPresetTheme,
  isLightBackground
} from "@/utils/chartStyling";
import type { ChartChipData } from "@/components/chat/ChartPreviewChip";
import { ChartFixPopover } from "@/components/project-section/ChartFixPopover";
import { exportChartAsPng } from "@/utils/exportUtils";

const SELECT_CHART_CONTEXT_EVENT = "dreamify:select-chart-context";
const DASHBOARD_CARD_MENU_ITEM_CLASS =
  "cursor-pointer gap-2 py-2 text-[var(--dashboard-title)] hover:bg-[var(--dashboard-menu-hover)] hover:text-[var(--dashboard-title)] focus:bg-[var(--dashboard-menu-hover)] focus:text-[var(--dashboard-title)] data-[highlighted]:bg-[var(--dashboard-menu-hover)] data-[highlighted]:text-[var(--dashboard-title)]";

const DATE_PRESETS = [
  { value: "full_range", label: "Full range" },
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "last_90d", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
  { value: "custom", label: "Custom range" },
];

type PremiumDashboardStyleVars = CSSProperties & Record<`--${string}`, string>;

function hexToRgba(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(15, 23, 42, ${alpha})`;
  const normalized = hex.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(normalized)) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToHslValues(hex: string | undefined): string {
  if (!hex) return "0 0% 0%";
  const normalized = hex.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(normalized)) return "0 0% 0%";
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function buildPremiumDashboardVars(theme: ChartPresetTheme): PremiumDashboardStyleVars {
  const colors = CHART_THEME_COLORS[theme] ?? CHART_THEME_COLORS[CHART_PRESET_THEMES.DEFAULT];
  const isLight = isLightBackground(theme);
  const accent = colors["highlight-color"];
  return {
    "--dashboard-accent": accent,
    "--dashboard-accent-soft": hexToRgba(accent, isLight ? 0.08 : 0.16),
    "--dashboard-accent-ring": hexToRgba(accent, isLight ? 0.18 : 0.28),
    "--dashboard-bg": colors["bg-dashboard-color"],
    "--dashboard-card-bg": colors["bg-card-color"],
    "--dashboard-card-border": colors["border-card-color"],
    "--dashboard-title": colors["title-color"],
    "--dashboard-muted": colors["description-color"],
    "--dashboard-element": colors["element-color"],
    "--dashboard-command-bg": hexToRgba(colors["bg-dashboard-color"], isLight ? 0.92 : 0.88),
    "--dashboard-control-bg": hexToRgba(colors["bg-card-color"], isLight ? 0.9 : 0.84),
    "--dashboard-control-hover": hexToRgba(accent, isLight ? 0.1 : 0.18),
    "--dashboard-menu-hover": hexToRgba(colors["title-color"], isLight ? 0.08 : 0.12),
    "--dashboard-popover-bg": colors["bg-card-color"],
    "--dashboard-card-shadow": isLight
      ? "0 12px 28px rgba(15, 23, 42, 0.07)"
      : "0 18px 38px rgba(0, 0, 0, 0.26)",
    "--dashboard-card-shadow-hover": isLight
      ? "0 18px 36px rgba(15, 23, 42, 0.11)"
      : "0 22px 44px rgba(0, 0, 0, 0.34)",
  };
}

function getPresetRange(preset: string): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "last_7d":
      return { from: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000), to };
    case "last_90d":
      return { from: new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000), to };
    case "this_month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
    case "last_month": {
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastOfLastMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
      return {
        from: new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1),
        to: new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), lastOfLastMonth.getDate()),
      };
    }
    case "this_year":
      return { from: new Date(now.getFullYear(), 0, 1), to };
    case "last_year":
      return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear() - 1, 11, 31) };
    case "last_30d":
    default:
      return { from: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000), to };
  }
}

function dashboardComponentToChartChip(component: any): ChartChipData {
  const cfg = component.component_config ?? {};
  const componentId = String(component.id);
  const displayType =
    component.type === "chart"
      ? String(cfg.type ?? "bar")
      : component.type === "metric"
        ? "metric"
        : component.type === "table"
          ? "table"
          : String(cfg.type ?? "bar");
  return {
    id: String(cfg.id ?? component.id),
    componentId,
    title: String(cfg.title ?? "Untitled"),
    type: displayType,
  };
}

interface DashboardPreviewProps {
  dataSource?: string;
  dashboardId?: string;
  className?: string;
  style?: React.CSSProperties;
  processedData?: any;
  staticConfig?: DashboardConfiguration | null;
  isExporting?: boolean;
  onExportLayoutChange?: (didSplit: boolean) => void;
  /** Card ⋮ menu (Fix in chat, …). Only enabled on project workspace; keep false for public preview & exports. */
  showCardActionsMenu?: boolean;
  /** projectId is used to uniquely store layouts for chat-generated (processed) dashboards without a real ID */
  projectId?: string;
  /**
   * Called whenever the final, edits-applied component list changes.
   * project.tsx uses this to know the exact components to write on save.
   */
  onEditedComponentsChange?: (components: any[], activeDashboard: any | null) => void;
  /**
   * When true, skip the localStorage read/write for layouts. Use for ephemeral
   * inline previews (admin/hidden capturer) where persisting layout can bleed
   * stale grid items across different dashboards. The dashboard view itself
   * leaves this false.
   */
  disablePersistence?: boolean;
  /**
   * Called after every drag/resize stop with the components list merged with
   * the new layout (each component's `position` reflects the latest x/y/w/h).
   * The parent (project.tsx) debounces this and pushes it to S3 via
   * conversationService.saveDashboardData. R6 follow-up: localStorage stops
   * being the source of truth for layout; S3 is.
   */
  onLayoutPersist?: (components: any[]) => void;
  /** When true, grid drag and resize are disabled (read-only view). */
  readOnly?: boolean;
  /**
   * Phase 7: called after a successful revert so the owner can re-fetch the
   * dashboard data (the backend has written a new "reverted" version). Optional
   * and backward-compatible; when absent the id-based dashboard refreshes itself.
   */
  onDashboardReverted?: () => void;
}

const DashboardPreview = ({
  dataSource,
  dashboardId,
  className = "",
  style = {},
  processedData,
  staticConfig,
  isExporting = false,
  onExportLayoutChange,
  showCardActionsMenu = false,
  projectId,
  onEditedComponentsChange,
  disablePersistence = false,
  onLayoutPersist,
  readOnly = false,
  onDashboardReverted,
}: DashboardPreviewProps) => {
  const [activeSection, setActiveSection] = useState("overview");
  const [expandedInsights, setExpandedInsights] = useState(false);
  const [datePreset, setDatePreset] = useState<string>("full_range");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  // Pass undefined to useDashboard if staticConfig or processedData exists so it doesn't try to fetch
  const { dashboardState, generateDashboard, refreshDashboard, resetDashboard, updateComponent } = useDashboard(staticConfig || processedData ? undefined : dashboardId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Edit feedback loop state from store
  const changedComponentIds = useChatStore((s) => s.changedComponentIds);
  // Phase 7: conversation id for version-history calls (per-dashboard history).
  const currentConversationId = useChatStore((s) => s.currentConversationId);

  // Manual-edit feature state
  const editMode = useEditMode((s) => s.editMode);
  const setEditMode = useEditMode((s) => s.setEditMode);
  const editsState = useEditMode((s) => s.edits);
  const selectedComponentId = useEditMode((s) => s.selectedComponentId);
  const setSelectedComponent = useEditMode((s) => s.setSelectedComponent);
  const applyFieldEdit = useEditMode((s) => s.applyFieldEdit);
  const hydrateEdits = useEditMode((s) => s.hydrate);

  // Track highlight fade-out timer
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [exportingIds, setExportingIds] = useState<Set<string>>(new Set());
  const [removedComponentIds, setRemovedComponentIds] = useState<Set<string>>(new Set());
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  // Phase 7: version-history dialog, scoped to the component it was opened from.
  const [historyComponent, setHistoryComponent] = useState<DashboardComponent | null>(null);
  useEffect(() => {
    if (changedComponentIds.size > 0) {
      setHighlightedIds(new Set(changedComponentIds));
      const timer = setTimeout(() => {
        setHighlightedIds(new Set());
        useChatStore.getState().setChangedComponentIds(new Set());
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [changedComponentIds]);

  useEffect(() => {
    if (removedComponentIds.size === 0) return;
    setLayouts(prev => {
      const filterOut = (items: Layout[]) => items.filter(i => !removedComponentIds.has(i.i));
      return { lg: filterOut(prev.lg), md: filterOut(prev.md), sm: filterOut(prev.sm), xs: filterOut(prev.xs), xxs: filterOut(prev.xxs) };
    });
  }, [removedComponentIds]);


  // Determine which configuration to use (static from parent vs fetched from state)
  const configuration = staticConfig || dashboardState.configuration;
  const isLoading = !staticConfig && dashboardState.loading;
  const errorMsg = !staticConfig && dashboardState.error;

  // No automatic dashboard generation on mount

  // Utility function to compute time_comparison from sparkline data
  const computeTimeComparisonFromData = (
    sparklineData: Array<{ label: string, value: number }> | undefined,
    currentValue: number | null,
    period: string = 'wow'
  ): { period: string; current_value: number; previous_value: number; percentage_change: number } | null => {
    if (!sparklineData || sparklineData.length < 2) {
      return null;
    }

    // Create a copy and try to sort by date if labels are dates
    const sortedData = [...sparklineData];
    const dates = sortedData.map(item => parseDateLabel(item.label)).filter(d => d !== null);

    if (dates.length === sortedData.length) {
      // All labels are valid dates, sort by date
      sortedData.sort((a, b) => {
        const dateA = parseDateLabel(a.label);
        const dateB = parseDateLabel(b.label);
        if (!dateA || !dateB) return 0;
        return dateA.getTime() - dateB.getTime();
      });
    }

    const latest = sortedData[sortedData.length - 1];
    const previous = sortedData[sortedData.length - 2];

    if (!latest || !previous || typeof latest.value !== 'number' || typeof previous.value !== 'number') {
      return null;
    }

    const current = currentValue !== null && isFinite(currentValue) ? currentValue : latest.value;
    const prev = previous.value;

    if (prev === 0 || !isFinite(current) || !isFinite(prev)) {
      return null;
    }

    const percentageChange = ((current - prev) / prev) * 100;

    return {
      period,
      current_value: current,
      previous_value: prev,
      percentage_change: percentageChange
    };
  };

  // Utility function to find matching chart for metric
  const findMatchingChartForMetric = (metricTitle: string, charts: any[]): any | null => {
    if (!metricTitle || !Array.isArray(charts) || charts.length === 0) return null;

    // Normalize metric title
    const normalizedMetric = metricTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Keywords that might appear in both metric and chart titles
    const keywords = ['revenue', 'users', 'orders', 'sales', 'stickiness', 'active', 'total', 'average', 'count'];

    for (const chart of charts) {
      if (!chart.title) continue;

      const normalizedChart = chart.title.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Check if chart has time-series data
      const hasTimeSeriesData = Array.isArray(chart.datasets) &&
        chart.datasets.length > 0 &&
        Array.isArray(chart.datasets[0]?.data) &&
        chart.datasets[0].data.length > 0;

      if (!hasTimeSeriesData) continue;

      // Check for keyword matches
      for (const keyword of keywords) {
        if (normalizedMetric.includes(keyword) && normalizedChart.includes(keyword)) {
          return chart;
        }
      }

      // Check if metric title is a substring of chart title or vice versa
      if (normalizedMetric.length > 3 && (normalizedChart.includes(normalizedMetric) || normalizedMetric.includes(normalizedChart))) {
        return chart;
      }
    }

    return null;
  };

  // Utility function to filter data by date range
  const filterDataByDateRange = (data: any, dateRange: DateRange | undefined): any => {
    return filterDashboardDataByDateRange(data, dateRange);
  };

  const selectedTheme = useChatStore((s) => s.selectedTheme || s.selectedTemplate);
  const isThemePending = useChatStore((s) => s.isThemePending || s.isTemplatePending);

  // Normalize incoming data (Morpheus-first format)
  const getDashboardStyling = (data: any) => {
    // A pending theme is queued for the NEXT generation (toolbar pre-run pick).
    // It must NOT affect the current dashboard's visual theme — only a post-run
    // header theme change should override the theme here.
    const effectiveThemeSelection = isThemePending ? null : selectedTheme;

    // Materialise styling_recommendations if absent so theme override is never silently lost.
    // This covers dashboards generated before styling_recommendations became required.
    if (data && !data.styling_recommendations) {
      data.styling_recommendations = { theme: effectiveThemeSelection?.suggestedTheme ?? data.theme_id ?? 'default' };
    }
    if (data?.styling_recommendations) {
      // Selected dashboard theme always takes precedence — the AI may return a generic/default
      // theme when processing @chart updates (no theme context in that prompt),
      // so we enforce the chosen theme on every render.
      const forcedTheme = effectiveThemeSelection?.suggestedTheme ?? data.theme_id;
      if (forcedTheme) {
        data.styling_recommendations.theme = forcedTheme;
      }

      const converted = convertLLMStylingToChartStyling(data.styling_recommendations);
      const validation = validateChartStyling(converted);

      if (validation.isValid) {
        // Ensure background matches the theme if AI didn't explicitly provide one
        if (!data.styling_recommendations.dashboardBackground && forcedTheme) {
          const bg = CHART_THEME_COLORS[forcedTheme as ChartPresetTheme]?.['bg-dashboard-color'];
          if (bg) converted.dashboardBackground = bg;
        }
        return converted;
      }
    }

    // Fallback to effective theme if AI didn't return one or it's invalid
    if (effectiveThemeSelection?.suggestedTheme) {
      return getDefaultChartStyling(effectiveThemeSelection.suggestedTheme as ChartPresetTheme);
    }

    if (data?.theme_id && CHART_THEME_COLORS[data.theme_id as ChartPresetTheme]) {
      return getDefaultChartStyling(data.theme_id as ChartPresetTheme);
    }

    return getDefaultChartStyling(CHART_PRESET_THEMES.DEFAULT);
  };

  // Common key aliases for label (category/name) and value (numeric)
  const LABEL_KEYS = ['label', 'name', 'Category', 'Name', 'Label', 'category', 'key', 'Key'];
  const VALUE_KEYS = ['value', 'Value', 'Revenue', 'Amount', 'Count', 'revenue', 'amount', 'count', 'Total'];

  const inferLabelFromPoint = (point: any): string => {
    for (const k of LABEL_KEYS) {
      if (point[k] != null && typeof point[k] === 'string') return String(point[k]);
    }
    for (const [k, v] of Object.entries(point)) {
      if (v != null && typeof v === 'string' && k !== 'metadata') return String(v);
    }
    return '';
  };

  const inferValueFromPoint = (point: any): number => {
    for (const k of VALUE_KEYS) {
      const v = point[k];
      if (typeof v === 'number') return v;
      if (v != null && typeof v === 'string' && !Number.isNaN(parseFloat(v))) return parseFloat(v);
    }
    for (const [k, v] of Object.entries(point)) {
      if (typeof v === 'number') return v;
      if (v != null && typeof v === 'string' && !Number.isNaN(parseFloat(v))) return parseFloat(v);
    }
    return 0;
  };

  const normalizeChartDataPoints = (dataPoints: any[], chartType: string): any[] => {
    // For all chart types, ensure we have label and value keys
    return dataPoints.map(point => ({
      ...point,
      label: point.label ?? point.name ?? inferLabelFromPoint(point),
      value: point.value !== undefined && point.value !== null
        ? (typeof point.value === 'number' ? point.value : parseFloat(String(point.value)) || 0)
        : inferValueFromPoint(point)
    }));
  };

  const normalizeChartDatasets = (datasets: any[], chartType: string, config: any): any[] => {
    if (!Array.isArray(datasets) || datasets.length === 0) return [];

    return datasets.map((dataset: any) => {
      // Handle treemap: convert children array to data array
      if (chartType === 'treemap' && Array.isArray(dataset.children)) {
        return {
          ...dataset,
          data: dataset.children.map((child: any) => ({
            label: child.name || child.label || '',
            value: typeof child.value === 'number' ? child.value : parseFloat(String(child.value)) || 0
          }))
        };
      }

      // Handle radar: convert numeric array to objects with label/value
      if (chartType === 'radar' && Array.isArray(dataset.data)) {
        const labels = config?.labels || [];
        // Check if data is array of numbers (not objects)
        if (dataset.data.length > 0 && typeof dataset.data[0] === 'number') {
          return {
            ...dataset,
            data: dataset.data.map((value: number, index: number) => ({
              label: labels[index] || `Label ${index + 1}`,
              value: typeof value === 'number' ? value : parseFloat(String(value)) || 0
            }))
          };
        }
      }

      // Normalize data points for all chart types that have a data array
      if (Array.isArray(dataset.data)) {
        return {
          ...dataset,
          data: normalizeChartDataPoints(dataset.data, chartType)
        };
      }

      // Default: return dataset as-is
      return dataset;
    });
  };

  const normalizeDashboard = (data: any, overrideId?: string) => {
    if (!data) return null;

    // ── Shortcut: already-normalized data ──────────────────────────────────────
    // When the user saves edits, handleSaveDashboard stores a normalized payload
    // (with a top-level `components` array and a `layout` object) via setProcessedData.
    // If we let the full parser run it would re-build from the raw Morpheus arrays
    // (metrics/charts/tables), completely discarding the applied edits. Detect this
    // case and pass the data straight through instead.
    const nestedDashboardConfig = data.dashboard_config;
    if (nestedDashboardConfig && Array.isArray(nestedDashboardConfig.components) && nestedDashboardConfig.layout) {
      return {
        id: overrideId || nestedDashboardConfig.id || data.id || 'processed_dashboard',
        layout: nestedDashboardConfig.layout,
        components: nestedDashboardConfig.components,
      };
    }

    if (Array.isArray(data.components) && data.layout) {
      return {
        id: overrideId || data.id || 'processed_dashboard',
        layout: data.layout,
        components: data.components,
      };
    }

    // Defensive: a `components` array WITHOUT a `layout` field means a
    // round-trip somewhere stripped one of them — typically the post-save
    // payload. The fall-through path below will rebuild from raw arrays and
    // silently discard edits. Surface this in dev so regressions don't hide.
    if (Array.isArray(data.components) && !data.layout) {
      console.warn(
        '[normalizeDashboard] components present but layout missing — falling back to raw rebuild; saved edits may be lost.',
      );
    }

    const components: any[] = [];
    let componentId = 1;

    // Dashboard-level styling (light theme from backend)
    const dashboardStyling = getDashboardStyling(data);
    const dashboardTile: any = (dashboardStyling as any)?.tile;
    // Dashboard theme always wins — override every component's presetTheme with the dashboard-level value
    const resolvedPresetTheme: string | undefined = (dashboardStyling as any)?.presetTheme;

    // Metrics (Morpheus: name -> title, optional change/trend)
    if (Array.isArray(data.metrics)) {
      data.metrics.forEach((m: any, idx: number) => {
        // Extract numeric value from formatted string
        const numericValue = extractNumericValue(m.value);

        // Extract sparkline data first (needed for time_comparison computation).
        // Prefer the metric's own series; when falling back to a related chart,
        // resolve the dataset by metric title/id instead of blindly using datasets[0].
        let sparklineData: Array<{ label: string, value: number }> | undefined = resolveMetricSparklineData(m, data.charts || []);

        if (!sparklineData) {
          const matchingChart = findMatchingChartForMetric(m.title || m.name, data.charts || []);
          if (matchingChart) {
            sparklineData = extractSparklineData(matchingChart, m);
          }
        }

        // Compute time_comparison if missing
        let timeComparison = m.time_comparison;
        if (!timeComparison && sparklineData && sparklineData.length >= 2) {
          const computed = computeTimeComparisonFromData(sparklineData, numericValue, m.time_comparison?.period);
          if (computed) {
            timeComparison = computed;
          }
        }

        // Derive change and trend from time_comparison or existing logic
        const prev = timeComparison?.previous_value;
        let change: string | number | undefined = m.change;
        let trend: string | undefined = m.trend;

        // Priority 1: Use time_comparison.percentage_change if available
        if (timeComparison?.percentage_change !== undefined && timeComparison.percentage_change !== null) {
          const pct = timeComparison.percentage_change;
          change = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
          trend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable';
        }
        // Priority 2: Compute from time_comparison values if available
        else if (numericValue !== null && typeof prev === 'number' && prev !== 0) {
          const pct = ((numericValue - prev) / prev) * 100;
          change = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
          trend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable';
        }
        // Priority 3: Use provided change/trend if available
        else if (change === undefined || change === null) {
          // Keep change and trend as undefined if we can't compute
        }

        const layout = m?.layout;
        const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);
        // Convert metric styling if it has theme property
        const metricStyling = m.styling ? convertLLMStylingToChartStyling(m.styling) : undefined;
        const validatedMetricStyling = metricStyling && validateChartStyling(metricStyling).isValid
          ? metricStyling
          : (dashboardStyling || getDefaultChartStyling());

        components.push({
          id: `metric_${componentId++}`,
          type: 'metric',
          position: hasLayout
            ? { x: layout.x, y: layout.y, width: layout.w, height: layout.h }
            : { x: (idx % 4) * 3, y: Math.floor(idx / 4) * 2, width: 3, height: 2 },
          layout: hasLayout ? { ...layout } : undefined,
          component_config: {
            id: m.id || `metric_${idx + 1}`,
            title: m.title || m.name || 'Metric',
            value: m.value,
            change,
            trend,
            data: sparklineData,
            dataKey: 'value',
            timeComparison: timeComparison,
            // Convert and merge styling with dashboard defaults
            styling: {
              ...validatedMetricStyling,
              ...(resolvedPresetTheme ? { presetTheme: resolvedPresetTheme } : {}),
              tile: {
                ...(dashboardTile || {}),
                ...((validatedMetricStyling as any)?.tile || {})
              }
            }
          }
        });
      });
    }

    // Charts (Morpheus: chart_type + config axis)
    const typeMap: Record<string, string> = {
      // Direct mappings for current LLM output
      line: 'line',
      bar: 'bar',
      stacked_bar: 'stacked_bar',
      stacked_column: 'stacked_column',
      pie: 'pie',
      area: 'area',
      scatter: 'scatter',
      composed: 'composed',
      radar: 'radar',
      radial_bar: 'radial_bar',
      funnel: 'funnel',
      treemap: 'treemap',
      sankey: 'sankey',
      donut: 'donut',
      geographic: 'geographic',
      table: 'table',
      metric: 'metric',

      // Legacy mappings for backward compatibility
      line_chart: 'line',
      bar_chart: 'bar',
      pie_chart: 'pie',
      area_chart: 'area',
      scatter_chart: 'scatter',
      composed_chart: 'composed',
      radar_chart: 'radar',
      radial_bar_chart: 'radial_bar',
      funnel_chart: 'funnel',
      treemap_chart: 'treemap',
      sankey_chart: 'sankey',
      donut_chart: 'donut'
    };
    if (Array.isArray(data.charts)) {
      data.charts.forEach((c: any, idx: number) => {
        const mappedType = typeMap[(c.chart_type || '').toLowerCase()] || 'line';

        // Handle tables in charts array - they need special processing
        if (mappedType === 'table') {
          const tableStyling = c.styling ? convertLLMStylingToChartStyling(c.styling) : undefined;
          const validatedTableStyling = tableStyling && validateChartStyling(tableStyling).isValid
            ? tableStyling
            : (dashboardStyling || getDefaultChartStyling());

          const layout = c?.layout;
          const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);

          components.push({
            id: `table_${componentId++}`,
            type: 'table',
            position: hasLayout
              ? { x: layout.x, y: layout.y, width: layout.w, height: layout.h }
              : { x: 0, y: Math.floor(idx / 2) * 6 + 6, width: 12, height: 3 },
            layout: hasLayout ? { ...layout } : undefined,
            component_config: {
              id: c.id || `table_${idx + 1}`,
              title: c.title || 'Table',
              description: c.description || '',
              columns: Array.isArray(c.columns) ? c.columns : [],
              data: Array.isArray(c.data) ? c.data : (Array.isArray(c.rows) ? c.rows : []),
              styling: {
                ...validatedTableStyling,
                ...(resolvedPresetTheme ? { presetTheme: resolvedPresetTheme } : {}),
                tile: {
                  ...(dashboardTile || {}),
                  ...((validatedTableStyling as any)?.tile || {})
                }
              }
            }
          });
          return; // Skip chart processing for tables
        }

        // Regular chart processing
        const chartLevelStyling = c.styling ? convertLLMStylingToChartStyling(c.styling) : undefined;
        const validatedChartStyling = chartLevelStyling && validateChartStyling(chartLevelStyling).isValid
          ? chartLevelStyling
          : (dashboardStyling || getDefaultChartStyling());
        // merge dashboard tile defaults; dashboard presetTheme always wins
        const mergedChartStyling: any = {
          ...validatedChartStyling,
          ...(resolvedPresetTheme ? { presetTheme: resolvedPresetTheme } : {}),
          tile: {
            ...(dashboardTile || {}),
            ...((chartLevelStyling as any)?.tile || {})
          }
        };

        const layout = c?.layout;
        const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);

        // Normalize datasets based on chart type
        const normalizedDatasets = Array.isArray(c.datasets)
          ? normalizeChartDatasets(c.datasets, mappedType, c.config || {})
          : [];

        components.push({
          id: `chart_${componentId++}`,
          type: 'chart',
          position: hasLayout
            ? { x: layout.x, y: layout.y, width: layout.w, height: layout.h }
            : { x: (idx % 2) * 6, y: Math.floor(idx / 2) * 4 + 2, width: 6, height: 4 },
          layout: hasLayout ? { ...layout } : undefined,
          component_config: {
            id: c.id || `chart_${idx + 1}`,
            type: mappedType,
            title: c.title || 'Chart',
            description: c.description || '',
            insight: c.reasoning?.insight || '',
            axisConfig: c.config || { xKey: 'label', yKey: 'value' },
            datasets: normalizedDatasets,
            data: c.data,
            config: c.config || {},
            styling: mergedChartStyling
          }
        });
      });
    }

    // Tables (Morpheus: columns string[] + rows objects)
    // Check both top-level and nested data.tables
    const tablesToProcess = Array.isArray(data.tables) ? data.tables :
      (data.data && Array.isArray(data.data.tables)) ? data.data.tables : [];

    if (tablesToProcess.length > 0) {
      tablesToProcess.forEach((t: any, idx: number) => {
        const layout = t?.layout;
        const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);
        // Convert table styling if it has theme property
        const tableStyling = t.styling ? convertLLMStylingToChartStyling(t.styling) : undefined;
        const validatedTableStyling = tableStyling && validateChartStyling(tableStyling).isValid
          ? tableStyling
          : (dashboardStyling || getDefaultChartStyling());

        components.push({
          id: `table_${componentId++}`,
          type: 'table',
          position: hasLayout
            ? { x: layout.x, y: layout.y, width: layout.w, height: layout.h }
            : { x: 0, y: Math.floor(idx / 2) * 6 + 6, width: 12, height: 3 },
          layout: hasLayout ? { ...layout } : undefined,
          component_config: {
            id: t.id || `table_${idx + 1}`,
            title: t.title || 'Table',
            description: t.description || '',
            columns: Array.isArray(t.columns) ? t.columns : [],
            data: Array.isArray(t.data) ? t.data : (Array.isArray(t.rows) ? t.rows : []),
            // Convert and merge styling with dashboard defaults; dashboard presetTheme always wins
            styling: {
              ...validatedTableStyling,
              ...(resolvedPresetTheme ? { presetTheme: resolvedPresetTheme } : {}),
              tile: {
                ...(dashboardTile || {}),
                ...((validatedTableStyling as any)?.tile || {})
              }
            }
          }
        });
      });
    }

    const gridColumns = data?.layout?.recommended_grid?.length ? 12 : 12;
    const dashboardConfig = {
      id: overrideId || 'processed_dashboard',
      layout: { type: 'grid', grid_columns: gridColumns, grid_rows: 20 },
      components
    };
    return dashboardConfig;
  };

  // Apply dashboard-level styling to container
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dashboardStylingForContainer = useMemo(() => getDashboardStyling(processedData), [processedData, selectedTheme, isThemePending]);

  const effectiveStyling = useMemo(() => {
    const base = dashboardStylingForContainer || getDefaultChartStyling();
    // Static config preview (template gallery) — derive theme from config components
    if (staticConfig && !processedData) {
      const configTheme = (staticConfig.components[0]?.component_config as any)?.styling?.presetTheme;
      if (configTheme && CHART_THEME_COLORS[configTheme as ChartPresetTheme]) {
        return getDefaultChartStyling(configTheme as ChartPresetTheme);
      }
    }
    return base;
  }, [dashboardStylingForContainer, staticConfig, processedData]);

  const effectiveTheme = useMemo(() => {
    const theme = effectiveStyling?.presetTheme as ChartPresetTheme | undefined;
    return theme && CHART_THEME_COLORS[theme] ? theme : CHART_PRESET_THEMES.DEFAULT;
  }, [effectiveStyling]);

  const premiumDashboardVars = useMemo(() => buildPremiumDashboardVars(effectiveTheme), [effectiveTheme]);
  const isLightDashboardTheme = isLightBackground(effectiveTheme);

  useEffect(() => {
    if (containerRef.current && effectiveStyling) {
      applyChartStyling(containerRef.current, effectiveStyling);
    }
  }, [effectiveStyling]);

  // Filter processedData by date range
  const rawDataForDateRange = useMemo(() => {
    return processedData || (configuration && !configuration.components ? configuration : null);
  }, [processedData, configuration]);

  const sourceDateRangeBounds = useMemo(() => {
    const data = rawDataForDateRange;
    if (!data || !Array.isArray(data.charts)) return undefined;

    let min: Date | undefined;
    let max: Date | undefined;

    for (const chart of data.charts) {
      if (!Array.isArray(chart?.datasets)) continue;
      for (const dataset of chart.datasets) {
        if (!Array.isArray(dataset?.data)) continue;
        for (const item of dataset.data) {
          const rawLabel = item?.label ?? item?.name;
          if (rawLabel == null) continue;
          const parsed = parseDateLabel(String(rawLabel));
          if (!parsed) continue;
          if (!min || parsed < min) min = parsed;
          if (!max || parsed > max) max = parsed;
        }
      }
    }

    if (!min || !max) return undefined;
    return { from: min, to: max };
  }, [rawDataForDateRange]);

  useEffect(() => {
    if (datePreset === "custom") return;
    if (datePreset === "full_range") {
      setDateRange(sourceDateRangeBounds);
      return;
    }
    setDateRange(getPresetRange(datePreset));
  }, [datePreset, sourceDateRangeBounds]);

  const filteredProcessedData = useMemo(() => {
    const dataToFilter = rawDataForDateRange;
    if (!dataToFilter) return null;
    if (!shouldApplyDashboardDateRange(datePreset, dateRange)) return dataToFilter;
    return filterDataByDateRange(dataToFilter, dateRange);
  }, [rawDataForDateRange, datePreset, dateRange]);

  // Grid layout config
  const ResponsiveGridLayout = useMemo(() => WidthProvider(Responsive), []);
  const breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
  const cols = GRID_COLS;
  const margin: [number, number] = [6, 6];
  const containerPadding: [number, number] = [6, 6];
  const rowHeight = 30;

  // Build normalized dashboards and active selection
  const normalizedProcessed = filteredProcessedData
    ? normalizeDashboard(filteredProcessedData, dashboardId)
    : null;
  const activeDashboard = useMemo(() => {
    if (normalizedProcessed) return normalizedProcessed;
    if (configuration && configuration.components) return configuration as any;
    return null;
  }, [normalizedProcessed, configuration]);

  const displayComponents = useMemo(() => {
    if (!activeDashboard?.components) return [];
    // Static config already has theme applied per-component via applyVisualSpec — don't override
    const base = (staticConfig && !processedData)
      ? activeDashboard.components
      : (() => {
          const theme = effectiveStyling?.presetTheme;
          if (!theme) return activeDashboard.components;
          // Derive a fresh palette from the current theme so stored palettes from old/different
          // themes (e.g. light-gray colors from the old dark default) don't become invisible.
          const palette = getColorPalette(theme as ChartPresetTheme, 10);
          return activeDashboard.components.map((comp: any) => ({
            ...comp,
            component_config: {
              ...comp.component_config,
              styling: {
                ...comp.component_config?.styling,
                presetTheme: theme,
                colorPalette: palette,
              }
            }
          }));
        })();
    return base.filter((c: any) => !removedComponentIds.has(String(c.id)));
  }, [activeDashboard?.components, effectiveStyling, staticConfig, processedData, removedComponentIds]);

  // Edits-feature: hydrate edits store when a dashboard becomes available, and
  // apply deltas to the components so renderers see the merged config.
  const editsDashboardId = useMemo(() => {
    const baseId = activeDashboard?.id || 'processed_dashboard';
    const suffix = (baseId === 'processed_dashboard' && projectId) ? `_${projectId}` : '';
    return `${baseId}${suffix}`;
  }, [activeDashboard?.id, projectId]);

  useEffect(() => {
    if (!activeDashboard) return;
    void hydrateEdits(editsDashboardId);
  }, [activeDashboard, editsDashboardId, hydrateEdits]);

  const editedDisplayComponents = useMemo(() => {
    if (!editsState) return displayComponents;
    return applyEditsToComponents(displayComponents as any, editsState) as any[];
  }, [displayComponents, editsState]);

  // Notify parent whenever the final edits-applied component list (or the underlying
  // activeDashboard metadata) changes. project.tsx uses this to build the save payload.
  useEffect(() => {
    if (onEditedComponentsChange) {
      onEditedComponentsChange(editedDisplayComponents, activeDashboard ?? null);
    }
  }, [editedDisplayComponents, activeDashboard, onEditedComponentsChange]);

  // Edit mode is allowed only on owned/processed dashboards (showCardActionsMenu is the
  // existing signal for "user has authorship" — public exports keep showCardActionsMenu false).
  const canEdit = !!showCardActionsMenu && !isExporting;

  // Helpers to build layouts per component list. The pure logic lives in
  // dashboardLayout.ts so it can be unit-tested without rendering the grid.
  const getMinSizeForType = getMinSizeForTypePure;

  const componentsToBaseLayout = (components: any[]): Layout[] => {
    const rawLayout = components.map((c: any, index: number) => {
      const typeMin = getMinSizeForType(c.type);
      const src = getComponentLayoutFrame(c, index);
      let x = src.x;
      const y = src.y;
      let w = src.w;
      // R5: when the dashboard is sparse, widen the sole non-metric to span
      // the full 24-col grid so it doesn't render pinned to a corner.
      if (shouldFillSparse(components, c.type)) {
        w = 24;
        x = 0;
      }

      // Calculate dynamic height for tables if not explicitly provided
      let h = src.h;

      if (c.type === 'table' && c.component_config?.data) {
        const rowCount = Array.isArray(c.component_config.data) ? c.component_config.data.length : 0;
        if (rowCount > 0) {
          // Base overhead (header, title, padding) ~ 6 units
          // Each row ~ 1.5 units
          // Cap at 21 (approx 10 rows)
          const calculatedH = Math.ceil(6 + (Math.min(rowCount, 10) * 1.5));
          // Use calculated height if it's larger than provided height, or if no height provided
          // This ensures we show up to 10 rows by default while respecting larger user overrides if they exist
          h = Math.max(h, calculatedH);
        }
      }

      // Final clamp against the type floor. The backend can (and historically has)
      // shipped layouts with h<minH or minH=1, which would render as 30px slivers
      // — the canonical "stretched chart" bug. Route every backend-payload item
      // through the same clamp the localStorage path uses so F5 alone heals the
      // dashboard, no regeneration needed.
      const clamped = clampLayoutItem(
        { w, h, minW: Number.isFinite(src.minW) ? src.minW : typeMin.minW, minH: Number.isFinite(src.minH) ? src.minH : typeMin.minH },
        typeMin,
      );
      return { i: String(c.id), x, y, w: clamped.w, h: clamped.h, minW: clamped.minW, minH: clamped.minH, static: false } as Layout;
    });
    return sanitizeLayoutItems(rawLayout, buildMinSizeMap(components), cols.lg);
  };

  const scaleLayoutForCols = (layout: Layout[], fromCols: number, toCols: number): Layout[] => {
    const scaled = layout.map((item) => {
      const scaledW = Math.max(1, Math.round((item.w * toCols) / fromCols));
      let scaledX = Math.round((item.x * toCols) / fromCols);
      // clamp to ensure the item fits within the target column count
      if (scaledX + scaledW > toCols) {
        scaledX = Math.max(0, toCols - scaledW);
      }
      const scaledMinW = item.minW ? Math.max(1, Math.round((item.minW * toCols) / fromCols)) : item.minW;
      // Heights don't depend on cols, but enforce minH so a saved item with h<minH
      // (the "stretched vertical strip" pattern) cannot survive a breakpoint rescale.
      const minH = item.minH;
      const h = minH && Number.isFinite(minH) ? Math.max(item.h, minH) : item.h;
      const w = scaledMinW && Number.isFinite(scaledMinW) ? Math.max(scaledW, scaledMinW) : scaledW;
      return { ...item, x: scaledX, w, h, minW: scaledMinW } as Layout;
    });
    const minSizeById = new Map(
      scaled.map((item) => [
        item.i,
        {
          minW: Number.isFinite(item.minW) ? Number(item.minW) : 1,
          minH: Number.isFinite(item.minH) ? Number(item.minH) : 1,
        },
      ]),
    );
    return sanitizeLayoutItems(scaled, minSizeById, toCols);
  };

  const reformatLayoutForExport = (layout: Layout[]): { reformatted: Layout[], didSplit: boolean } => {
    // Logic for splitting into 2 columns has been removed.
    // Return original layout as a single vertical column.
    return { reformatted: layout, didSplit: false };
  };

  const buildLayoutsFromComponents = (components: any[] | undefined | null, isExportingMode: boolean): { layouts: Layouts, didSplit: boolean } => {
    let baseLg = components ? componentsToBaseLayout(components) : [];
    let didSplit = false;

    if (isExportingMode) {
      const result = reformatLayoutForExport(baseLg);
      baseLg = result.reformatted;
      didSplit = result.didSplit;
    }

    baseLg = sanitizeLayoutItems(compactLayoutVertically(baseLg), buildMinSizeMap((components || []) as any[]), cols.lg);

    return {
      layouts: {
        lg: baseLg,
        md: compactLayoutVertically(scaleLayoutForCols(baseLg, 24, 12)),
        sm: compactLayoutVertically(scaleLayoutForCols(baseLg, 24, 8)),
        xs: compactLayoutVertically(scaleLayoutForCols(baseLg, 24, 4)),
        xxs: compactLayoutVertically(scaleLayoutForCols(baseLg, 24, 2))
      } as Layouts,
      didSplit
    };
  };

  // Bump version when grid behavior changes (e.g. compactType) so we don't reuse
  // layouts saved under older compaction logic.
  const storageKey = useMemo(
    () => computeStorageKey(activeDashboard?.id, activeDashboard?.components, projectId),
    [activeDashboard?.id, activeDashboard?.components, projectId],
  );
  const layoutComponentKey = useMemo(() => {
    if (!activeDashboard?.components) return "none";
    const componentKey = activeDashboard.components
      .map((component: { id?: unknown; type?: unknown }) => `${String(component.id)}:${String(component.type)}`)
      .join("|");
    return `${activeDashboard?.id || "processed_dashboard"}:${componentKey}`;
  }, [activeDashboard?.id, activeDashboard?.components]);

  const [layouts, setLayouts] = useState<Layouts>({ lg: [], md: [], sm: [], xs: [], xxs: [] });
  const layoutsRef = useRef<Layouts>({ lg: [], md: [], sm: [], xs: [], xxs: [] });
  const userLayoutCommitRef = useRef<{ storageKey: string; layoutComponentKey: string; layouts: Layouts; expiresAt: number } | null>(null);
  const [isLayoutReady, setIsLayoutReady] = useState(false);

  // Synchronous guard: does the current lg layout contain an entry for every
  // component we are about to render? On a dashboard switch the components
  // update synchronously while `layouts` is rebuilt asynchronously in the effect
  // below, so for one render the stale layout lacks the new ids. Mounting the
  // grid then makes react-grid-layout assign fallback w=1/h=1 (the stretched
  // sliver bug) and even persist that garbage via onLayoutChange. Gating the
  // render and the persistence handlers on this skips that frame entirely.
  const layoutsCoverCurrent = layoutsCoverComponents(
    layouts.lg,
    editedDisplayComponents as Array<{ id: string | number }>,
  );

  useEffect(() => {
    layoutsRef.current = layouts;
  }, [layouts]);

  // Initialize or update layouts when active dashboard changes
  useEffect(() => {
    const pendingUserLayout = userLayoutCommitRef.current;
    if (
      pendingUserLayout &&
      pendingUserLayout.storageKey === storageKey &&
      pendingUserLayout.layoutComponentKey === layoutComponentKey &&
      Date.now() < pendingUserLayout.expiresAt
    ) {
      layoutsRef.current = pendingUserLayout.layouts;
      setLayouts(pendingUserLayout.layouts);
      setIsLayoutReady(true);
      return;
    }

    setIsLayoutReady(false);
    if (!activeDashboard) {
      const emptyLayouts: Layouts = { lg: [], md: [], sm: [], xs: [], xxs: [] };
      layoutsRef.current = emptyLayouts;
      setLayouts(emptyLayouts);
      return;
    }

    const initialResult = buildLayoutsFromComponents(activeDashboard.components, isExporting);

    // Skip local storage layouts entirely if exporting to force our reflow layout
    if (isExporting) {
      layoutsRef.current = initialResult.layouts;
      setLayouts(initialResult.layouts);
      if (onExportLayoutChange) {
        onExportLayoutChange(initialResult.didSplit);
      }
      setIsLayoutReady(true);
      return;
    }

    // R6: when LAYOUT_SOURCE is "s3", the `position` field on each component
    // (loaded from the dashboard JSON on S3) is the source of truth. We do NOT
    // read localStorage at all — instead we always build from componentsToBaseLayout
    // (below) which already honours each component's position/layout fields.
    //
    // In legacy "localstorage" mode we try the saved layout first, falling
    // back to the backend payload when it doesn't match.
    if (LAYOUT_SOURCE === "localstorage" && !disablePersistence) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as Layouts;
          const { layouts: sanitized, fullyCovered } = sanitizeLayouts(
            parsed,
            activeDashboard.components,
          );
          if (fullyCovered) {
            layoutsRef.current = sanitized;
            setLayouts(sanitized);
            setIsLayoutReady(true);
            return;
          }
        }
      } catch (_e) {
        // ignore parse errors and fall back to initial
      }
    }

    // Default to the backend's generated layout if storage fails or layout is deemed invalidated.
    layoutsRef.current = initialResult.layouts;
    setLayouts(initialResult.layouts);
    setIsLayoutReady(true);
  // buildLayoutsFromComponents is a render-local pure helper. Listing it would
  // retrigger this state-initialization effect on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDashboard, storageKey, layoutComponentKey, isExporting, disablePersistence, onExportLayoutChange]);

  // R6: one-time legacy cache eviction. Every existing user has a corrupted
  // `dashboard_layout_*` localStorage entry that keeps bleeding the stretched
  // chart back on F5. Now that S3 is authoritative, evict the stale entry on
  // first render so users don't have to clear cache manually.
  useEffect(() => {
    if (LAYOUT_SOURCE !== "s3") return;
    if (disablePersistence) return;
    try {
      localStorage.removeItem(storageKey);
    } catch (_e) {
      // private mode / quota — safe to ignore
    }
  }, [storageKey, disablePersistence]);

  // Sliver telemetry. After the grid mounts, measure every rendered grid item
  // and warn (dev) / track (prod) when any chart/table cell renders smaller
  // than its minimum legible size. This is the canary that fires when stale
  // localStorage, an RGL cache miss, or a width-0 mount sneaks the
  // "stretched chart" bug back in — even when the backend data is fine.
  useEffect(() => {
    if (!isLayoutReady || !activeDashboard || isExporting) return;
    const id = window.setTimeout(() => {
      const items = document.querySelectorAll<HTMLElement>(".react-grid-item");
      const slivers: Array<{ id: string; w: number; h: number }> = [];
      items.forEach((el) => {
        const r = el.getBoundingClientRect();
        // Charts/tables should be at least 40px tall after minH clamp. Metrics
        // can legitimately be ~60px tall, so apply a lower floor.
        const tooShort = r.height < 40;
        const tooNarrow = r.width < 60;
        if (tooShort || tooNarrow) {
          slivers.push({ id: el.getAttribute("data-grid-id") || el.className, w: r.width, h: r.height });
        }
      });
      if (slivers.length > 0) {
        console.warn(
          "[DashboardPreview] sliver layout detected — chart/table rendered below minimum size.",
          { storageKey, dashboardId: activeDashboard?.id, slivers },
        );
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [isLayoutReady, layouts, activeDashboard, isExporting, storageKey]);

  const currentBreakpointRef = useRef<string>('lg');

  const handleLayoutChange = (current: Layout[], all: Layouts) => {
    if (!isLayoutReady) return;
    // Never commit a layout produced while the grid's layout didn't cover the
    // current components (transitional switch frame) — it would persist the
    // stretched fallback sizes over the correct layout.
    if (!layoutsCoverCurrent) return;
    const activeBreakpoint = currentBreakpointRef.current as keyof typeof cols;
    const compactedCurrent = sanitizeLayoutItems(
      compactLayoutVertically(current),
      buildMinSizeMapForCols(editedDisplayComponents as any[], cols[activeBreakpoint] || cols.lg),
      cols[activeBreakpoint] || cols.lg,
    );
    const compactedAll = compactLayoutsVertically({
      ...all,
      [activeBreakpoint]: compactedCurrent,
    });
    const { layouts: sanitizedAll } = sanitizeLayouts(
      compactedAll,
      editedDisplayComponents as any[],
    );
    layoutsRef.current = sanitizedAll;
    setLayouts(sanitizedAll);
    // Persist per dashboard id (skipped for ephemeral previews and for s3 mode,
    // which persists via the debounced S3 push fired from handleDragResizeStop).
    if (LAYOUT_SOURCE === "localstorage" && !disablePersistence) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(sanitizedAll));
      } catch (_e) { /* ignore */ }
    }

    // Sync back to dashboard state only when using real configuration
    if (!processedData && dashboardState.configuration && updateComponent) {
      const byId = new Map(compactedCurrent.map((item) => [item.i, item]));
      dashboardState.configuration.components.forEach((comp) => {
        const l = byId.get(String(comp.id));
        if (l) {
          updateComponent(comp.id, { position: { x: l.x, y: l.y, width: l.w, height: l.h, minW: l.minW, minH: l.minH } });
        }
      });
    }
  };

  const handleDragResizeStop = (current: Layout[], oldItem: any, newItem: any) => {
    if (!isLayoutReady) return;
    if (!layoutsCoverCurrent) return;
    const activeBreakpoint = currentBreakpointRef.current as keyof typeof cols;
    const currentCols = cols[activeBreakpoint] || 24;
    const scaledAll = { ...layoutsRef.current };
    const compactedCurrent = sanitizeLayoutItems(
      compactLayoutVertically(current),
      buildMinSizeMapForCols(editedDisplayComponents as any[], currentCols),
      currentCols,
    );

    scaledAll.lg = activeBreakpoint === 'lg' ? compactedCurrent : compactLayoutVertically(scaleLayoutForCols(compactedCurrent, currentCols, cols.lg));
    scaledAll.md = activeBreakpoint === 'md' ? compactedCurrent : compactLayoutVertically(scaleLayoutForCols(compactedCurrent, currentCols, cols.md));
    scaledAll.sm = activeBreakpoint === 'sm' ? compactedCurrent : compactLayoutVertically(scaleLayoutForCols(compactedCurrent, currentCols, cols.sm));
    scaledAll.xs = activeBreakpoint === 'xs' ? compactedCurrent : compactLayoutVertically(scaleLayoutForCols(compactedCurrent, currentCols, cols.xs));
    scaledAll.xxs = activeBreakpoint === 'xxs' ? compactedCurrent : compactLayoutVertically(scaleLayoutForCols(compactedCurrent, currentCols, cols.xxs));

    const { layouts: sanitizedScaledAll } = sanitizeLayouts(
      scaledAll,
      editedDisplayComponents as any[],
    );

    layoutsRef.current = sanitizedScaledAll;
    userLayoutCommitRef.current = {
      storageKey,
      layoutComponentKey,
      layouts: sanitizedScaledAll,
      expiresAt: Date.now() + 5000,
    };
    setLayouts(sanitizedScaledAll);
    if (LAYOUT_SOURCE === "localstorage" && !disablePersistence) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(sanitizedScaledAll));
      } catch (_e) { /* ignore */ }
    }
    // R6: debounced S3 persistence runs in the parent. We hand it the
    // edits-applied components merged with the new layout positions so the
    // dashboard JSON on S3 always reflects what the user just did.
    if (LAYOUT_SOURCE === "s3" && !disablePersistence && onLayoutPersist) {
      const lgLayout = sanitizedScaledAll.lg || current;
      const mergedForS3 = mergeLayoutIntoComponents(editedDisplayComponents as any[], lgLayout);
      onLayoutPersist(mergedForS3);
    }
  };

  const handleBreakpointChange = (newBreakpoint: string) => {
    currentBreakpointRef.current = newBreakpoint;
  };

  useEffect(() => {
    if (!onEditedComponentsChange || !activeDashboard || !isLayoutReady) return;
    const layoutMergedComponents = mergeLayoutIntoComponents(editedDisplayComponents as any[], layouts.lg);
    onEditedComponentsChange(layoutMergedComponents, activeDashboard ?? null);
  }, [activeDashboard, editedDisplayComponents, isLayoutReady, layouts.lg, onEditedComponentsChange]);

  // Handle refresh
  const handleRefresh = async () => {
    if (dashboardState.configuration) {
      await refreshDashboard({
        dashboard_id: dashboardState.configuration.id,
        force_refresh: true
      });
    } else {
      // Regenerate dashboard
      const request: DashboardGenerationRequest = {
        data_source: dataSource ?? "uploaded-data",
        layout_preference: LayoutType.GRID,
        chart_types: [ChartType.LINE, ChartType.BAR, ChartType.METRIC, ChartType.TABLE, ChartType.GEOGRAPHIC],
        metadata: {
          title: "eCommerce Sales Dashboard",
        }
      };
      generateDashboard(request);
    }
  };

  // Handle component refresh
  const handleComponentRefresh = async (componentId: string) => {
    if (dashboardState.configuration) {
      await refreshDashboard({
        dashboard_id: dashboardState.configuration.id,
        force_refresh: true
      });
    }
  };

  // Handle component error
  // Stable identity so the memoized ChartRenderer isn't invalidated every render.
  const handleComponentError = useCallback((error: Error, component: any) => {
    console.error('Chart component error:', error, component);
  }, []);

  // Extract dashboard metadata (handle both nested and top-level dashboard object)
  const dashboardMetadata = useMemo(() => {
    // Try top-level first (correct structure)
    if (processedData?.dashboard) {
      return {
        title: processedData.dashboard.title,
        description: processedData.dashboard.description,
        styling: processedData.dashboard.styling,
        insights: processedData.insights || []
      };
    }
    // Fallback to nested structure (if backend wraps it)
    if (processedData?.data?.dashboard) {
      return {
        title: processedData.data.dashboard.title,
        description: processedData.data.dashboard.description,
        styling: processedData.data.dashboard.styling,
        insights: processedData.data.insights || processedData.insights || []
      };
    }
    return null;
  }, [processedData]);

  return (
    <div
      ref={containerRef}
      id={isExporting ? "dashboard-export-inner-root" : "dashboard-preview-root"}
      data-dashboard-root
      className={`h-full overflow-y-auto relative chat-scrollbar-hide ${getChartStylingClasses(effectiveStyling || getDefaultChartStyling())} ${className}`}
      style={{
        ...style,
        ...getDashboardBackgroundStyle(effectiveStyling || getDefaultChartStyling()),
        ...premiumDashboardVars
      }}
      data-theme="dashboard-preview"
    >
      {/* Dashboard Header with Title and Description */}
      {dashboardMetadata && (
        <div className="px-6 pt-6 pb-4" style={{ borderColor: 'var(--border-card-color)' }}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex-1 w-full">
                <h1
                  className="text-2xl md:text-3xl font-bold"
                  style={{ color: 'var(--highlight-color)' }}
                >
                  {dashboardMetadata.title}
                </h1>
                {dashboardMetadata.description && (
                  <p
                    className="text-sm md:text-base opacity-90 mt-1"
                    style={{ color: 'var(--description-color)' }}
                  >
                    {dashboardMetadata.description}
                  </p>
                )}
              </div>
              <div className="relative flex w-full flex-shrink-0 items-center justify-start gap-2 overflow-visible pb-1 md:w-auto md:pb-0">
                {!isExporting && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-9 flex-shrink-0 items-center justify-start gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
                        style={{
                          color: "var(--highlight-color)",
                          backgroundColor: "var(--bg-card-color)",
                          borderColor: "var(--border-card-color)",
                        }}
                      >
                        <CalendarDays className="h-4 w-4" />
                        <span>Date Range</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[280px] z-[201] p-3 space-y-3"
                      align="end"
                      style={{
                        "--dashboard-title": premiumDashboardVars["--dashboard-title"],
                        "--dashboard-muted": premiumDashboardVars["--dashboard-muted"],
                        "--dashboard-card-border": premiumDashboardVars["--dashboard-card-border"],
                        "--dashboard-popover-bg": premiumDashboardVars["--dashboard-popover-bg"],
                        backgroundColor: premiumDashboardVars["--dashboard-popover-bg"],
                        color: premiumDashboardVars["--dashboard-title"],
                        borderColor: premiumDashboardVars["--dashboard-card-border"],
                      } as React.CSSProperties}
                    >
                      <div className="space-y-1">
                        <label className="text-xs font-medium" style={{ color: premiumDashboardVars["--dashboard-muted"] }}>Range preset</label>
                        <Select
                          value={datePreset}
                          onValueChange={(value) => {
                            setDatePreset(value);
                            if (value === "custom") {
                              setDateRange(undefined);
                            }
                          }}
                        >
                          <SelectTrigger
                            className="h-9"
                            style={{
                              color: premiumDashboardVars["--dashboard-title"],
                              backgroundColor: premiumDashboardVars["--dashboard-popover-bg"],
                              borderColor: premiumDashboardVars["--dashboard-card-border"],
                            }}
                          >
                            <SelectValue placeholder="Select date range" />
                          </SelectTrigger>
                          <SelectContent
                            className="z-[202]"
                            style={{
                              "--accent": hexToHslValues(CHART_THEME_COLORS[effectiveTheme]?.["highlight-color"]),
                              "--accent-foreground": hexToHslValues(CHART_THEME_COLORS[effectiveTheme]?.["bg-card-color"]),
                              backgroundColor: premiumDashboardVars["--dashboard-popover-bg"],
                              color: premiumDashboardVars["--dashboard-title"],
                              borderColor: premiumDashboardVars["--dashboard-card-border"],
                            } as React.CSSProperties}
                          >
                            {DATE_PRESETS.map((preset) => (
                              <SelectItem key={preset.value} value={preset.value}>
                                {preset.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {datePreset === "custom" && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-xs font-medium" style={{ color: premiumDashboardVars["--dashboard-muted"] }}>Start</label>
                            <div className="relative">
                              <input
                                type="date"
                                value={dateRange?.from ? dateRange.from.toISOString().split("T")[0] : ""}
                                onChange={(e) => {
                                  const nextFrom = e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined;
                                  setDateRange((prev) => ({ from: nextFrom, to: prev?.to }));
                                }}
                                className="date-input-themed w-full h-9 px-2 pr-9 rounded-md border text-sm"
                                style={{
                                  color: premiumDashboardVars["--dashboard-title"],
                                  backgroundColor: premiumDashboardVars["--dashboard-popover-bg"],
                                  borderColor: premiumDashboardVars["--dashboard-card-border"],
                                }}
                              />
                              <CalendarDays className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: premiumDashboardVars["--dashboard-muted"] }} />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium" style={{ color: premiumDashboardVars["--dashboard-muted"] }}>End</label>
                            <div className="relative">
                              <input
                                type="date"
                                value={dateRange?.to ? dateRange.to.toISOString().split("T")[0] : ""}
                                onChange={(e) => {
                                  const nextTo = e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined;
                                  setDateRange((prev) => ({ from: prev?.from, to: nextTo }));
                                }}
                                className="date-input-themed w-full h-9 px-2 pr-9 rounded-md border text-sm"
                                style={{
                                  color: premiumDashboardVars["--dashboard-title"],
                                  backgroundColor: premiumDashboardVars["--dashboard-popover-bg"],
                                  borderColor: premiumDashboardVars["--dashboard-card-border"],
                                }}
                              />
                              <CalendarDays className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: premiumDashboardVars["--dashboard-muted"] }} />
                            </div>
                          </div>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                )}
                {!isExporting && dashboardMetadata.insights && dashboardMetadata.insights.length > 0 && (
                  <button
                    onClick={() => setExpandedInsights(!expandedInsights)}
                    className="flex h-9 flex-shrink-0 items-center justify-start gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-[var(--dashboard-control-hover)]"
                    style={{
                      color: 'var(--highlight-color)',
                      backgroundColor: 'var(--bg-card-color)',
                      borderColor: 'var(--border-card-color)'
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">Insights</span>
                    <span
                      className="hidden rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none sm:inline-flex"
                      style={{
                        backgroundColor: "var(--dashboard-accent-soft)",
                        color: "var(--title-color)",
                      }}
                    >
                      {dashboardMetadata.insights.length}
                    </span>
                    {expandedInsights ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                )}
                {!isExporting && expandedInsights && dashboardMetadata.insights && dashboardMetadata.insights.length > 0 && (
                  <div
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[min(540px,calc(100vw-3rem))] overflow-hidden rounded-xl border p-2.5 backdrop-blur-xl"
                    style={{
                      backgroundColor: "var(--dashboard-popover-bg)",
                      borderColor: "var(--dashboard-accent-ring)",
                      boxShadow: "var(--dashboard-card-shadow)",
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3 px-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--highlight-color)" }} />
                        <h2
                          className="truncate text-sm font-semibold"
                          style={{ color: "var(--title-color)" }}
                        >
                          Key signals
                        </h2>
                      </div>
                      <span
                        className="shrink-0 text-[11px] font-medium"
                        style={{ color: "var(--description-color)" }}
                      >
                        {dashboardMetadata.insights.length} insight{dashboardMetadata.insights.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {dashboardMetadata.insights.map((insight: string, index: number) => (
                        <li
                          key={index}
                          className="flex min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5"
                        >
                          <span
                            className="mt-0.5 inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums"
                            style={{
                              backgroundColor: "var(--dashboard-accent-soft)",
                              color: "var(--highlight-color)",
                            }}
                          >
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className="min-w-0 text-[13px] leading-5"
                            style={{ color: "var(--title-color)" }}
                          >
                            {insight}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {dashboardMetadata?.insights && dashboardMetadata.insights.length > 0 && isExporting && (
              <div
                className="relative mt-2 w-full max-w-[980px] overflow-hidden rounded-lg border px-3 py-2.5"
                style={{
                  background: "linear-gradient(135deg, var(--dashboard-accent-soft), transparent 78%)",
                  borderColor: "var(--dashboard-accent-ring)",
                }}
              >
                <span
                  className="absolute bottom-3 left-0 top-3 w-px rounded-full"
                  style={{ backgroundColor: "var(--highlight-color)", opacity: 0.5 }}
                  aria-hidden="true"
                />
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--highlight-color)" }} />
                    <h2
                      className="truncate text-sm font-semibold"
                      style={{ color: 'var(--title-color)' }}
                    >
                      Key signals
                    </h2>
                  </div>
                  <span
                    className="shrink-0 text-[11px] font-medium"
                    style={{ color: 'var(--description-color)' }}
                  >
                    {dashboardMetadata.insights.length} insight{dashboardMetadata.insights.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="space-y-1">
                  {dashboardMetadata.insights.map((insight: string, index: number) => (
                    <li
                      key={index}
                      className="flex min-w-0 items-start gap-2.5 rounded-md px-1 py-0.5"
                    >
                      <span
                        className="mt-px w-5 shrink-0 text-[10px] font-semibold leading-5 tabular-nums"
                        style={{ color: 'var(--highlight-color)' }}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className="min-w-0 text-[13px] leading-5"
                        style={{ color: 'var(--title-color)' }}
                      >
                        {insight}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}


      {/* Main Dashboard Content */}
      <div className="p-4 sm:p-6">
        {/* Loading State */}
        {dashboardState.loading && !dashboardState.configuration && (
          <div className="flex h-64 items-center justify-center">
            <div className="space-y-4 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: "var(--dashboard-accent)" }} />
              <p style={{ color: "var(--dashboard-muted)" }}>Generating dashboard...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {dashboardState.error && !dashboardState.configuration && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {dashboardState.error}
            </AlertDescription>
          </Alert>
        )}

        {/* Responsive Drag & Resize Grid */}
        {activeDashboard && isLayoutReady && layoutsCoverCurrent && (
          <div className="space-y-6">
            {isExporting ? (
              <Responsive
                className="layout"
                layouts={layouts}
                breakpoints={breakpoints}
                cols={{ lg: 24, md: 24, sm: 24, xs: 24, xxs: 24 }} // Force a 24-col grid for a single vertical page
                margin={margin}
                containerPadding={containerPadding}
                rowHeight={rowHeight}
                width={typeof window !== 'undefined' ? Math.max(window.innerWidth, 1200) : 1200} // Single screen width
                isDraggable={false}
                isResizable={false}
                preventCollision
                isBounded
                compactType={null}
              >
                {editedDisplayComponents.map((component: DashboardComponent) => (
                  <div key={String(component.id)} className="animate-fade-in">
                    <div
                      className="h-full min-h-0 overflow-hidden rounded-lg border"
                      style={{
                        backgroundColor: "var(--dashboard-card-bg)",
                        borderColor: "var(--dashboard-card-border)",
                        boxShadow: "var(--dashboard-card-shadow)",
                      }}
                    >
                    <ChartRenderer
                      component={component}
                      onError={handleComponentError}
                    />
                    </div>
                  </div>
                ))}
              </Responsive>
            ) : (
              <ResponsiveGridLayout
                // Force a clean remount when the dashboard identity changes.
                // Without this, RGL retains its internal per-item position
                // cache from the previous dashboard, causing items in the new
                // dashboard to fall through to w=1/h=1 (the "stretched
                // vertical strip" bug) on dashboard switch and after save.
                key={storageKey}
                className="layout"
                layouts={layouts}
                breakpoints={breakpoints}
                cols={cols}
                margin={margin}
                containerPadding={containerPadding}
                rowHeight={rowHeight}
                isDraggable={!readOnly}
                isResizable={!readOnly}
                compactType="vertical"
                resizeHandles={['se', 'e', 's', 'w', 'n']}
                draggableCancel="button, input, select, textarea, a, [contenteditable], .dashboard-card-menu-trigger, .react-resizable-handle"
                onLayoutChange={handleLayoutChange}
                onBreakpointChange={handleBreakpointChange}
                onDragStop={handleDragResizeStop}
                onResizeStop={handleDragResizeStop}
              >
                {editedDisplayComponents.map((component: DashboardComponent) => {
                  const compId = component.component_config?.id || component.id;
                  const isHighlighted = highlightedIds.has(String(compId)) || highlightedIds.has(String(component.id));
                  const cellKey = String(component.id);
                  const isSelectedForEdit = editMode && selectedComponentId === cellKey;
                  const cardEditClass = editMode
                    ? `cursor-pointer ${isSelectedForEdit ? 'ring-2 ring-[var(--dashboard-accent)] ring-offset-2 ring-offset-[var(--dashboard-bg)]' : 'ring-1 ring-[var(--dashboard-accent-ring)] hover:ring-[var(--dashboard-accent)]'}`
                    : '';
                  return (
                    <div key={cellKey} className={`animate-fade-in h-full min-h-0 ${isHighlighted ? 'dashboard-component-highlight' : ''}`}>
                      <EditProvider
                        editMode={editMode && canEdit}
                        componentId={cellKey}
                        isSelected={isSelectedForEdit}
                        onApplyEdit={applyFieldEdit}
                        onSelectComponent={setSelectedComponent}
                      >
                      <div
                        className={`relative h-full min-h-0 overflow-hidden rounded-lg border group/card transition-all duration-200 hover:-translate-y-px hover:shadow-[var(--dashboard-card-shadow-hover)] ${cardEditClass}`}
                        data-chart-id={cellKey}
                        style={{
                          backgroundColor: "var(--dashboard-card-bg)",
                          borderColor: "var(--dashboard-card-border)",
                          boxShadow: "var(--dashboard-card-shadow)",
                        }}
                        onMouseDownCapture={editMode && canEdit ? (e) => {
                          // Click selects the component for the panel — but
                          // skip when the click is on an editable control,
                          // OR on an element rendered inside a Radix
                          // portal/popper (DropdownMenu, Select, Tooltip…).
                          //
                          // React events bubble through the React tree even
                          // from portals — so a click on a menu item
                          // (DOM-rooted at body level) STILL fires this
                          // capture handler, with `target` being the menu
                          // item. Walking the DOM ancestry (target.closest)
                          // wouldn't find the trigger button's
                          // `[data-edit-control]` because the menu is in a
                          // portal subtree. We therefore also match the
                          // Radix popper wrapper and ARIA roles those
                          // components use.
                          const target = e.target as HTMLElement;
                          if (target.closest(
                            'input, textarea, ' +
                            '[contenteditable="true"], ' +
                            '[data-edit-control], ' +
                            '[data-radix-popper-content-wrapper], ' +
                            '[role="menu"], [role="menuitem"], ' +
                            '[role="listbox"], [role="option"], ' +
                            '[role="dialog"], [role="tooltip"]'
                          )) return;
                          setSelectedComponent(cellKey);
                        } : undefined}
                      >
                        {showCardActionsMenu && (
                          <div
                            className="absolute left-2 top-2 z-20 opacity-0 group-hover/card:opacity-60 transition-opacity duration-150 pointer-events-none"
                            aria-hidden="true"
                          >
                            <GripVertical
                              className="h-3.5 w-3.5"
                              strokeWidth={2}
                              style={{ color: isLightDashboardTheme ? "var(--dashboard-muted)" : "var(--dashboard-title)" }}
                            />
                          </div>
                        )}
                        {showCardActionsMenu && (
                          <div
                            className="dashboard-card-menu-trigger absolute right-2 top-2 z-20 flex items-center gap-1.5 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150"
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            {!editMode && (
                              <ChartFixPopover chartChip={dashboardComponentToChartChip(component)} />
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Card actions"
                                  // The card's onMouseDownCapture handler
                                  // (selecting the component for the edit
                                  // panel) bypasses any element matching
                                  // [data-edit-control]. Without this attr,
                                  // clicking the 3-dots in edit mode would
                                  // hijack each menu action — opening the
                                  // panel instead of running the action.
                                  data-edit-control="card-menu"
                                  className="flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur-sm outline-none transition-colors focus-visible:ring-2"
                                  style={{
                                    backgroundColor: "var(--dashboard-control-bg)",
                                    borderColor: "var(--dashboard-card-border)",
                                    color: "var(--dashboard-title)",
                                  }}
                                >
                                  <MoreVertical className="h-3.5 w-3.5" strokeWidth={2} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                sideOffset={6}
                                className="min-w-[11rem] rounded-lg border-0 backdrop-blur-xl shadow-xl"
                                style={{
                                  "--dashboard-title": premiumDashboardVars["--dashboard-title"],
                                  "--dashboard-accent": premiumDashboardVars["--dashboard-accent"],
                                  "--dashboard-menu-hover": premiumDashboardVars["--dashboard-menu-hover"],
                                  "--dashboard-card-border": premiumDashboardVars["--dashboard-card-border"],
                                  backgroundColor: hexToRgba(
                                    CHART_THEME_COLORS[effectiveTheme]?.["bg-card-color"],
                                    isLightDashboardTheme ? 0.85 : 0.78
                                  ),
                                  color: premiumDashboardVars["--dashboard-title"],
                                  boxShadow: isLightDashboardTheme
                                    ? "0 8px 32px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)"
                                    : "0 8px 32px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.06)",
                                } as React.CSSProperties}
                              >
                                {/* In edit mode, only the destructive Remove
                                    action is available. Edit / Fix in chat
                                    / Export PNG are intentionally hidden:
                                    - Edit is meaningless (already editing).
                                    - Fix in chat opens a separate AI flow
                                      that conflicts with manual edits.
                                    - Export PNG would capture edit-mode
                                      affordances (cell input borders, edit
                                      ring) into the PNG. View mode is the
                                      only safe state to export from. */}
                                {!editMode && (
                                  <>
                                    <DropdownMenuItem
                                      className={DASHBOARD_CARD_MENU_ITEM_CLASS}
                                      onSelect={() => {
                                        setEditMode(true);
                                        setSelectedComponent(cellKey);
                                      }}
                                    >
                                      <Pencil className="h-4 w-4 shrink-0" style={{ color: "var(--dashboard-accent)" }} />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className={DASHBOARD_CARD_MENU_ITEM_CLASS}
                                      onSelect={() => {
                                        window.dispatchEvent(
                                          new CustomEvent(SELECT_CHART_CONTEXT_EVENT, {
                                            detail: dashboardComponentToChartChip(component),
                                          })
                                        );
                                      }}
                                    >
                                      <MessageSquare className="h-4 w-4 shrink-0" style={{ color: "var(--dashboard-accent)" }} />
                                      Fix in chat
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className={DASHBOARD_CARD_MENU_ITEM_CLASS}
                                      disabled={exportingIds.has(cellKey)}
                                      onSelect={async () => {
                                        const cardEl = document.querySelector<HTMLElement>(
                                          `[data-chart-id="${cellKey}"]`
                                        );
                                        if (!cardEl) return;
                                        setExportingIds(prev => new Set(prev).add(cellKey));
                                        try {
                                          const chartTitle = component.component_config?.title || 'chart';
                                          await exportChartAsPng(cardEl, chartTitle);
                                        } finally {
                                          setExportingIds(prev => {
                                            const next = new Set(prev);
                                            next.delete(cellKey);
                                            return next;
                                          });
                                        }
                                      }}
                                    >
                                      {exportingIds.has(cellKey)
                                        ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--dashboard-accent)" }} />
                                        : <ImageDown className="h-4 w-4 shrink-0" style={{ color: "var(--dashboard-accent)" }} />}
                                      Export to PNG
                                    </DropdownMenuItem>
                                    {/* Phase 7: opens the version-history /
                                        diff / revert dialog scoped to this
                                        card. Only meaningful when we have a
                                        real conversation + dashboard id. */}
                                    {currentConversationId && projectId && (dashboardId || activeDashboard?.id) && (
                                      <DropdownMenuItem
                                        className={DASHBOARD_CARD_MENU_ITEM_CLASS}
                                        onSelect={() => setHistoryComponent(component)}
                                      >
                                        <History className="h-4 w-4 shrink-0" style={{ color: "var(--dashboard-accent)" }} />
                                        History
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator style={{ backgroundColor: premiumDashboardVars["--dashboard-card-border"] }} />
                                  </>
                                )}
                                <DropdownMenuItem
                                  className="cursor-pointer gap-2 py-2 text-red-400 focus:bg-red-500/15 focus:text-red-400"
                                  onSelect={() => setConfirmRemoveId(cellKey)}
                                >
                                  <Trash2 className="h-4 w-4 shrink-0" />
                                  Remove chart
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                        <ChartRenderer
                          component={component}
                          onError={handleComponentError}
                        />
                        {!isExporting && (
                          <ChangedBadge
                            componentId={String(component.id)}
                            altComponentId={String(compId)}
                            onOpenHistory={
                              currentConversationId && projectId && (dashboardId || activeDashboard?.id)
                                ? () => setHistoryComponent(component)
                                : undefined
                            }
                          />
                        )}
                      </div>
                      </EditProvider>
                    </div>
                  );
                })}
              </ResponsiveGridLayout>
            )}
          </div>
        )}

        {!processedData && !configuration && !dashboardState.loading && !dashboardState.error && (
          <div className="space-y-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No dashboard configuration available. Generate a dashboard or upload data to get started.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
      {canEdit && <EditPanel components={editedDisplayComponents} />}
      {canEdit && editMode && <InlineSvgTextEditor />}
      <AlertDialog open={confirmRemoveId !== null} onOpenChange={(open) => { if (!open) setConfirmRemoveId(null); }}>
        <AlertDialogContent className="border-border dark:border-white/15 bg-background dark:bg-[#1a1a1a] text-foreground dark:text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove chart?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground dark:text-white/60">
              This chart will be removed from the dashboard. This cannot be undone in the current session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border dark:border-white/15 bg-transparent text-foreground dark:text-white hover:bg-black/5 dark:hover:bg-white/10 font-medium">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (confirmRemoveId) {
                  setRemovedComponentIds(prev => new Set(prev).add(confirmRemoveId));
                  setConfirmRemoveId(null);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Phase 7: version history / diff / revert, scoped to the card it was
          opened from. Mounted only while a component is selected. */}
      <VersionHistoryDialog
        open={historyComponent !== null}
        onOpenChange={(open) => { if (!open) setHistoryComponent(null); }}
        conversationId={currentConversationId}
        projectId={projectId}
        dashboardId={dashboardId || activeDashboard?.id}
        component={historyComponent}
        onReverted={() => {
          setHistoryComponent(null);
          if (onDashboardReverted) {
            onDashboardReverted();
          } else if (!processedData && !staticConfig) {
            // Id-based dashboards own their data via useDashboard — refresh in place.
            void refreshDashboard({ dashboard_id: String(dashboardId), force_refresh: true });
          }
        }}
      />
    </div>
  );
};

export default DashboardPreview;
