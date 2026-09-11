import {
  Fragment,
  lazy,
  Suspense,
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  type JSX,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CornerRightUp, User, Sparkles, BarChart3, Database, TrendingUp, Users, DollarSign, ChevronDown, ChevronUp, ChevronRight, Link, FileText, Square, Check, CheckCircle, AlertCircle, ChevronsUpDown, ChevronsDownUp, Copy, PieChart, AreaChart, Hash, Table2, Pencil, CircleDashed, Circle, ListTodo, Zap, Maximize2 } from "lucide-react";
import { ComposerAddMenu } from "@/components/chat/ComposerAddMenu";
import { CONNECTORS, type ConnectorItem } from "@/constants/connectors";
import TextareaAutosize from 'react-textarea-autosize';
import RecordingBarSidebar from '@/components/ui/recording-bar-sidebar';
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { fileService, type UploadResponse, type AssetRecord } from "@/services/fileService";
import { conversationService } from "@/services/conversationService";
import { conversationNodesToMessages } from "@/chat/conversationToMessages";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { connectorCapability, useCapabilities } from "@/hooks/useCapabilities";
import {
  buildAttachmentFromFiles,
  getExplicitPromptAssetIds,
  getExplicitPromptFiles,
  isNonAnalyzableUpload,
  useChatStore,
  type UploadedFile,
} from "@/chat/useChatStore";
import { useFileStore } from "@/chat/useFileStore";
import TemplateModal from "@/components/homepage-section/TemplateModal";
import FeedbackModal from "@/components/ui/FeedbackModal";
import type { ThemeSelection } from "@/constants/builtinTemplates";
import FilePreviewChip from "../components/chat/FilePreviewChip";
import InlineCsvPreview from "../components/chat/InlineCsvPreview";
import ChartPreviewChip from "../components/chat/ChartPreviewChip";
import { DataContextInlineToken } from "@/components/chat/DataContextInlineToken";
import { ThemeInlineToken } from "@/components/chat/ThemeInlineToken";
import type { ChartChipData } from "../components/chat/ChartPreviewChip";
import type { SelectChartContextDetail } from "@/types/chartEdit";
import { ChatVisualArtifact } from "@/components/chat/ChatVisualArtifact";
import { ChartChangeSummaryCard } from "@/components/chat/ChartChangeSummaryCard";
// Lazy at the import site, not inside ActivityPanel itself: ActivityPanel pulls
// in react-syntax-highlighter (via ThinkingEventTimeline -> PythonCodeBlock,
// which calls registerLanguage at module scope), and PythonCodeBlock.test.tsx
// and ActivityPanel.test.tsx are byte-pinned by the test migration ledger and
// render those modules synchronously. Splitting here leaves both untouched.
const ActivityPanel = lazy(() =>
  import("@/components/project-section/ActivityPanel").then((m) => ({
    default: m.ActivityPanel,
  })),
);
import {
  ClarificationInputOverlay,
} from "@/components/chat/ClarificationInputOverlay";
import { getLatestPendingClarificationMessage } from "@/components/chat/clarificationOverlayUtils";
import ProjectContextPicker from "../components/chat/ProjectContextPicker";
import { FirstRunHint } from "../components/chat/FirstRunHint";
import ModelSelector from "./ModelSelector";
import { CreditExhaustedCard } from "./CreditExhaustedCard";
import type { DashboardComponent } from "@/types/dashboard";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getFilesFromClipboardData } from "@/lib/clipboardFiles";
import { useTheme } from "@/hooks/useTheme";
import { formatToDisplay } from "@/utils/timestamp";
import { buildActivityTimeline } from "@/utils/analysisSteps";
import {
  getSpreadsheetPreviewTarget,
  normalizeConnectorSource,
  type DataContextTokenSource,
  type SpreadsheetPreviewTarget,
} from "@/utils/dataContextTokens";
import { useUser } from "@/lib/clerk";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ClarificationAnswer, Message, ThinkingEvent } from "@/types/message";
import { MetaPixel } from "@/hooks/useMetaPixel";


// Creative phrase variants per backend step — each key maps to a real Morpheus workflow step
const STEP_VARIANTS: Record<string, string[]> = {
  'start': [
    "Waking up my brain...",
    "Coming online now...",
    "Stretching my neurons...",
    "Just getting started...",
    "Firing up the engines...",
    "Rising and shining...",
  ],
  'initialized': [
    "Queued for analysis...",
    "Getting ready...",
    "Preparing the run...",
    "Setting up the workspace...",
  ],
  'initializing': [
    "Queued for analysis...",
    "Getting ready...",
    "Preparing the run...",
    "Setting up the workspace...",
  ],
  'load_conversation': [
    "Reading our conversation...",
    "Catching up on context...",
    "Refreshing my memory...",
    "Picking up where we left off...",
    "Getting back up to speed...",
    "Reviewing the backstory...",
  ],
  'download_asset': [
    "Taking a look at your data...",
    "Reading through the file...",
    "Getting familiar with the dataset...",
    "Scanning what you've shared...",
    "Absorbing your spreadsheet...",
    "Digging into the file...",
  ],
  'run_workflow': [
    "Spinning up the pipeline...",
    "Getting the gears turning...",
    "Kicking off the workflow...",
    "Putting the wheels in motion...",
    "Launching the data engine...",
    "Starting the machinery...",
  ],
  'routing': [
    "Understanding what you need...",
    "Getting a feel for the goal...",
    "Figuring out the best path...",
    "Tuning in to your request...",
    "Mapping out the mission...",
    "Locking in on the objective...",
  ],
  'reasoning': [
    "Thinking this through...",
    "Planning the best approach...",
    "Brainstorming the right angle...",
    "Working out the strategy...",
    "Deliberating on the best move...",
    "Picking the smartest path...",
  ],
  'reasoning_internal': [
    "Comparing analytical options...",
    "Working through the next move...",
    "Choosing the strongest analysis path...",
    "Checking possible approaches...",
  ],
  'explore_files': [
    "Profiling the data structure...",
    "Reading the table shape...",
    "Scanning columns and samples...",
    "Getting familiar with the dataset...",
  ],
  'ask_first': [
    "Checking whether I should ask first...",
    "Looking for any risky guesses...",
    "Seeing if your choice is needed...",
  ],
  'analyzing': [
    "Analyzing the requested change...",
    "Reading what needs to change...",
    "Inspecting the chart to edit...",
    "Working out what you want adjusted...",
  ],
  'recomputing': [
    "Recomputing the numbers...",
    "Updating the underlying data...",
    "Recalculating the values...",
    "Refreshing the figures...",
  ],
  'rendering': [
    "Rendering the updated chart...",
    "Redrawing the visual...",
    "Applying the new look...",
    "Repainting the chart...",
  ],
  'execution': [
    "Crunching the numbers...",
    "Running the analysis...",
    "Doing the heavy lifting...",
    "Putting the data to work...",
    "Getting into the details...",
    "Letting the math do its thing...",
  ],
  'synthesis': [
    "Designing your dashboard...",
    "Assembling the visuals...",
    "Crafting the charts...",
    "Building the layout...",
    "Putting it all together...",
    "Weaving the pieces together...",
  ],
  'validation': [
    "Double-checking the results...",
    "Making sure everything adds up...",
    "Giving it a final once-over...",
    "Confirming all looks good...",
    "Reviewing for accuracy...",
    "Verifying before handing over...",
  ],
  'finish': [
    "Wrapping things up...",
    "Putting on the finishing touches...",
    "Almost ready for you...",
    "Last few steps now...",
    "Polishing before delivery...",
    "Nearly there...",
  ],
  'error': [
    "Hit a small snag.",
    "Ran into a hiccup.",
    "Something went sideways.",
  ],
};

const STEP_LABELS_STORAGE_PREFIX = 'dreamify_step_labels_';
const stepVariantCache = new Map<string, string>();

const mapStepToDisplayText = (step: string): string => {
  const conversationId = useChatStore.getState().currentConversationId;
  const cacheKey = conversationId ? `${conversationId}:${step}` : step;

  // 1. In-memory cache (fast path)
  if (stepVariantCache.has(cacheKey)) return stepVariantCache.get(cacheKey)!;

  // 2. sessionStorage — survives F5 refresh, keyed by conversationId
  if (conversationId) {
    try {
      const stored = sessionStorage.getItem(STEP_LABELS_STORAGE_PREFIX + conversationId);
      if (stored) {
        const parsed: Record<string, string> = JSON.parse(stored);
        if (parsed[step]) {
          stepVariantCache.set(cacheKey, parsed[step]);
          return parsed[step];
        }
      }
    } catch { /* sessionStorage unavailable */ }
  }

  // 3. Pick randomly and persist to both caches
  const variants = STEP_VARIANTS[step];
  const pick = variants
    ? variants[Math.floor(Math.random() * variants.length)]
    : "Processing...";
  stepVariantCache.set(cacheKey, pick);

  if (conversationId) {
    try {
      const stored = sessionStorage.getItem(STEP_LABELS_STORAGE_PREFIX + conversationId);
      const existing: Record<string, string> = stored ? JSON.parse(stored) : {};
      existing[step] = pick;
      sessionStorage.setItem(STEP_LABELS_STORAGE_PREFIX + conversationId, JSON.stringify(existing));
    } catch { /* sessionStorage unavailable */ }
  }

  return pick;
};

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
};

// Helper function to format file status for display
const formatAssetStatus = (status: string | null | undefined): string => {
  if (!status) return "Ready to analyze";

  // Map status values to display text
  const statusMap: Record<string, string> = {
    "uploading": "Uploading",
    "uploaded": "Ready to analyze",
    "processing": "Processing",
    "processed": "Processed",
    "error": "Error",
    "accepted": "Processing",
  };

  return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1);
};

// Deep Thinking Tasks component — supports both live (during processing) and static (from saved data) modes
interface DeepThinkingTasksProps {
  prompt?: string;
  isActive: boolean;
  currentStep?: string | null;
  savedTasks?: Array<{ id: string; text: string }>;
  initialSteps?: Array<{ id: string; text: string }>;
  inline?: boolean;
  compactSurface?: boolean;
}

const DeepThinkingTasks = ({ prompt, isActive, currentStep, savedTasks, initialSteps, inline, compactSurface = false }: DeepThinkingTasksProps) => {
  const [isExpanded, setIsExpanded] = useState(!savedTasks);

  // Parse tasks from /run prompt (live mode only)
  const promptTasks = useMemo(() => {
    if (savedTasks) return [];
    if (!prompt) return [];
    let textToParse = prompt.trim();
    if (!textToParse.startsWith('/run')) return [];

    textToParse = textToParse.substring(4).trim();
    const lines = textToParse.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    return lines.map(line => line.replace(/^([-*o]|\d+\.)\s*/, '').trim());
  }, [prompt, savedTasks]);

  const [workflowTasks, setWorkflowTasks] = useState<{ id: string, text: string }[]>([]);
  const prevStepRef = useRef<string | null>(null);

  useEffect(() => {
    if (savedTasks) return;
    if (!isActive) {
      if (workflowTasks.length > 0) {
        setIsExpanded(false);
      }
      return;
    }

    setIsExpanded(true);

    if (workflowTasks.length === 0) {
      // Clear variant cache so each new workflow gets a fresh random set of labels
      stepVariantCache.clear();
      if (initialSteps && initialSteps.length > 0) {
        // Resume after reload: seed with all steps that completed before this session
        setWorkflowTasks(initialSteps);
        prevStepRef.current = initialSteps[initialSteps.length - 1].id;
      } else {
        setWorkflowTasks([{ id: 'start', text: mapStepToDisplayText('start') }]);
      }
    }

    if (currentStep && currentStep !== prevStepRef.current) {
      const displayText = mapStepToDisplayText(currentStep);
      setWorkflowTasks(prev => {
        if (prev.find(t => t.text === displayText) || currentStep === 'start') return prev;
        return [...prev, { id: currentStep, text: displayText }];
      });
      prevStepRef.current = currentStep;
    }
  }, [currentStep, initialSteps, isActive, workflowTasks.length, savedTasks]);

  const displayTasks = savedTasks
    ? savedTasks
    : promptTasks.length > 0
      ? promptTasks.map((t, i) => ({ id: `prompt-${i}`, text: t }))
      : workflowTasks;
  const isUsingWorkflow = !savedTasks && promptTasks.length === 0;

  if (displayTasks.length === 0) {
    return null;
  }

  const isLiveMode = !inline;

  const compactSurfaceClass = compactSurface ? "max-w-[720px]" : "max-w-full";
  const wrapperClass = inline
    ? `w-full ${compactSurfaceClass} mt-3 bg-card dark:bg-[#1E1E1E] border border-border dark:border-white/10 rounded-xl overflow-hidden shadow-md dark:shadow-sm`
    : `w-full ${compactSurface ? "max-w-[720px]" : "max-w-[85%]"} mt-3 ml-[38px] bg-card dark:bg-[#1E1E1E] border border-border dark:border-white/10 rounded-xl overflow-hidden shadow-md dark:shadow-sm`;

  const headerClass = isLiveMode
    ? "grid grid-cols-[1fr_auto] items-center px-4 py-2 bg-muted/50 dark:bg-[#18181B] border-b border-border dark:border-white/5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/[0.02] transition-colors"
    : "flex items-center justify-between px-4 py-2 bg-muted/50 dark:bg-[#18181B] border-b border-border dark:border-white/5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/[0.02] transition-colors";

  return (
    <div className={wrapperClass}>
      {/* Header */}
      <div
        className={headerClass}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 text-[10px] sm:text-xs tracking-wider text-muted-foreground dark:text-white/50">
          <ListTodo className="w-5 h-5" />
          <span>Thinking Process <span className="text-muted-foreground/30 dark:text-white/20 mx-1">|</span> {isActive ? 'Executing' : 'Executed'}</span>
        </div>
        <div className={`flex items-center gap-2 ${isLiveMode ? 'flex-shrink-0' : ''}`}>
          <div className={`text-[10px] sm:text-xs text-muted-foreground dark:text-white/40 ${isLiveMode ? 'whitespace-nowrap text-right' : ''}`}>
            Total: {displayTasks.length} {displayTasks.length === 1 ? 'Task' : 'Tasks'}
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 dark:text-white/30 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Body */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3.5 border-t border-border dark:border-white/5">
              <div className="text-xs font-medium text-muted-foreground dark:text-white/80 mb-3.5">
                {isUsingWorkflow ? "Processing Steps" : `${displayTasks.length} Tasks Remaining`}
              </div>

              <div className="flex flex-col gap-3">
                {displayTasks.map((task, idx) => {
                  const isTaskActive = isUsingWorkflow ? (isActive && idx === displayTasks.length - 1) : (isActive && idx === 0);
                  const isCompleted = savedTasks ? true : isUsingWorkflow ? (idx < displayTasks.length - 1 || !isActive) : !isActive;

                  return (
                    <div key={task.id} className={`flex items-start gap-3 text-sm ${isTaskActive ? 'text-foreground dark:text-white' : 'text-muted-foreground/50 dark:text-white/50'}`}>
                      <div className="mt-[2px] flex-shrink-0">
                        {isCompleted ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : isTaskActive ? (
                          <CircleDashed className="w-4 h-4 text-muted-foreground/60 dark:text-white/80 animate-[spin_3s_linear_infinite]" />
                        ) : (
                          <Circle className="w-4 h-4 text-white/20" />
                        )}
                      </div>
                      <span className="leading-snug break-words flex-1">{task.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Fluid Morph single-line loading indicator
interface RollingTextProps {
  isActive: boolean;
  stopSignal: boolean;
  successText?: string;
  currentStep?: string | null;
}

const RollingText = ({ isActive, stopSignal, currentStep = null }: RollingTextProps) => {
  const [currentText, setCurrentText] = useState<string>("");
  const prevStepRef = useRef<string | null>(null);

  // Update current text when step changes
  useEffect(() => {
    if (!isActive) return;

    if (currentStep && currentStep !== prevStepRef.current) {
      const displayText = mapStepToDisplayText(currentStep);
      setCurrentText(displayText);
      prevStepRef.current = currentStep;
    }
  }, [currentStep, isActive]);

  // Don't render if never started or no text
  if (!currentText) return null;

  return (
    <AnimatePresence>
      {!stopSignal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-2.5 ml-8 mt-2"
        >
          {/* Sparkles Icon */}
          <Sparkles className="w-4 h-4 text-blue-400 animate-pulse flex-shrink-0 leading-none" />

          {/* Animated Text */}
          <div className="relative flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.span
                key={currentText}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{
                  duration: 0.3,
                  ease: [0.4, 0.0, 0.2, 1]
                }}
                className="text-sm truncate bg-clip-text text-transparent bg-gradient-to-r from-muted-foreground/40 via-foreground to-muted-foreground/40 dark:from-gray-200 dark:via-white dark:to-gray-200 block max-w-full leading-normal"
              >
                {currentText}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

interface ThinkingProcessProps {
  events?: ThinkingEvent[];
  fallbackTasks?: Array<{ id: string; text: string }>;
  isActive: boolean;
  inline?: boolean;
  compactSurface?: boolean;
}

const MEANINGFUL_THINKING_PHASES = new Set([
  "context",
  "routing",
  "tool",
  "synthesis",
  "validation",
  "final",
  "error",
]);

const DESKTOP_THINKING_ROWS = 5;
const MOBILE_THINKING_ROWS = 3;

const formatElapsedMs = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
};

const parseEventTime = (raw?: string | null): number | null => {
  const parsed = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const thinkingEventTime = (event: ThinkingEvent): number => {
  return parseEventTime(event.started_at) ?? parseEventTime(event.completed_at) ?? 0;
};

const thinkingEventKey = (event: ThinkingEvent): string => event.title.trim().toLowerCase();

const buildExpandedThinkingEvents = (
  displayEvents: ThinkingEvent[],
  activeEvent: ThinkingEvent,
): ThinkingEvent[] => {
  const activeIndex = Math.max(0, displayEvents.findIndex((event) => event.id === activeEvent.id));
  const priorEvents = displayEvents.slice(0, activeIndex).reverse();
  const seen = new Set([thinkingEventKey(activeEvent)]);
  const meaningful: ThinkingEvent[] = [];
  const secondary: ThinkingEvent[] = [];

  priorEvents.forEach((event) => {
    const key = thinkingEventKey(event);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (MEANINGFUL_THINKING_PHASES.has(event.phase) || event.status === "error") {
      meaningful.push(event);
    } else {
      secondary.push(event);
    }
  });

  return [...meaningful, ...secondary];
};

const ThinkingStatusText = ({ text, isActive }: { text: string; isActive: boolean }) => {
  if (!isActive) {
    return (
      <span className="min-w-0 max-w-[min(620px,calc(100vw-180px))] truncate text-muted-foreground">
        {text}
      </span>
    );
  }

  return (
    <span className="relative min-w-0 max-w-[min(620px,calc(100vw-180px))] overflow-hidden">
      <motion.span
        key={text}
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          backgroundPosition: ["200% 50%", "-200% 50%"],
        }}
        transition={{
          opacity: { duration: 0.18, ease: "easeOut" },
          backgroundPosition: {
            duration: 4.2,
            repeat: Infinity,
            ease: "easeInOut",
            repeatDelay: 0.25,
          },
        }}
        className="block truncate bg-gradient-to-r from-muted-foreground/60 via-foreground to-muted-foreground/60 bg-clip-text text-transparent [background-size:260%_100%] dark:from-muted-foreground/80 dark:via-white dark:to-muted-foreground/80"
      >
        {text}
      </motion.span>
    </span>
  );
};

const ThinkingProcess = ({ events, fallbackTasks, isActive, inline, compactSurface = false }: ThinkingProcessProps) => {
  const [peekOpen, setPeekOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const displayEvents = useMemo<ThinkingEvent[]>(() => {
    if (events && events.length > 0) {
      const sorted = [...events].sort((a, b) => {
        const timeDelta = thinkingEventTime(a) - thinkingEventTime(b);
        if (timeDelta !== 0) return timeDelta;
        if (a.run_id !== b.run_id) return a.run_id.localeCompare(b.run_id);
        return a.sequence - b.sequence;
      });
      const latestRunId = isActive ? sorted[sorted.length - 1]?.run_id : null;
      const source = latestRunId ? sorted.filter((event) => event.run_id === latestRunId) : sorted;
      return source.map((event, idx, arr) => {
        const isPastActive = event.status === "active" && (idx < arr.length - 1 || !isActive);
        return isPastActive ? { ...event, status: "completed" } : event;
      });
    }

    const source: ThinkingEvent[] = (fallbackTasks || []).map((task, idx) => ({
      id: task.id,
      run_id: "legacy",
      sequence: idx + 1,
      phase: idx === 0 ? "context" : "analysis",
      status: "completed",
      title: task.text,
    }));

    return source.map((event, idx, arr) => {
      const isPastActive = event.status === "active" && (idx < arr.length - 1 || !isActive);
      return isPastActive ? { ...event, status: "completed" } : event;
    });
  }, [events, fallbackTasks, isActive]);

  if (displayEvents.length === 0) return null;

  const activeEvent = [...displayEvents].reverse().find((event) => event.status === "active")
    || displayEvents[displayEvents.length - 1];
  const firstEvent = displayEvents[0];
  const lastTimestamp = [...displayEvents]
    .reverse()
    .map((event) => parseEventTime(event.completed_at) ?? parseEventTime(event.started_at))
    .find((timestamp): timestamp is number => typeof timestamp === "number");
  const startedAt = parseEventTime(firstEvent?.started_at) ?? parseEventTime(firstEvent?.completed_at) ?? now;
  const endedAt = isActive ? now : (lastTimestamp ?? startedAt);
  const elapsed = formatElapsedMs(endedAt - startedAt);
  const expandedEvents = buildExpandedThinkingEvents(displayEvents, activeEvent);
  const desktopExpandedEvents = expandedEvents.slice(0, DESKTOP_THINKING_ROWS - 1);
  const desktopOverflowCount = Math.max(0, expandedEvents.length - (DESKTOP_THINKING_ROWS - 1));
  const mobileOverflowCount = Math.max(0, expandedEvents.length - (MOBILE_THINKING_ROWS - 1));
  const canExpand = expandedEvents.length > 0;
  const inlineStatus = isActive
    ? activeEvent.title
    : `Thought for ${elapsed}`;

  const wrapperClass = inline
    ? `w-fit max-w-full mt-2`
    : `w-fit ${compactSurface ? "max-w-[720px]" : "max-w-[85%]"} mt-2 ml-[38px]`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canExpand) {
            setPeekOpen((open) => !open);
          }
        }}
        className={`${wrapperClass} group flex flex-col items-start rounded-md px-0.5 py-1 text-left transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30`}
      >
        <span className="inline-flex min-h-7 max-w-full items-center gap-2 text-sm text-muted-foreground">
          <span className="relative flex h-4 w-4 flex-shrink-0 items-center justify-center">
            <Sparkles className="relative h-3.5 w-3.5 text-primary" />
          </span>
          <ThinkingStatusText text={inlineStatus} isActive={isActive} />
          {canExpand && (
            <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 opacity-60 transition-transform ${peekOpen ? "rotate-180" : ""} group-hover:opacity-80`} />
          )}
        </span>
        <AnimatePresence initial={false}>
          {peekOpen && canExpand && (
            <motion.span
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="ml-5 mt-1.5 flex max-w-[min(600px,calc(100vw-190px))] flex-col gap-1 overflow-hidden"
            >
              {desktopExpandedEvents.map((event, index) => (
                <span
                  key={`${event.id}:peek`}
                  className={`${index >= MOBILE_THINKING_ROWS - 1 ? "hidden sm:grid" : "grid"} min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5 text-muted-foreground/70`}
                >
                  <span className="relative flex h-5 w-4 items-center justify-center">
                    {index < desktopExpandedEvents.length - 1 && (
                      <span className="absolute left-1/2 top-[15px] h-[14px] w-px -translate-x-1/2 bg-primary/15" />
                    )}
                    <Check className="relative h-3.5 w-3.5 text-primary/55" />
                  </span>
                  <span className="truncate pt-px">{event.title}</span>
                </span>
              ))}
              {mobileOverflowCount > 0 && (
                <span className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5 text-muted-foreground/55 sm:hidden">
                  <span className="flex h-5 w-4 items-center justify-center">
                    <span className="h-1 w-1 rounded-full bg-primary/30" />
                  </span>
                  <span className="truncate pt-px">+ {mobileOverflowCount} more steps summarized</span>
                </span>
              )}
              {desktopOverflowCount > 0 && (
                <span className="hidden min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5 text-muted-foreground/55 sm:grid">
                  <span className="flex h-5 w-4 items-center justify-center">
                    <span className="h-1 w-1 rounded-full bg-primary/30" />
                  </span>
                  <span className="truncate pt-px">+ {desktopOverflowCount} more steps summarized</span>
                </span>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </>
  );
};

interface ActivityEntryPointProps {
  stepCount: number;
  onOpen: () => void;
  inline?: boolean;
  compactSurface?: boolean;
}

const ActivityEntryPoint = ({
  stepCount,
  onOpen,
  inline,
  compactSurface = false,
}: ActivityEntryPointProps) => {
  const wrapperClass = inline
    ? "ml-5 mt-0.5 w-fit max-w-[min(620px,calc(100vw-180px))]"
    : `w-fit ${compactSurface ? "max-w-[720px]" : "max-w-[85%]"} mt-1 ml-[58px]`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          className={`${wrapperClass} group inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:bg-white/5 dark:hover:bg-white/10`}
          aria-label="Open activity timeline"
        >
          <ListTodo className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 truncate font-medium">Activity</span>
          {stepCount > 0 && (
            <span className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground dark:bg-white/10 dark:text-white/70">
              {stepCount === 1 ? "1 step" : `${stepCount} steps`}
            </span>
          )}
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-80" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Open activity timeline</TooltipContent>
    </Tooltip>
  );
};

const ClarificationQuestionTrace = ({
  resolution,
}: {
  resolution: NonNullable<Message["clarificationResolution"]>;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setOpen((current) => !current)}
      className="group mt-2 flex w-fit max-w-full flex-col items-start rounded-md px-0.5 py-1 text-left transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span className="inline-flex min-h-7 max-w-full items-center gap-2 text-sm text-muted-foreground">
        <span className="relative flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <Sparkles className="relative h-3.5 w-3.5 text-primary" />
        </span>
        <span className="min-w-0 max-w-[min(620px,calc(100vw-180px))] truncate">
          Asked 1 question
        </span>
        <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""} group-hover:opacity-80`} />
      </span>
      <AnimatePresence initial={false}>
        {open && (
          <motion.span
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="ml-5 mt-1.5 flex max-w-[min(600px,calc(100vw-190px))] flex-col gap-1 overflow-hidden"
          >
            <span className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5 text-muted-foreground/80">
              <span className="relative flex h-5 w-4 items-center justify-center">
                <span className="absolute left-1/2 top-[15px] h-[14px] w-px -translate-x-1/2 bg-primary/15" />
                <Check className="relative h-3.5 w-3.5 text-primary/55" />
              </span>
              <span className="truncate pt-px">{resolution.question}</span>
            </span>
            <span className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5 text-muted-foreground/55">
              <span className="flex h-5 w-4 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/35" />
              </span>
              <span className="truncate pt-px">No answer provided</span>
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
};

// Fetch project assets for @mention feature
const fetchProjectAssets = async (projectId: string): Promise<Array<{
  id: string;
  name: string;
  ext: string;
  projectId: string;
  sourceType?: string;
  asset: AssetRecord;
}>> => {
  try {
    const response = await fileService.listFiles();
    if (response.success && response.files) {
      // Filter by projectId
      return response.files
        .filter(file => file.asset?.project_id === projectId)
        .map(file => {
          const assetType = file.asset?.asset_type?.toLowerCase() ?? '';
          let derivedSourceType: string | undefined;
          if (assetType.includes('integration_ga4') || assetType.includes('ga4')) {
            derivedSourceType = 'GA4';
          } else if (assetType.includes('integration_gsheets') || assetType.includes('google sheets')) {
            derivedSourceType = 'Google Sheets';
          }

          return {
            id: file.fileID,
            name: file.filename,
            ext: file.ext.toUpperCase(),
            projectId: file.asset?.project_id || projectId,
            sourceType: derivedSourceType,
            asset: file.asset!,
          };
        });
    }
    return [];
  } catch (error) {
    console.error('Failed to fetch project assets:', error);
    return [];
  }
};

interface ChatInterfaceProps {
  projectId?: string;
  onProcessedDataChange?: (data: unknown) => void;
  onSwitchToDashboard?: (dashboardId?: string) => void;
  onShowCsvPreview?: (assetId: string, filename: string) => void;
  onProjectNameAccepted?: (projectName: string) => void;
  onActivityOpenChange?: (open: boolean) => void;
  dashboardComponents?: DashboardComponent[];
  isSidePanelOpen?: boolean;
}

type AttachmentFileItem = {
  id: string;
  name: string;
  ext?: string;
  sourceType?: string;
  accountName?: string;
  propertyName?: string;
  syncVersionName?: string;
};

const CHART_INLINE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bar: BarChart3,
  line: TrendingUp,
  pie: PieChart,
  donut: PieChart,
  area: AreaChart,
  metric: Hash,
  table: Table2,
  composed: BarChart3,
};

type MetadataTokenKind = "theme" | "data" | "chart";

type MetadataTokenDescriptor = {
  id: string;
  kind: MetadataTokenKind;
  priority: number;
  renderInline: () => JSX.Element;
  renderOverflow: () => JSX.Element;
};

const MESSAGE_VISIBLE_TOKEN_COUNT = 1;
const COMPACT_COMPOSER_VISIBLE_TOKEN_COUNT = 2;
const FULL_COMPOSER_VISIBLE_TOKEN_COUNT = 3;

type DashboardComponentConfigPreview = {
  id?: string;
  title?: string;
  type?: string;
};

type DashboardMessageCardProps = {
  dashboardCard: NonNullable<Message["dashboardCard"]>;
  isCompact: boolean;
  isDashboardOpen: boolean;
  hasMessageContent: boolean;
  onOpen?: (dashboardId?: string) => void;
};

function getDashboardSourceLabel(dashboardCard: NonNullable<Message["dashboardCard"]>): string {
  const accountName = dashboardCard.accountName;
  if (accountName) return accountName;

  const source = (dashboardCard.sourceType || dashboardCard.sourceFileName || "").toLowerCase();
  const filename = (dashboardCard.sourceFileName || "").toLowerCase();
  if (source.includes("ga4") || source.includes("google_analytics") || source.includes("google analytics") || filename.includes("ga4") || filename.includes("google_analytics")) return "GA4 Data";
  if (source.includes("sheet") || source.includes("google sheets") || filename.includes("google_sheet") || filename.includes("gsheet")) return "Google Sheets Data";
  if (source.includes("google ads") || source.includes("google_ads") || filename.includes("google_ads")) return "Google Ads Data";
  if (source.includes("firebase") || filename.includes("firebase")) return "Firebase Data";
  if (source.includes("tiktok") || filename.includes("tiktok")) return "TikTok Data";
  if (source.includes("appsflyer") || filename.includes("appsflyer")) return "AppsFlyer Data";
  if (source.includes("stripe") || filename.includes("stripe")) return "Stripe Data";
  if (source.includes("hubspot") || filename.includes("hubspot")) return "HubSpot Data";
  if (source.includes("salesforce") || filename.includes("salesforce")) return "Salesforce Data";
  if (source.includes("pipedrive") || filename.includes("pipedrive")) return "Pipedrive Data";
  if (source.includes("supabase") || filename.includes("supabase")) return "Supabase Data";
  if (source.includes("shopify") || filename.includes("shopify")) return "Shopify Data";
  if (source.includes("klaviyo") || filename.includes("klaviyo")) return "Klaviyo Data";
  if (source.includes("quickbooks") || source.includes("quick books") || filename.includes("quickbooks")) return "QuickBooks Data";
  if (source.includes("zendesk") || filename.includes("zendesk")) return "Zendesk Data";
  if (source.includes("mixpanel") || filename.includes("mixpanel")) return "Mixpanel Data";
  if (source.includes("posthog") || source.includes("post hog") || filename.includes("posthog")) return "PostHog Data";
  if (source.includes("customer_io") || source.includes("customer.io") || source.includes("customer io") || filename.includes("customer_io")) return "Customer.io Data";
  if (source.includes("google_search_console") || source.includes("google search console") || source.includes("search console") || filename.includes("google_search_console")) return "Google Search Console Data";
  if (source.includes("amazon_seller") || source.includes("amazon seller") || filename.includes("amazon_seller")) return "Amazon Seller Data";
  if (source.includes("shopee_seller") || source.includes("shopee seller") || filename.includes("shopee_seller")) return "Shopee Seller Data";
  if (source.includes("lazada_seller") || source.includes("lazada seller") || filename.includes("lazada_seller")) return "Lazada Seller Data";
  if (source.includes("tiktok_shop_seller") || source.includes("tiktok shop seller") || filename.includes("tiktok_shop_seller")) return "TikTok Shop Seller Data";
  if (source.includes("bigquery") || filename.includes("bigquery")) return "BigQuery Data";
  if (source.includes("snowflake") || filename.includes("snowflake")) return "Snowflake Data";
  if (source.includes("databricks") || filename.includes("databricks")) return "Databricks Data";
  if (source.includes("postgres") || source.includes("warehouse") || filename.includes("postgres")) return "PostgreSQL Data";
  if (source.includes("meta") || filename.includes("meta_ads")) return "Meta Ads Data";
  return dashboardCard.sourceFileName.replace(/\.[^/.]+$/, "");
}

function DashboardMessageCard({
  dashboardCard,
  isCompact,
  isDashboardOpen,
  hasMessageContent,
  onOpen,
}: DashboardMessageCardProps) {
  const title = dashboardCard.dashboardTitle || "Dashboard";
  const sourceLabel = getDashboardSourceLabel(dashboardCard);
  const gradientId = `dashboardCardBarGrad-${dashboardCard.dashboardId || "fallback"}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const secondaryGradientId = `${gradientId}-secondary`;
  const widthClass = isCompact
    ? "w-full max-w-full min-w-0"
    : "w-full min-w-0 max-w-[27rem]";
  const openDashboard = () => {
    onOpen?.(dashboardCard.dashboardId);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-label="Open dashboard"
          onClick={openDashboard}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openDashboard();
            }
          }}
          className={`group/dashboard relative flex min-h-[56px] ${widthClass} cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card/80 px-3 py-2.5 text-left shadow-sm outline-none transition-all select-none hover:border-border/80 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20 dark:hover:bg-white/[0.07] ${hasMessageContent ? "mt-3" : ""}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="relative grid h-8 w-8 flex-shrink-0 place-items-center overflow-hidden rounded-md bg-gradient-to-br from-violet-500/20 via-blue-500/15 to-cyan-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] transition-all duration-300 group-hover/dashboard:from-violet-500/30 group-hover/dashboard:via-blue-500/25 group-hover/dashboard:to-cyan-500/20">
              <div className="absolute inset-0 rounded-md ring-1 ring-inset ring-border/50 transition-all duration-300 group-hover/dashboard:ring-border dark:ring-white/10 dark:group-hover/dashboard:ring-white/15" />
              <svg viewBox="0 0 40 40" className="relative h-full w-full" aria-hidden="true">
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(221 83% 70%)" stopOpacity="1" />
                    <stop offset="100%" stopColor="hsl(260 80% 60%)" stopOpacity="0.6" />
                  </linearGradient>
                  <linearGradient id={secondaryGradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(175 80% 60%)" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="hsl(221 83% 60%)" stopOpacity="0.5" />
                  </linearGradient>
                </defs>
                <path d="M5 15 L11 11 L17 14 L23 7 L29 10 L35 6" stroke="hsl(142 76% 60%)" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
                <rect x="5" y="24" width="5" height="11" rx="1.5" fill={`url(#${gradientId})`} opacity="0.5" />
                <rect x="12" y="20" width="5" height="15" rx="1.5" fill={`url(#${gradientId})`} opacity="0.8" />
                <rect x="19" y="25" width="5" height="10" rx="1.5" fill={`url(#${secondaryGradientId})`} opacity="0.55" />
                <rect x="26" y="21" width="5" height="14" rx="1.5" fill={`url(#${gradientId})`} opacity="0.9" />
                <circle cx="23" cy="7" r="2.1" fill="hsl(142 76% 60%)" opacity="0.9" />
                <circle cx="23" cy="7" r="3.4" fill="hsl(142 76% 60%)" opacity="0.18" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium leading-5 text-foreground dark:text-white">
                {title}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground dark:text-white/50">
                <span className="shrink-0 rounded-[5px] border border-border/70 bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:border-white/10 dark:bg-black/20 dark:text-white/55">
                  Dashboard
                </span>
                <span className="min-w-0 truncate">{sourceLabel}</span>
              </div>
            </div>
          </div>
          {!isDashboardOpen && (
            <span className="button-outline inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors group-hover/dashboard:text-foreground dark:text-white/70 dark:group-hover/dashboard:text-white" aria-hidden="true">
              <Maximize2 className="h-3 w-3" />
              Open
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="z-[300] max-w-[min(90vw,300px)] bg-black/90 text-xs text-white shadow-lg break-words"
      >
        {title}{sourceLabel ? ` - ${sourceLabel}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function dedupeDataContextTokenSources(sources: DataContextTokenSource[]): DataContextTokenSource[] {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const connector = normalizeConnectorSource(source.sourceType);
    const key = [
      connector?.name || source.sourceType || source.kind || "file",
      source.accountName || "",
      source.propertyName || "",
      source.syncVersionName || "",
      source.filename || source.name || "",
    ].join("|").toLowerCase();

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getAttachmentTokenSources(attachment?: Message["attachment"]): DataContextTokenSource[] {
  if (!attachment) return [];

  if (attachment.files?.length) {
    return dedupeDataContextTokenSources(attachment.files.map((file) => ({
      id: file.id,
      filename: file.name,
      ext: file.ext,
      sourceType: file.sourceType,
      accountName: file.accountName,
      propertyName: file.propertyName,
      syncVersionName: file.syncVersionName,
      status: "processed",
    })));
  }

  return dedupeDataContextTokenSources([{
    filename: attachment.name,
    kind: attachment.kind,
    sourceType: attachment.sourceType,
    accountName: attachment.accountName,
    propertyName: attachment.propertyName,
    syncVersionName: attachment.syncVersionName,
    status: "processed",
  }]);
}

function splitMetadataTokens(tokens: MetadataTokenDescriptor[], visibleCount: number) {
  if (tokens.length <= visibleCount) {
    return { visibleTokens: tokens, overflowTokens: [] };
  }
  const orderedTokens = [...tokens].sort((a, b) => a.priority - b.priority);
  return {
    visibleTokens: orderedTokens.slice(0, visibleCount),
    overflowTokens: orderedTokens.slice(visibleCount),
  };
}

function MetadataOverflowToken({ tokens }: { tokens: MetadataTokenDescriptor[] }) {
  const [open, setOpen] = useState(false);
  if (tokens.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mr-1.5 inline-flex h-6 shrink-0 items-center rounded-md border border-border/80 bg-background/85 px-2 text-[12px] font-semibold leading-none text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground dark:border-white/15 dark:bg-white/[0.08] dark:text-white/65 dark:hover:bg-white/15 dark:hover:text-white"
          aria-label={`Show ${tokens.length} more context tags`}
        >
          +{tokens.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="z-[320] w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl dark:border-white/15"
      >
        <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Context
        </div>
        <div className="flex flex-wrap gap-1.5" onClick={() => setOpen(false)}>
          {tokens.map((token) => (
            <Fragment key={token.id}>{token.renderOverflow()}</Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ChartMentionInlineToken({
  chart,
  isDone,
  className = "mr-1.5",
}: {
  chart: NonNullable<Message["chartMentions"]>[number];
  isDone: boolean;
  className?: string;
}) {
  const ChartIcon = CHART_INLINE_ICONS[chart.type] || BarChart3;
  const typeLabel = chart.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`${className} inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-md border px-1.5 text-[12px] font-medium leading-none align-baseline shadow-sm ${isDone
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300"
            }`}
          title={chart.title}
          aria-label={`${isDone ? "Edited" : "Editing"} ${typeLabel}: ${chart.title}`}
        >
          <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border border-current/20 bg-background/70 dark:bg-black/20">
            <ChartIcon className="h-3 w-3" />
          </span>
          {isDone ? <Check className="h-3 w-3 shrink-0" /> : <Pencil className="h-3 w-3 shrink-0" />}
          <span className="shrink-0 font-semibold">{typeLabel}</span>
          <span className="min-w-0 max-w-[9rem] truncate text-foreground/70 dark:text-white/60 sm:max-w-[12rem]">
            {chart.title}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="z-[300] max-w-[min(90vw,260px)] !bg-black/90 !text-white text-xs shadow-lg break-words"
      >
        {chart.title}
      </TooltipContent>
    </Tooltip>
  );
}

function SpreadsheetMessagePreview({
  target,
  isExpanded,
  onToggle,
  onOpen,
}: {
  target: SpreadsheetPreviewTarget;
  isExpanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/80 bg-background/80 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2.5 py-2 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/60 text-muted-foreground dark:border-white/10 dark:bg-black/20 dark:text-white/70">
            <Table2 className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-xs font-semibold text-foreground dark:text-white">
                {target.ext.toUpperCase()}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground/45">-</span>
              <span className="truncate text-xs font-medium text-muted-foreground">
                {target.filename.replace(/\.[^/.]+$/, "")}
              </span>
            </div>
            <div className="text-[10px] leading-4 text-muted-foreground/70">
              Table preview
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggle}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10 dark:hover:text-white"
                aria-label={isExpanded ? "Collapse table preview" : "Expand table preview"}
              >
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isExpanded ? "Collapse table" : "Expand table"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpen}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Open full preview"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Open full preview</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <InlineCsvPreview
        assetId={target.assetId}
        variant="messagePeek"
        maxHeightClass={isExpanded ? "max-h-[340px]" : "max-h-[168px]"}
        showUnavailableState
      />
    </div>
  );
}

const ChatInterface = ({ projectId, onProcessedDataChange, onSwitchToDashboard, onShowCsvPreview, onProjectNameAccepted, onActivityOpenChange, dashboardComponents, isSidePanelOpen = false }: ChatInterfaceProps) => {
  const { resolvedTheme } = useTheme();
  const { capabilities } = useCapabilities();
  const maxFilesPerRun = capabilities.limits.max_files_per_run;
  const logoFavicon = "/logo-favicon.png";

  // Model selector state
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const { dailyDataRunLimit, creditUsage, subscription, refreshSubscription, upgradeToPro } = useSubscription();
  const tierLimit = dailyDataRunLimit;

  // Template state (controlled via store so project header can also trigger it)
  const [feedbackModal, setFeedbackModal] = useState<{ open: boolean; category: string; placeholder: string }>({ open: false, category: "", placeholder: "" });
  const [dragOver, setDragOver] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [expandedSpreadsheetPreviewIds, setExpandedSpreadsheetPreviewIds] = useState<Set<string>>(new Set());
  const [dismissedClarificationIds, setDismissedClarificationIds] = useState<Set<string>>(new Set());
  const [isDismissingClarification, setIsDismissingClarification] = useState(false);
  const [chatPaneView, setChatPaneView] = useState<"chat" | "activity">("chat");

  useEffect(() => {
    onActivityOpenChange?.(chatPaneView === "activity");

    return () => onActivityOpenChange?.(false);
  }, [chatPaneView, onActivityOpenChange]);

  // @Mention state
  // @Mention / Context Picker state
  const [isContextPickerOpen, setIsContextPickerOpen] = useState(false);
  const [pickerTriggerMode, setPickerTriggerMode] = useState<'mention' | 'button'>('mention');
  const [mentionQuery, setMentionQuery] = useState('');
  const [projectAssets, setProjectAssets] = useState<Array<{
    id: string;
    name: string;
    ext: string;
    projectId: string;
    sourceType?: string;
    asset: AssetRecord;
  }>>([]);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  // Track @mentioned asset IDs for selective processing
  const [mentionedAssetIds, setMentionedAssetIds] = useState<string[]>([]);
  // Track @mentioned charts for chart editing
  const [mentionedCharts, setMentionedCharts] = useState<ChartChipData[]>([]);

  // Zustand stores
  const {
    inputValue,
    isTyping,
    isProcessing,
    isStreamingWorkflow,
    messages,
    uploadedFiles,
    addFiles,
    removeFile,
    updateFile,
    clearFiles,
    dropdownOpen,
    selectedDataSource,
    isListening,
    detectedLanguage,
    selectedTemplate,
    isTemplatePending,
    currentWorkflowStep,
    priorWorkflowSteps,
    thinkingEvents,
    analysisSteps,
    currentConversationId,
    setThinkingEvents,
    setInputValue,
    setIsTyping,
    setMessages,
    addMessage,
    setDropdownOpen,
    setSelectedDataSource,
    setIsListening,
    setTranscript,
    setDetectedLanguage,
    setSelectedTemplate,
    sendMessage,
    clearInput,
    processFileWithMessage,
    submitClarificationResponse,
    stopGeneration,
    setGoogleSheetsModalOpen,
    setGA4ModalOpen,
    setMetaAdsModalOpen,
    setTikTokModalOpen,
    setAppsFlyerModalOpen,
    setStripeModalOpen,
    setHubSpotModalOpen,
    setSalesforceModalOpen,
    setPipedriveModalOpen,
    setSupabaseModalOpen,
    setShopifyModalOpen,
    setKlaviyoModalOpen,
    setQuickBooksModalOpen,
    setZendeskModalOpen,
    setMixpanelModalOpen,
    setPostHogModalOpen,
    setCustomerIOModalOpen,
    setGoogleSearchConsoleModalOpen,
    setAmazonSellerModalOpen,
    setTikTokShopSellerModalOpen,
    setShopeeSellerModalOpen,
    setLazadaSellerModalOpen,
    setGoogleAdsModalOpen,
    setFirebaseModalOpen,
    setAllConnectorsModalOpen,
    isTemplateModalOpen,
    setTemplateModalOpen,
    templateModalSource,
    isDashboardOpen,
    selectedModel,
    setSelectedModel,
  } = useChatStore();

  const {
    attachedCsvName,
    attachedCsvSummary,
    attachedCsvRaw,
    uploadState,
    setAttachedCsvName,
    setAttachedCsvSummary,
    setAttachedCsvRaw,
    uploadFile,
    parseCsvToSummary,
    readCsvRawPreview,
    clearAttachment,
    validateClientFile
  } = useFileStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activityStepCount = useMemo(
    () => buildActivityTimeline(thinkingEvents, analysisSteps).length,
    [analysisSteps, thinkingEvents],
  );
  const latestAssistantThinkingMessageIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const hasThinkingTrace = (message.thinkingTrace?.length ?? 0) > 0 || (message.todoTasks?.length ?? 0) > 0;
      if (message.role === 'assistant' && !message.clarificationResolution && hasThinkingTrace) {
        return index;
      }
    }
    return -1;
  }, [messages]);
  const canShowActivityEntry = Boolean(projectId && currentConversationId);
  const getActivityEntryStepCount = useCallback((message: Message) => {
    if (activityStepCount > 0) return activityStepCount;
    const traceCount = buildActivityTimeline(message.thinkingTrace, null).length;
    if (traceCount > 0) return traceCount;
    return message.todoTasks?.length ?? 0;
  }, [activityStepCount]);
  const openMessageActivity = useCallback((message: Message) => {
    onSwitchToDashboard?.(message.dashboardCard?.dashboardId);
    setIsContextPickerOpen(false);
    setDropdownOpen(false);
    setModelDropdownOpen(false);
    setChatPaneView("activity");
  }, [onSwitchToDashboard, setDropdownOpen]);

  const stagedFiles = uploadedFiles.filter((file) =>
    file.status !== 'error' &&
    (
      mentionedAssetIds.includes(file.fileID) ||
      (!file.conversationId && file.status !== 'processed')
    )
  );
  const isSendingRef = useRef<boolean>(false);
  const { toast } = useToast();
  const { user: clerkUser } = useUser();
  const userImageUrl = clerkUser?.imageUrl;
  const userInitials = (() => {
    const name = (clerkUser?.fullName || clerkUser?.firstName || clerkUser?.username || clerkUser?.primaryEmailAddress?.emailAddress || "").trim();
    if (!name) return "";
    const parts = name.split(/\s+/);
    const first = parts[0]?.[0] || "";
    const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + second).toUpperCase();
  })();

  // Derive available charts from active dashboard components
  const availableCharts = useMemo(() => {
    if (!dashboardComponents) return [];
    return dashboardComponents
      .filter(c => c.type === 'chart' || c.type === 'metric' || c.type === 'table')
      .map(c => {
        const config = c.component_config as DashboardComponentConfigPreview;
        return {
          id: config.id || c.id,
          componentId: c.id,
          title: config.title || 'Untitled',
          type: config.type || c.type,
        };
      });
  }, [dashboardComponents]);

  // Speech recognition hook
  const {
    isSupported: speechSupported,
    isListening: speechIsListening,
    detectedLanguage: speechDetectedLanguage,
    startListening,
    stopListening,
    resetTranscript,
    abortRecording,
    completeRecording
  } = useSpeechRecognition({
    onResult: (result) => {
      setInputValue(inputValue + (inputValue ? ' ' : '') + result);
      resetTranscript();
    },
    onError: (error) => {
      toast({
        title: "Speech Recognition Error",
        description: error,
        variant: "destructive",
      });
    },
    continuous: true
  });

  // Sync speech recognition state with chat store
  useEffect(() => {
    setIsListening(speechIsListening);
  }, [speechIsListening, setIsListening]);

  useEffect(() => {
    setDetectedLanguage(speechDetectedLanguage);
  }, [speechDetectedLanguage, setDetectedLanguage]);

  // (removed store token listener)

  // Also listen to a global event to open the file picker directly
  useEffect(() => {
    const handler = () => {
      fileInputRef.current?.click();
    };
    window.addEventListener('nyx:open-file-picker', handler as EventListener);
    return () => window.removeEventListener('nyx:open-file-picker', handler as EventListener);
  }, []);

  const addChartToContext = useCallback((chart: ChartChipData): boolean => {
    const normalized: ChartChipData = {
      ...chart,
      id: String(chart.id),
      componentId: String(chart.componentId),
    };
    let added = false;
    setMentionedCharts((prev) => {
      if (prev.some((c) => String(c.componentId) === normalized.componentId)) {
        return prev;
      }
      added = true;
      return [...prev, normalized];
    });
    if (!added) {
      toast({
        title: "Chart already referenced",
        description: `${chart.title} is already in context.`,
      });
    } else {
      toast({
        title: "Chart referenced",
        description: `${chart.title} added to context`,
      });
    }
    setIsContextPickerOpen(false);
    setMentionQuery("");
    return added;
  }, [toast]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<SelectChartContextDetail>).detail;
      if (!detail?.componentId) return;
      addChartToContext(detail);
      const { promptSeed } = detail;
      if (promptSeed) {
        const currentInput = useChatStore.getState().inputValue;
        setInputValue(currentInput ? `${currentInput} ${promptSeed}` : promptSeed);
      }
      requestAnimationFrame(() => {
        document.querySelector("[data-chat-root]")?.scrollIntoView({ behavior: "smooth", block: "center" });
        (document.querySelector("textarea[data-chat-input]") as HTMLTextAreaElement | null)?.focus();
      });
    };
    window.addEventListener("dreamify:select-chart-context", handler as EventListener);
    return () => window.removeEventListener("dreamify:select-chart-context", handler as EventListener);
  }, [addChartToContext, setInputValue]);

  // Eagerly fetch project assets so the "all assets" badge can display the file count
  useEffect(() => {
    if (projectId) {
      fetchProjectAssets(projectId).then(setProjectAssets);
    }
  }, [projectId]);

  useEffect(() => {
    // When the SSE workflow stream is live it is the sole source of thinking events;
    // skip the poller to avoid double-writing the same store field.
    if (!isProcessing || isStreamingWorkflow || !currentConversationId || !projectId) return;
    let cancelled = false;
    const controller = new AbortController();

    const pollThinkingEvents = async () => {
      try {
        const response = await conversationService.getWorkflowEvents(
          currentConversationId,
          projectId,
          controller.signal
        );
        if (!cancelled && response.events?.length) {
          setThinkingEvents(response.events);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Failed to poll thinking events:', error);
        }
      }
    };

    pollThinkingEvents();
    const interval = window.setInterval(pollThinkingEvents, 1500);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [currentConversationId, isProcessing, isStreamingWorkflow, projectId, setThinkingEvents]);

  // Auto-refresh project assets when uploadedFiles changes (e.g. after GA4/Sheets sync)
  useEffect(() => {
    if (projectId && stagedFiles.length > 0) {
      fetchProjectAssets(projectId).then(setProjectAssets);
    }
  }, [stagedFiles.length, projectId]);

  // Connectors array for data source dropdown
  // Shared connectors list imported above

  const escapeHtml = (unsafe: string): string =>
    unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const parseMessageToHtml = (raw: string): string => {
    let html = escapeHtml(raw);
    // ### / ## / # headings (must be at start of line)
    html = html.replace(/^(#{1,3})\s+(.+)$/gm, (_m, hashes, text) => {
      const level = hashes.length;
      const cls = level === 1
        ? 'text-base font-bold mt-3 mb-1'
        : level === 2
          ? 'text-sm font-bold mt-2 mb-1'
          : 'text-sm font-semibold mt-2 mb-0.5';
      return `<p class="${cls}">${text}</p>`;
    });
    // <https://example.com>
    html = html.replace(/&lt;(https?:\/\/[^\s>]+)&gt;/g, (_m, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline">${url}</a>`;
    });
    // [text](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline">${text}</a>`;
    });
    // **bold**
    html = html.replace(/\*\*([^*]+)\*\*/g, (_m, text) => `<strong>${text}</strong>`);
    // Autolink bare URLs
    html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)(?![^<]*>|[^<>]*<\/_a>)/g, (_m, lead, url) => {
      return `${lead}<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline">${url}</a>`;
    });
    return html;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;

      if (dropdownOpen && !target.closest('.data-source-dropdown')) {
        setDropdownOpen(false);
      }

      // Close context picker if clicked outside
      if (isContextPickerOpen && !target.closest('.project-context-picker-container') && !target.closest('.project-context-trigger') && !target.closest('.composer-add-menu')) {
        setIsContextPickerOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen, isContextPickerOpen, setDropdownOpen]);

  const handleSend = async (csvSummaryOverride?: string) => {
    if (!inputValue.trim()) return;
    if (isSendingRef.current) return;
    if (uploadedFiles.some(f => f.status === 'uploading')) {
      toast({ title: "Upload in progress", description: "Please wait for the file to finish uploading.", variant: "destructive" });
      return;
    }
    const promptFiles = getExplicitPromptFiles(uploadedFiles, mentionedAssetIds);
    const hasValidUploadedFiles = promptFiles.some(f => ['uploaded', 'processed', 'accepted'].includes(f.status));
    const hasAnalyzableUpload = promptFiles.some(
      (f) => ['uploaded', 'processed', 'accepted'].includes(f.status) && !isNonAnalyzableUpload(f),
    );
    const hasOtherContext =
      mentionedAssetIds.length > 0 || mentionedCharts.length > 0;
    if (hasValidUploadedFiles && !hasAnalyzableUpload && !hasOtherContext) {
      toast({
        title: "No data rows to analyze",
        description:
          "This attachment has column headers only. Widen the date range in Meta Ads sync, or upload a file with at least one data row.",
        variant: "destructive",
      });
      return;
    }
    isSendingRef.current = true;
    const messageContent = inputValue.trim();

    // Track Search event for each user query
    MetaPixel.track('Search', {
      search_string: messageContent.slice(0, 100),
      content_category: 'ai_query',
    });

    try {
      // Delegate adding the user message to the store's process flow to avoid duplicates
      clearInput();
      // Force clear input again after browser processes spell check
      // This handles cases where browser spell check interferes with input clearing
      setTimeout(() => {
        setInputValue('');
        // Force clear DOM element directly to handle browser spell check interference
        const textarea = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement;
        if (textarea) {
          textarea.value = '';
        }
      }, 10);

      const activeFiles = getExplicitPromptFiles(uploadedFiles, mentionedAssetIds);
      const finalMentionedIds = getExplicitPromptAssetIds(uploadedFiles, mentionedAssetIds);

      // Build chart mentions with full config for backend context
      const chartsWithConfig = mentionedCharts.map(chart => ({
        ...chart,
        config: dashboardComponents?.find(c => String(c.id) === String(chart.componentId))?.component_config,
      }));
      const hasChartMentions = chartsWithConfig.length > 0;

      // Compute attachment badge info from active files only
      // When only charts are mentioned (no files), skip the fallback "all assets" attachment
      const activeFileAttachment = buildAttachmentFromFiles(activeFiles);

      try {
        await processFileWithMessage(messageContent, onProcessedDataChange, projectId, finalMentionedIds, activeFileAttachment, hasChartMentions ? chartsWithConfig : undefined, selectedModel, refreshSubscription, onProjectNameAccepted);
      } catch (err: unknown) {
        const errObj = err as Record<string, unknown>;
        const detail = (errObj?.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        const isInsufficientCredits =
          errObj?.status === 402 ||
          (detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits' ||
          (errObj?.detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits';
        if (isInsufficientCredits) {
          refreshSubscription();
          toast({
            title: "Daily run limit reached",
            description: "This Free Preview has reached today's technical data-run quota.",
            variant: "destructive",
          });
          return;
        }
        throw err;
      }
      setMentionedAssetIds([]);
      setMentionedCharts([]);
      refreshSubscription();
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleRetry = async () => {
    if (isSendingRef.current) return;
    if (creditUsage?.can_use_credits === false) return;
    const promptFiles = getExplicitPromptFiles(uploadedFiles, mentionedAssetIds);
    const hasAnalyzableUpload = promptFiles.some(
      (f) => ['uploaded', 'processed', 'accepted'].includes(f.status) && !isNonAnalyzableUpload(f),
    );
    const hasOtherContext =
      mentionedAssetIds.length > 0 || mentionedCharts.length > 0;
    if (promptFiles.length > 0 && !hasAnalyzableUpload && !hasOtherContext) {
      toast({
        title: "No data rows to analyze",
        description:
          "This attachment has column headers only. Widen the date range in Meta Ads sync, or upload a file with at least one data row.",
        variant: "destructive",
      });
      return;
    }
    isSendingRef.current = true;
    try {
      const activeFiles = getExplicitPromptFiles(uploadedFiles, mentionedAssetIds);
      const finalMentionedIds = getExplicitPromptAssetIds(uploadedFiles, mentionedAssetIds);
      const activeFileAttachment = buildAttachmentFromFiles(activeFiles);

      await processFileWithMessage("Continue", onProcessedDataChange, projectId, finalMentionedIds, activeFileAttachment, undefined, undefined, refreshSubscription, onProjectNameAccepted);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleClarificationSubmit = async (
    message: Message,
    answers: ClarificationAnswer[],
  ) => {
    if (!projectId || answers.length === 0) return;
    await submitClarificationResponse(
      answers,
      projectId,
      onProcessedDataChange,
      selectedModel,
      refreshSubscription,
      onProjectNameAccepted,
    );
    refreshSubscription();
  };

  const handleClarificationDismiss = async (message: Message) => {
    const requests = message.clarificationRequests ?? [];
    if (!projectId || !currentConversationId || requests.length === 0) {
      toast({
        title: "Unable to dismiss",
        description: "Conversation context is missing. Please refresh and try again.",
        variant: "destructive",
      });
      return;
    }

    setIsDismissingClarification(true);
    // The edit was abandoned — drop the in-flight edit context and the per-chart
    // "Applying your change…" shimmer so it doesn't linger on the dashboard.
    useChatStore.getState().clearApplyingComponentIds();
    useChatStore.getState().setPendingEdit(null);
    try {
      // Each batched question is dismissed individually; the first call also
      // stops the pending workflow, the rest just persist no-answer responses.
      for (const request of requests) {
        await conversationService.dismissClarification(
          currentConversationId,
          projectId,
          request.clarification_id,
        );
      }
      setDismissedClarificationIds((current) => {
        const next = new Set(current);
        requests.forEach((request) => next.add(request.clarification_id));
        return next;
      });
      const firstRequest = requests[0];
      setMessages(messages.map((currentMessage) => (
        currentMessage.id === message.id
          ? {
            ...currentMessage,
            clarificationResolution: {
              clarification_id: firstRequest.clarification_id,
              status: "no_answer",
              question: firstRequest.question,
              resolved_at: new Date().toISOString(),
            },
          }
          : currentMessage
      )));

      try {
        const conversationResponse = await conversationService.loadConversation(currentConversationId, projectId);
        const restoredMessages = conversationNodesToMessages(conversationResponse.conversation);
        if (restoredMessages.length) {
          setMessages(restoredMessages);
        }
      } catch (reloadError) {
        console.warn("Clarification dismissed, but conversation reload failed:", reloadError);
      }
    } catch (error) {
      toast({
        title: "Dismiss failed",
        description: error instanceof Error ? error.message : "Unable to dismiss the question.",
        variant: "destructive",
      });
    } finally {
      setIsDismissingClarification(false);
    }
  };

  const handleAssetSelect = async (selectedAsset: {
    id: string;
    name: string;
    ext: string;
    projectId: string;
    asset: AssetRecord;
  }) => {
    try {
      // We already have full asset data from fetchProjectAssets
      // No need to fetch again - use existing data
      const assetData = selectedAsset.asset;

      // Convert to UploadedFile format
      // Status is 'uploaded' because file exists in project and is ready for processing
      // isFromMention: true indicates this file was selected from @mention dropdown (already exists in conversation)
      // Derive sourceType from asset_type or filename pattern
      const assetType = assetData?.asset_type || '';
      const sourceType = normalizeConnectorSource(assetType)?.name;

      const newFile: UploadedFile = {
        fileID: assetData.asset_id,
        filename: assetData.filename,
        size: assetData.size_bytes,
        ext: assetData.extension.toLowerCase(),
        status: 'uploaded' as const,
        projectId: assetData.project_id,
        rowCount: assetData.row_count,
        columnCount: assetData.column_count,
        isFromMention: true,
        sourceType,
        schemaOnly: Boolean(sourceType) && assetData.row_count === 0,
        // Since it's from project assets, we might not have account/property name in metadata,
        // but sourceType alone will fix "CSV" label showing as "GA4 Data".
      };

      const alreadyAdded = uploadedFiles.some(f => f.fileID === assetData.asset_id);
      if (!alreadyAdded && uploadedFiles.length >= maxFilesPerRun) {
        toast({
          title: "Maximum files reached",
          description: `You can only add up to ${maxFilesPerRun} files at a time.`,
          variant: "destructive"
        });
        setIsContextPickerOpen(false);
        return;
      }

      if (!alreadyAdded) {
        addFiles([newFile]);
      }
      // Track this asset as @mentioned for selective processing
      setMentionedAssetIds(prev =>
        prev.includes(assetData.asset_id) ? prev : [...prev, assetData.asset_id]
      );

      // Remove @mention text from input ONLY if we are in mention mode
      if (pickerTriggerMode === 'mention') {
        const textBeforeCursor = inputValue.slice(0, mentionCursorPos);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        if (lastAtIndex !== -1) {
          const textAfterMention = inputValue.slice(mentionCursorPos);
          const newText = inputValue.slice(0, lastAtIndex) + textAfterMention;
          setInputValue(newText);
        }
      }

      // Hide dropdown
      setIsContextPickerOpen(false);
      setMentionQuery('');

      toast({
        title: "File added to context",
        description: `${selectedAsset.name} is now available for analysis`,
      });
    } catch (error) {
      console.error('Failed to add asset:', error);
      toast({
        title: "Failed to add file",
        description: "Could not load the selected file",
        variant: "destructive",
      });
    }
  };

  const handleChartSelect = (chart: ChartChipData) => {
    const added = addChartToContext(chart);
    if (added && pickerTriggerMode === "mention") {
      const textBeforeCursor = inputValue.slice(0, mentionCursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");
      if (lastAtIndex !== -1) {
        const textAfterMention = inputValue.slice(mentionCursorPos);
        const newText = inputValue.slice(0, lastAtIndex) + textAfterMention;
        setInputValue(newText);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = getFilesFromClipboardData(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (uploadedFiles.length + files.length > maxFilesPerRun) {
      toast({
        title: "Too many files",
        description: `Maximum ${maxFilesPerRun} files allowed. You can add ${Math.max(maxFilesPerRun - uploadedFiles.length, 0)} more file(s).`,
        variant: "destructive"
      });
      return;
    }
    let batchProjectId = projectId || uploadedFiles.find((file) => file.projectId)?.projectId;
    for (const file of files) {
      const uploadedProjectId = await processFileUpload(file, batchProjectId);
      if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
    }
  };

  const processFileUpload = async (file: File, projectIdOverride?: string): Promise<string | undefined> => {
    const validationError = validateClientFile(file);
    if (validationError) {
      toast({ title: "Upload error", description: validationError, variant: "destructive" });
      return undefined;
    }
    const tempId = `pending-${Date.now()}-${Math.random()}`;
    try {
      // Detect sourceType based on filename pattern
      let sourceType: string | undefined;
      if (file.name.startsWith('google_analytics')) sourceType = 'GA4';
      else if (file.name.startsWith('google_sheet')) sourceType = 'Google Sheets';

      const newFile = {
        fileID: tempId,
        filename: file.name,
        size: file.size,
        ext: (file.name.split('.').pop() || '').toLowerCase(),
        status: 'uploading' as const,
        uploadProgress: 0,
        sourceType
      };

      if (uploadedFiles.length >= maxFilesPerRun) {
        toast({
          title: "Maximum files reached",
          description: `You can only upload up to ${maxFilesPerRun} files at a time.`,
          variant: "destructive"
        });
        return undefined;
      }
      addFiles([newFile]);

      const res: UploadResponse = await fileService.uploadFile(file, {
        projectId: projectIdOverride || projectId || undefined,
        onProgress: (percent) => updateFile(tempId, { uploadProgress: Math.min(percent, 95) }),
      });
      if (!res.success || !res.fileID || res.asset?.status !== 'uploaded') {
        removeFile(tempId);
        addFiles([{ ...newFile, status: 'error', uploadProgress: undefined }]);
        toast({
          title: "Upload failed",
          description: res.error || `Unexpected upload status: ${res.asset?.status ?? 'unknown'}`,
          variant: "destructive"
        });
        return undefined;
      }

      const fallbackFilename = res.filename ?? file.name;
      const fallbackSize = res.size ?? file.size;
      const fallbackExt = res.ext || (file.name.split('.').pop() || '').toLowerCase();
      const uploadedProjectId = res.asset?.project_id || projectIdOverride || projectId;

      removeFile(tempId);
      addFiles([{
        fileID: res.fileID,
        filename: fallbackFilename,
        size: fallbackSize,
        ext: fallbackExt,
        status: 'uploaded',
        projectId: uploadedProjectId,
        rowCount: res.rowCount,
        columnCount: res.columnCount,
        sourceType
      }]);
      try {
        // Persist original file for CSV export if it's CSV
        if ((file.name.split('.').pop() || '').toLowerCase() === 'csv') {
          const { useChatStore } = await import('@/chat/useChatStore');
          useChatStore.getState().setOriginalFile({ blob: file, name: file.name });
        } else {
          const { useChatStore } = await import('@/chat/useChatStore');
          useChatStore.getState().setOriginalFile(null);
        }
      } catch {
        /* ignore original-file capture failure */
      }

      toast({ title: "File uploaded", description: `${res.filename} uploaded successfully. You can now ask questions about your data.` });
      return uploadedProjectId;

    } catch (_e) {
      removeFile(tempId);
      addFiles([{
        fileID: 'error',
        filename: file.name,
        size: file.size,
        ext: (file.name.split('.').pop() || '').toLowerCase(),
        status: 'error'
      }]);
      toast({ title: "Upload error", description: "Failed to upload file. Please try again.", variant: "destructive" });
      return undefined;
    }
  };

  // Listen for document-level drag events to detect file dragging
  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      // Only track file drags
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        setIsDragging(false);
        setDragOver(false);
      }
    };

    const handleDragEnd = () => {
      dragCounter = 0;
      setIsDragging(false);
      setDragOver(false);
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('drop', handleDragEnd);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragend', handleDragEnd);
      document.removeEventListener('drop', handleDragEnd);
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget === e.target) {
      setDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    if (uploadedFiles.length + files.length > maxFilesPerRun) {
      toast({
        title: "Too many files",
        description: `Maximum ${maxFilesPerRun} files allowed. You can add ${Math.max(maxFilesPerRun - uploadedFiles.length, 0)} more file(s).`,
        variant: "destructive"
      });
      return;
    }
    let batchProjectId = projectId || uploadedFiles.find((file) => file.projectId)?.projectId;
    for (const file of files) {
      const uploadedProjectId = await processFileUpload(file, batchProjectId);
      if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
    }
  };

  const handleDataSourceSelect = (source: string) => {
    setSelectedDataSource(source);
    setDropdownOpen(false);
    console.log('Data source selected:', source);
  };

  const handleIntegrationClick = (connector: ConnectorItem) => {
    const connectorKey = connector.connectorKey
      ?? CONNECTORS.find((candidate) => candidate.name === connector.name)?.connectorKey;
    const availability = connectorCapability(capabilities, connectorKey);
    if (!availability.enabled) {
      setDropdownOpen(false);
      toast({
        title: `${connector.name} is unavailable`,
        description: availability.reason ?? "This connector has not been certified for the Hobby demo.",
      });
      return;
    }
    if (connector.name === 'GA4') {
      setDropdownOpen(false);
      setTimeout(() => setGA4ModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Google Sheets') {
      setDropdownOpen(false);
      setTimeout(() => setGoogleSheetsModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Meta Ads') {
      setDropdownOpen(false);
      setTimeout(() => setMetaAdsModalOpen(true), 0);
      return;
    }
    if (connector.name === 'TikTok Ads') {
      setDropdownOpen(false);
      setTimeout(() => setTikTokModalOpen(true), 0);
      return;
    }
    if (connector.name === 'AppsFlyer') {
      setDropdownOpen(false);
      setTimeout(() => setAppsFlyerModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Stripe') {
      setDropdownOpen(false);
      setTimeout(() => setStripeModalOpen(true), 0);
      return;
    }
    if (connector.name === 'HubSpot') {
      setDropdownOpen(false);
      setTimeout(() => setHubSpotModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Salesforce') {
      setDropdownOpen(false);
      setTimeout(() => setSalesforceModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Pipedrive') {
      setDropdownOpen(false);
      setTimeout(() => setPipedriveModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Supabase') {
      setDropdownOpen(false);
      setTimeout(() => setSupabaseModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Shopify') {
      setDropdownOpen(false);
      setTimeout(() => setShopifyModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Klaviyo') {
      setDropdownOpen(false);
      setTimeout(() => setKlaviyoModalOpen(true), 0);
      return;
    }
    if (connector.name === 'QuickBooks') {
      setDropdownOpen(false);
      setTimeout(() => setQuickBooksModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Zendesk') {
      setDropdownOpen(false);
      setTimeout(() => setZendeskModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Mixpanel') {
      setDropdownOpen(false);
      setTimeout(() => setMixpanelModalOpen(true), 0);
      return;
    }
    if (connector.name === 'PostHog') {
      setDropdownOpen(false);
      setTimeout(() => setPostHogModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Customer.io') {
      setDropdownOpen(false);
      setTimeout(() => setCustomerIOModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Google Search Console') {
      setDropdownOpen(false);
      setTimeout(() => setGoogleSearchConsoleModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Amazon Seller') {
      setDropdownOpen(false);
      setTimeout(() => setAmazonSellerModalOpen(true), 0);
      return;
    }
    if (connector.name === 'TikTok Shop Seller') {
      setDropdownOpen(false);
      setTimeout(() => setTikTokShopSellerModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Shopee Seller') {
      setDropdownOpen(false);
      setTimeout(() => setShopeeSellerModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Lazada Seller') {
      setDropdownOpen(false);
      setTimeout(() => setLazadaSellerModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Google Ads') {
      setDropdownOpen(false);
      setTimeout(() => setGoogleAdsModalOpen(true), 0);
      return;
    }
    if (connector.name === 'Firebase') {
      setDropdownOpen(false);
      setTimeout(() => setFirebaseModalOpen(true), 0);
      return;
    }
    if (connector.isActive) {
      handleDataSourceSelect(connector.name);
    } else {
      toast({
        title: `${connector.name}`,
        description: "Integration is coming soon!",
      });
    }
    setDropdownOpen(false);
  };

  const handleCloneTemplateClick = () => {
    setTemplateModalOpen(true);
  };

  const handleAddProjectContextClick = () => {
    setPickerTriggerMode('button');
    setMentionQuery('');
    setModelDropdownOpen(false);
    setDropdownOpen(false);

    window.setTimeout(() => {
      setIsContextPickerOpen(true);
      if (projectId && projectAssets.length === 0) {
        if (projectId) fetchProjectAssets(projectId).then(setProjectAssets);
      }
    }, 0);
  };

  const getDataSourceColors = (sourceName: string) => {
    const colors: { [key: string]: { bg: string; border: string; text: string; hover: string } } = {
      "Google Sheets": { bg: "bg-green-500", border: "border-green-400", text: "text-white", hover: "hover:bg-green-600" },
      "GA4": { bg: "bg-orange-500", border: "border-orange-400", text: "text-white", hover: "hover:bg-orange-600" },
      "Meta": { bg: "bg-blue-600", border: "border-blue-500", text: "text-white", hover: "hover:bg-blue-700" },
      "TikTok": { bg: "bg-zinc-900", border: "border-zinc-800", text: "text-white", hover: "hover:bg-black" },
      "Airtable": { bg: "bg-blue-400", border: "border-blue-300", text: "text-white", hover: "hover:bg-blue-500" },
      "Stripe": { bg: "bg-purple-600", border: "border-purple-500", text: "text-white", hover: "hover:bg-purple-700" },
      "Shopify": { bg: "bg-green-700", border: "border-green-600", text: "text-white", hover: "hover:bg-green-800" },
      "Klaviyo": { bg: "bg-neutral-900", border: "border-neutral-800", text: "text-white", hover: "hover:bg-black" },
      "QuickBooks": { bg: "bg-[#2CA01C]", border: "border-[#228B16]", text: "text-white", hover: "hover:bg-[#228B16]" },
      "Zendesk": { bg: "bg-[#03363D]", border: "border-[#022D33]", text: "text-white", hover: "hover:bg-[#022D33]" },
      "Mixpanel": { bg: "bg-[#111111]", border: "border-[#7856FF]", text: "text-white", hover: "hover:bg-black" },
      "PostHog": { bg: "bg-[#F9BD2B]", border: "border-[#DFA51E]", text: "text-black", hover: "hover:bg-[#EAB224]" },
      "Amazon Seller": { bg: "bg-[#FF9900]", border: "border-[#E88A00]", text: "text-black", hover: "hover:bg-[#F2A900]" },
      "TikTok Shop Seller": { bg: "bg-zinc-950", border: "border-[#25F4EE]", text: "text-white", hover: "hover:bg-black" },
      "HubSpot": { bg: "bg-orange-600", border: "border-orange-500", text: "text-white", hover: "hover:bg-orange-700" },
      "Salesforce": { bg: "bg-sky-600", border: "border-sky-500", text: "text-white", hover: "hover:bg-sky-700" },
      "Pipedrive": { bg: "bg-emerald-700", border: "border-emerald-600", text: "text-white", hover: "hover:bg-emerald-800" },
      "Supabase": { bg: "bg-teal-700", border: "border-teal-600", text: "text-white", hover: "hover:bg-teal-800" },
      "PostgreSQL": { bg: "bg-blue-700", border: "border-blue-600", text: "text-white", hover: "hover:bg-blue-800" },
      "BigQuery": { bg: "bg-sky-600", border: "border-sky-500", text: "text-white", hover: "hover:bg-sky-700" },
      "Snowflake": { bg: "bg-cyan-600", border: "border-cyan-500", text: "text-white", hover: "hover:bg-cyan-700" },
      "Databricks": { bg: "bg-red-600", border: "border-red-500", text: "text-white", hover: "hover:bg-red-700" }
    };
    return colors[sourceName] || { bg: "bg-primary", border: "border-primary", text: "text-white", hover: "hover:bg-primary/90" };
  };

  const handleTemplateSelect = (template: ThemeSelection) => {
    if (templateModalSource === 'header') {
      // Header entry point: apply the visual theme to the current dashboard but don't
      // show the chip or pre-fill the input (no pre-submit flow needed).
      setSelectedTemplate(template, false);
      return;
    }
    // Toolbar entry point: pre-submit flow — show chip + pre-fill input.
    setSelectedTemplate(template);
    setInputValue(`Use ${template.title} theme to make `);
  };

  const handleTemplateRemove = () => {
    setSelectedTemplate(null);
    setInputValue('');
  };

  const handleMicClick = () => {
    if (!speechSupported) {
      toast({
        title: "Not Supported",
        description: "Speech recognition is not supported in your browser",
        variant: "destructive",
      });
      return;
    }

    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleRecordingCancel = () => {
    abortRecording();
  };

  const handleRecordingConfirm = () => {
    completeRecording();
    resetTranscript();
  };


  const removeUploadedFile = async (fileID: string) => {
    const file = uploadedFiles.find(f => f.fileID === fileID);
    if (file && !file.isFromMention) {
      try {
        await fileService.deleteFile(fileID);
        if (projectId) fetchProjectAssets(projectId).then(setProjectAssets);
      } catch (_e) {
        // best-effort; ignore
      }
    }
    removeFile(fileID);
    setMentionedAssetIds(prev => prev.filter(id => id !== fileID));
  };

  const suggestedPrompts = [
    { text: "Visualize key trends over time in an interactive dashboard.", icon: Database },
    { text: "Spot anomalies and outliers directly in your dashboard.", icon: TrendingUp },
    { text: "Generate a dashboard of my most important metrics.", icon: BarChart3 },
    { text: "Build a comprehensive dashboard from my uploaded files.", icon: Users },
  ];
  const compactComposer = isSidePanelOpen;
  const composerTokenDescriptors: MetadataTokenDescriptor[] = [];
  if (selectedTemplate && isTemplatePending) {
    composerTokenDescriptors.push({
      id: "composer-theme",
      kind: "theme",
      priority: 0,
      renderInline: () => (
        <ThemeInlineToken
          theme={selectedTemplate}
          variant="composer"
          onRemove={handleTemplateRemove}
          className="animate-in fade-in slide-in-from-left-2 duration-300"
        />
      ),
      renderOverflow: () => (
        <ThemeInlineToken
          theme={selectedTemplate}
          variant="composer"
          onRemove={handleTemplateRemove}
        />
      ),
    });
  }
  stagedFiles.forEach((file, index) => {
    composerTokenDescriptors.push({
      id: `composer-data-${file.fileID || index}`,
      kind: "data",
      priority: 10 + index,
      renderInline: () => (
        <FilePreviewChip
          file={file}
          onRemove={() => removeUploadedFile(file.fileID)}
        />
      ),
      renderOverflow: () => (
        <FilePreviewChip
          file={file}
          onRemove={() => removeUploadedFile(file.fileID)}
        />
      ),
    });
  });
  mentionedCharts.forEach((chart, index) => {
    composerTokenDescriptors.push({
      id: `composer-chart-${chart.componentId}-${index}`,
      kind: "chart",
      priority: 100 + index,
      renderInline: () => (
        <ChartPreviewChip
          chart={chart}
          onRemove={() => setMentionedCharts(prev => prev.filter(c => c.componentId !== chart.componentId))}
        />
      ),
      renderOverflow: () => (
        <ChartPreviewChip
          chart={chart}
          onRemove={() => setMentionedCharts(prev => prev.filter(c => c.componentId !== chart.componentId))}
        />
      ),
    });
  });
  const { visibleTokens: visibleComposerTokens, overflowTokens: overflowComposerTokens } = splitMetadataTokens(
    composerTokenDescriptors,
    compactComposer ? COMPACT_COMPOSER_VISIBLE_TOKEN_COUNT : FULL_COMPOSER_VISIBLE_TOKEN_COUNT,
  );
  const pendingClarificationMessage = useMemo(
    () => getLatestPendingClarificationMessage(messages, dismissedClarificationIds),
    [messages, dismissedClarificationIds],
  );
  const pendingClarificationId = pendingClarificationMessage?.clarificationRequests?.[0]?.clarification_id ?? null;
  const pendingClarificationUserIndex = useMemo(() => {
    if (!pendingClarificationMessage) return -1;
    const clarificationIndex = messages.findIndex((message) => message.id === pendingClarificationMessage.id);
    for (let index = clarificationIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") return index;
    }
    return -1;
  }, [messages, pendingClarificationMessage]);

  useEffect(() => {
    if (!pendingClarificationId) return;
    setIsContextPickerOpen(false);
    setDropdownOpen(false);
    setModelDropdownOpen(false);
    setIsDragging(false);
  }, [pendingClarificationId, setDropdownOpen]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-muted">
      {chatPaneView === "activity" ? (
        <Suspense fallback={null}>
          <ActivityPanel
            variant="embedded"
            onClose={() => setChatPaneView("chat")}
          />
        </Suspense>
      ) : (
        <>

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-4 chat-scrollbar-hide">
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const isSystem = message.role === "system";
          const bubbleLayoutClass = isUser ? "flex-row-reverse" : "flex-row";
          const bubbleBgClass = isUser
            ? "bg-muted dark:bg-black p-3 border border-border dark:border-white/10"
            : isSystem
              ? "bg-muted/50 dark:bg-white/5 p-3 border border-border dark:border-white/10"
              : "bg-transparent p-0";
          const isAssistant = !isUser && !isSystem;
          const messageGap = "gap-2";
          // Keep artifacts on a wider rail, but constrain prose so chat text wraps at a readable length.
          const ARTIFACT_RAIL_MAX = isSidePanelOpen ? "max-w-full" : "max-w-[760px]";
          const TEXT_RAIL_MAX = isSidePanelOpen ? "max-w-full" : "max-w-[38rem]";
          const messageWidthClass = isAssistant && !isSidePanelOpen ? `w-full ${ARTIFACT_RAIL_MAX}` : TEXT_RAIL_MAX;
          const bubbleWidthClass = isAssistant && !isSidePanelOpen ? "flex-1" : "";
          const textContentWidthClass = TEXT_RAIL_MAX;
          const canCopyMessage = Boolean(message.content && !message.isError);
          const copyMessage = () => {
            if (!message.content) return;
            navigator.clipboard.writeText(message.content);
            toast({ title: "Copied", description: "Message copied to clipboard" });
          };
          const inlineDataSources = isUser ? getAttachmentTokenSources(message.attachment) : [];
          const getDataTokenOpenHandler = (source: DataContextTokenSource) => {
            const assetId = source.id || projectAssets.find(asset => asset.name === (source.filename || source.name))?.id;
            const fileName = source.filename || source.name || "";
            if (!assetId || !fileName) return undefined;
            return () => {
              if (onShowCsvPreview) {
                onShowCsvPreview(assetId, fileName);
              } else {
                window.open(`/preview/${assetId}`, "_blank");
              }
            };
          };
          const messageTokenDescriptors: MetadataTokenDescriptor[] = [];
          if (isUser && message.template) {
            messageTokenDescriptors.push({
              id: `theme-${message.id}`,
              kind: "theme",
              priority: 0,
              renderInline: () => <ThemeInlineToken theme={message.template!} className="mr-1.5" />,
              renderOverflow: () => <ThemeInlineToken theme={message.template!} />,
            });
          }
          if (isUser) {
            inlineDataSources.forEach((source, sourceIndex) => {
              const tokenId = `${source.id || source.filename || source.name || "data"}-${sourceIndex}`;
              messageTokenDescriptors.push({
                id: `data-${tokenId}`,
                kind: "data",
                priority: 10 + sourceIndex,
                renderInline: () => (
                  <DataContextInlineToken
                    source={source}
                    status={source.schemaOnly ? "schemaOnly" : source.status}
                    onOpen={getDataTokenOpenHandler(source)}
                    className="mr-1.5"
                  />
                ),
                renderOverflow: () => (
                  <DataContextInlineToken
                    source={source}
                    status={source.schemaOnly ? "schemaOnly" : source.status}
                    onOpen={getDataTokenOpenHandler(source)}
                  />
                ),
              });
            });
          }
          if (isUser) {
            const msgIndex = messages.findIndex(m => m.id === message.id);
            const nextMsg = msgIndex >= 0 ? messages[msgIndex + 1] : undefined;
            message.chartMentions?.forEach((chart, chartIndex) => {
              messageTokenDescriptors.push({
                id: `chart-${chart.componentId}-${chartIndex}`,
                kind: "chart",
                priority: 100 + chartIndex,
                renderInline: () => (
                  <ChartMentionInlineToken
                    chart={chart}
                    isDone={nextMsg?.role === 'assistant'}
                  />
                ),
                renderOverflow: () => (
                  <ChartMentionInlineToken
                    chart={chart}
                    isDone={nextMsg?.role === 'assistant'}
                    className=""
                  />
                ),
              });
            });
          }
          const { visibleTokens: visibleMessageTokens, overflowTokens: overflowMessageTokens } = splitMetadataTokens(
            messageTokenDescriptors,
            MESSAGE_VISIBLE_TOKEN_COUNT,
          );
          const spreadsheetPreviewTarget = isUser
            ? getSpreadsheetPreviewTarget(message.attachment, projectAssets)
            : null;
          const isSpreadsheetPreviewExpanded = spreadsheetPreviewTarget
            ? expandedSpreadsheetPreviewIds.has(message.id)
            : false;
          const toggleSpreadsheetPreview = () => {
            setExpandedSpreadsheetPreviewIds((prev) => {
              const next = new Set(prev);
              if (next.has(message.id)) next.delete(message.id);
              else next.add(message.id);
              return next;
            });
          };
          const openSpreadsheetPreview = () => {
            if (!spreadsheetPreviewTarget) return;
            if (onShowCsvPreview) {
              onShowCsvPreview(spreadsheetPreviewTarget.assetId, spreadsheetPreviewTarget.filename);
            } else {
              window.open(`/preview/${spreadsheetPreviewTarget.assetId}`, "_blank");
            }
          };
          return (
            <div key={message.id} className="space-y-1">
              <div
                className={`group/message chat-enter flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div className={`${messageWidthClass} min-w-0 flex ${messageGap} ${bubbleLayoutClass}`}>
                  {isUser ? (
                    <Avatar className="w-7 h-7 flex-shrink-0 ring-1 ring-white/10 dark:ring-white/15 shadow-sm">
                      {userImageUrl ? <AvatarImage src={userImageUrl} alt="You" /> : null}
                      <AvatarFallback className="bg-gradient-to-br from-slate-700 to-slate-900 dark:from-zinc-700 dark:to-black text-white text-[10px] font-semibold tracking-wide">
                        {userInitials || <User className="w-3.5 h-3.5 text-white/90" />}
                      </AvatarFallback>
                    </Avatar>
                  ) : isSystem ? (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-muted dark:bg-white/10 border border-border dark:border-white/20">
                      <span className="text-[9px] font-semibold tracking-wide uppercase text-muted-foreground dark:text-white/70">
                        SYS
                      </span>
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-transparent">
                      <img src={logoFavicon} alt="Dreamify" className="h-6 w-6 object-contain" />
                    </div>
                  )}

                  <div className={`min-w-0 max-w-full rounded-xl text-sm whitespace-pre-wrap break-words overflow-hidden ${bubbleWidthClass} ${bubbleBgClass}`}>
                    {/* Attachment badge (file) — hide full badge when chart mentions are present (compact version shown below instead) */}
                    {!isUser && message.attachment && !message.chartMentions?.length && (
                      <div className="mb-2">
                        {(() => {
                          const sType = message.attachment.sourceType || '';
                          const isMultiple = sType === 'Multiple';
                          const isGA4 = !isMultiple && (sType.includes('GA4') || sType.includes('Google Analytics') || sType.includes('integration_ga4') || sType.toLowerCase().includes('google_analytics'));
                          const isSheets = !isMultiple && (sType.includes('Google Sheets') || sType.includes('gsheets') || sType.includes('integration_gsheets') || sType.toLowerCase().includes('google_sheet'));
                          const isMeta = !isMultiple && (sType.includes('Meta Ads') || sType.includes('meta_ads'));
                          const isTikTok = !isMultiple && (sType.includes('TikTok') || sType.includes('tiktok') || sType.includes('integration_tiktok'));
                          const isGoogleAds = !isMultiple && sType.includes('Google Ads');
                          const isFirebase = !isMultiple && sType.includes('Firebase');
                          const isAppsFlyer = !isMultiple && (sType.includes('AppsFlyer') || sType.includes('appsflyer'));
                          const isStripe = !isMultiple && sType.includes('Stripe');

                          const displayName = isMultiple ? "Multiple Data Sources"
                            : isGA4 ? "Google Analytics 4"
                              : isSheets ? "Google Sheets"
                                : isMeta ? "Meta Ads"
                                  : isTikTok ? "TikTok Ads"
                                    : isGoogleAds ? "Google Ads"
                                      : isFirebase ? "Firebase"
                                        : isAppsFlyer ? "AppsFlyer"
                                          : isStripe ? "Stripe"
                                            : "Attached Data";

                          const logoBg = isMultiple ? "bg-indigo-500/10"
                            : isGA4 ? "bg-orange-500/10"
                              : isSheets ? "bg-green-500/10"
                                : isMeta ? "bg-blue-500/10"
                                  : isTikTok ? "bg-black/10 dark:bg-black/20"
                                    : isGoogleAds ? "bg-[#4285F4]/10"
                                      : isFirebase ? "bg-[#FFA000]/10"
                                        : isAppsFlyer ? "bg-muted dark:bg-white/5"
                                          : isStripe ? "bg-[#6772E5]/10"
                                            : "bg-muted dark:bg-white/10";

                          const connector = isMultiple ? undefined : CONNECTORS.find(c => {
                            if (isGA4 && c.name === 'GA4') return true;
                            if (isSheets && c.name === 'Google Sheets') return true;
                            if (isMeta && c.name === 'Meta Ads') return true;
                            if (isTikTok && c.name === 'TikTok Ads') return true;
                            if (isGoogleAds && c.name === 'Google Ads') return true;
                            if (isFirebase && c.name === 'Firebase') return true;
                            if (isAppsFlyer && c.name === 'AppsFlyer') return true;
                            if (isStripe && c.name === 'Stripe') return true;
                            return false;
                          });
                          const icon = connector?.icon;

                          let secondaryText = "";
                          if (isMultiple) {
                            secondaryText = message.attachment.name;
                          } else if (isGA4) {
                            secondaryText = message.attachment.propertyName || message.attachment.accountName || message.attachment.name.replace(/\.[^/.]+$/, "");
                          } else if (isSheets) {
                            secondaryText = message.attachment.name.replace(/\.[^/.]+$/, "");
                          } else if (isMeta || isTikTok || isGoogleAds || isFirebase || isAppsFlyer || isStripe) {
                            secondaryText = message.attachment.accountName || message.attachment.name.replace(/\.[^/.]+$/, "");
                          } else {
                            secondaryText = message.attachment.name.replace(/\.[^/.]+$/, "");
                          }
                          const syncVersionLabel = message.attachment.syncVersionName?.trim();
                          if (!isMultiple && syncVersionLabel) {
                            secondaryText = secondaryText ? `${secondaryText} - ${syncVersionLabel}` : syncVersionLabel;
                          }
                          const isIntegration = isGA4 || isSheets || isMeta || isTikTok || isGoogleAds || isFirebase || isAppsFlyer || isStripe;
                          const matchedAsset = projectAssets.find(a => a.name === message.attachment?.name);
                          const isCsvOrExcel = !isIntegration && !isMultiple && (
                            /\.(csv|xlsx|xls)$/i.test(message.attachment.name) ||
                            message.attachment.kind === 'csv'
                          );
                          const openPreview = () => {
                            if (!matchedAsset) return;
                            if (onShowCsvPreview) {
                              onShowCsvPreview(matchedAsset.id, message.attachment!.name);
                            } else {
                              window.open(`/preview/${matchedAsset.id}`, '_blank');
                            }
                          };
                          const attachmentFiles: AttachmentFileItem[] = message.attachment.files?.length
                            ? message.attachment.files
                            : isMultiple
                              ? projectAssets.map((asset) => ({
                                id: asset.id,
                                name: asset.name,
                                ext: asset.ext,
                                sourceType: asset.sourceType,
                              }))
                              : [];
                          const isMultiExpanded = expandedMessageIds.has(message.id);
                          const toggleMultiExpanded = () => {
                            setExpandedMessageIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(message.id)) next.delete(message.id);
                              else next.add(message.id);
                              return next;
                            });
                          };
                          const openAttachmentFilePreview = (file: AttachmentFileItem) => {
                            if (!file.id) return;
                            if (onShowCsvPreview) {
                              onShowCsvPreview(file.id, file.name);
                            } else {
                              window.open(`/preview/${file.id}`, '_blank');
                            }
                          };

                          if (isCsvOrExcel) {
                            return (
                              <div className="overflow-hidden rounded-lg border border-border dark:border-white/10 bg-card dark:bg-white/5 shadow-sm max-w-full">
                                {/* Card header */}
                                <div className="flex items-center gap-3 px-3 py-2.5">
                                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md p-2 ${logoBg}`}>
                                    <Database className="h-4 w-4 text-emerald-400" />
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                                    <span className="truncate text-sm font-medium text-foreground dark:text-white">
                                      {displayName}
                                    </span>
                                    {secondaryText && (
                                      <span className="mt-0.5 truncate text-xs text-muted-foreground dark:text-gray-400">
                                        {secondaryText}
                                      </span>
                                    )}
                                  </div>
                                  {matchedAsset && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          onClick={openPreview}
                                          className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10 dark:hover:text-white outline-none"
                                        >
                                          <Maximize2 className="h-3.5 w-3.5" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="top"
                                        sideOffset={6}
                                        className="z-[300] !bg-black/90 !text-white text-xs shadow-lg"
                                      >
                                        Open full preview
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                                {/* Inline CSV/Excel data preview */}
                                {matchedAsset && (
                                  <InlineCsvPreview assetId={matchedAsset.id} />
                                )}
                              </div>
                            );
                          }

                          if (isMultiple) {
                            return (
                              <div className="overflow-hidden rounded-lg border border-border dark:border-white/10 bg-card dark:bg-white/5 text-foreground dark:text-white/90 shadow-sm max-w-full">
                                <button
                                  type="button"
                                  onClick={toggleMultiExpanded}
                                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-all hover:bg-muted dark:hover:bg-white/10 outline-none"
                                  aria-expanded={isMultiExpanded}
                                >
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md p-2 ${logoBg}`}>
                                    <Database className="h-5 w-5 text-emerald-400" />
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                                    <span className="truncate text-sm font-medium text-foreground dark:text-white">
                                      {displayName}
                                    </span>
                                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground dark:text-gray-400">
                                      <span className="min-w-0 truncate">{secondaryText}</span>
                                      {isMultiExpanded ? (
                                        <ChevronUp className="ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                      ) : (
                                        <ChevronDown className="ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                      )}
                                    </span>
                                  </div>
                                </button>

                                {isMultiExpanded && (
                                  <div className="border-t border-border/60 dark:border-white/10 py-1">
                                    {attachmentFiles.length === 0 ? (
                                      <div className="px-3 py-2 text-xs text-muted-foreground">
                                        No file details available.
                                      </div>
                                    ) : (
                                      attachmentFiles.map((file) => (
                                        <button
                                          key={file.id || file.name}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openAttachmentFilePreview(file);
                                          }}
                                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted dark:hover:bg-white/10 outline-none"
                                        >
                                          <FileText className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs font-medium text-foreground dark:text-white">
                                              {file.name}
                                            </div>
                                            {file.sourceType && (
                                              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                                {file.sourceType}
                                              </div>
                                            )}
                                          </div>
                                        </button>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={openPreview}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') openPreview();
                                  }}
                                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border dark:border-white/10 bg-card dark:bg-white/5 px-3 py-2.5 text-foreground dark:text-white/90 shadow-sm transition-all hover:bg-muted dark:hover:bg-white/10 max-w-full outline-none"
                                >
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md p-2 ${logoBg}`}>
                                    {icon ? (
                                      <img src={icon} className={`h-full w-full object-contain ${isTikTok ? 'scale-125' : ''}`} alt="" />
                                    ) : (
                                      <Database className="h-5 w-5 text-emerald-400" />
                                    )}
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                                    <span className="truncate text-sm font-medium text-foreground dark:text-white">
                                      {displayName}
                                    </span>
                                    {secondaryText && (
                                      <span className="mt-0.5 truncate text-xs text-muted-foreground dark:text-gray-400">
                                        {secondaryText}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                sideOffset={8}
                                className="z-[300] max-w-[min(90vw,260px)] !bg-black/90 !text-white text-xs shadow-lg break-words"
                              >
                                {message.attachment.name}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                      </div>
                    )}
                    {/* Chart mention badges — shown when user referenced charts via @chart */}
                    {!isUser && message.chartMentions && message.chartMentions.length > 0 && (
                      <div className="mb-2 flex flex-col gap-1.5">
                        {/* Chart mention badges */}
                        {message.chartMentions.map((chart, idx) => {
                          const chartTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
                            bar: BarChart3, line: TrendingUp, pie: PieChart, donut: PieChart,
                            area: AreaChart, metric: Hash, table: Table2, composed: BarChart3,
                          };
                          const ChartIcon = chartTypeIcons[chart.type] || BarChart3;
                          const typeLabel = chart.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          // Determine if this edit is completed by checking if an assistant message follows
                          const msgIndex = messages.findIndex(m => m.id === message.id);
                          const nextMsg = msgIndex >= 0 ? messages[msgIndex + 1] : undefined;
                          const isEditDone = nextMsg?.role === 'assistant';
                          return (
                            <Tooltip key={`${chart.componentId}-${idx}`}>
                              <TooltipTrigger asChild>
                                <div
                                  className={`flex max-w-full cursor-default items-center gap-3 rounded-lg border px-3 py-2.5 text-foreground dark:text-white/90 shadow-sm outline-none transition-all ${isEditDone ? 'border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/[0.06]' : 'border-purple-500/30 bg-purple-500/5 dark:bg-purple-500/[0.06]'}`}
                                >
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ${isEditDone ? 'bg-emerald-500/10' : 'bg-purple-500/10'}`}>
                                    <ChartIcon className={`h-5 w-5 ${isEditDone ? 'text-emerald-400' : 'text-purple-400'}`} />
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                                    <span className={`flex items-center gap-1.5 text-xs font-medium ${isEditDone ? 'text-emerald-600 dark:text-emerald-300' : 'text-purple-600 dark:text-purple-300'}`}>
                                      {isEditDone ? (
                                        <><Check className="h-3 w-3" /> Edited {typeLabel} Chart</>
                                      ) : (
                                        <><Pencil className="h-3 w-3" /> Editing {typeLabel} Chart</>
                                      )}
                                    </span>
                                    <span className="mt-0.5 truncate text-sm text-foreground dark:text-white">
                                      {chart.title}
                                    </span>
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                sideOffset={8}
                                className="z-[300] max-w-[min(90vw,260px)] !bg-black/90 !text-white text-xs shadow-lg break-words"
                              >
                                {chart.title}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    )}
                    {/* Render text content if present */}
                    {message.content && !message.isError && (() => {
                      const lineCount = message.content.split('\n').length;
                      const isLong = lineCount > 10 || message.content.length > 600;
                      const isExpanded = expandedMessageIds.has(message.id);
                      return (
                        <div className={`relative ${textContentWidthClass}`}>
                          <div className="relative">
                            <div
                              className={`text-foreground dark:text-white leading-relaxed whitespace-pre-wrap break-words [word-break:normal] [hyphens:none] [overflow-wrap:anywhere] transition-all duration-300 ${isLong && !isExpanded ? 'max-h-[15em] overflow-hidden' : ''}`}
                            >
                              {message.role === 'user' && visibleMessageTokens.map((token) => (
                                <Fragment key={token.id}>{token.renderInline()}</Fragment>
                              ))}
                              {message.role === 'user' && <MetadataOverflowToken tokens={overflowMessageTokens} />}
                              <span dangerouslySetInnerHTML={{ __html: parseMessageToHtml(message.content) }} />
                            </div>
                            {isLong && !isExpanded && (
                              <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${message.role === 'assistant' ? 'from-muted dark:from-[#18181A] via-muted/80 dark:via-[#18181A]/80' : 'from-muted dark:from-black/100 via-muted/80 dark:via-black/80'} to-transparent pointer-events-none`} />
                            )}
                          </div>
                          {isLong && (
                            <button
                              onClick={() => {
                                setExpandedMessageIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(message.id)) {
                                    next.delete(message.id);
                                  } else {
                                    next.add(message.id);
                                  }
                                  return next;
                                });
                              }}
                              className="mt-1 inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground dark:text-white/40 dark:hover:text-white"
                              title={isExpanded ? 'Collapse response' : 'Expand response'}
                              type="button"
                            >
                              <span>{isExpanded ? 'Show less' : 'Show more'}</span>
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    {spreadsheetPreviewTarget && (
                      <SpreadsheetMessagePreview
                        target={spreadsheetPreviewTarget}
                        isExpanded={isSpreadsheetPreviewExpanded}
                        onToggle={toggleSpreadsheetPreview}
                        onOpen={openSpreadsheetPreview}
                      />
                    )}
                    {message.isError && (
                      message.isInsufficientCredits ? (
                        <CreditExhaustedCard
                          tier={subscription?.tier ?? "standard"}
                          creditsLimit={tierLimit}
                          onUpgrade={upgradeToPro}
                        />
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-red-500">
                            <AlertCircle className="w-4 h-4" />
                            <span
                              title="llm are not perfect"
                              className="text-sm cursor-help focus:outline-none"
                            >
                              {message.content}
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRetry}
                            className="self-start h-7 px-3 text-xs bg-transparent border-red-500/30 text-red-500 hover:bg-red-500/10"
                          >
                            Retry
                          </Button>
                        </div>
                      )
                    )}
                    {message.role === 'assistant' && message.clarificationResolution && (
                      <ClarificationQuestionTrace resolution={message.clarificationResolution} />
                    )}
                    {/* Render saved thinking trace (legacy todo tasks are adapted as fallback) */}
                    {message.role === 'assistant' && !message.clarificationResolution && ((message.thinkingTrace && message.thinkingTrace.length > 0) || (message.todoTasks && message.todoTasks.length > 0)) && (
                      <>
                        <ThinkingProcess
                          events={message.thinkingTrace}
                          fallbackTasks={message.todoTasks}
                          isActive={false}
                          inline
                          compactSurface={!isSidePanelOpen}
                        />
                        {canShowActivityEntry && index === latestAssistantThinkingMessageIndex && (
                          <ActivityEntryPoint
                            stepCount={getActivityEntryStepCount(message)}
                            onOpen={() => openMessageActivity(message)}
                            inline
                            compactSurface={!isSidePanelOpen}
                          />
                        )}
                      </>
                    )}
                    {message.role === 'assistant' && message.visualArtifacts && message.visualArtifacts.length > 0 && (
                      <div className="space-y-3">
                        {message.visualArtifacts.map((artifact) => (
                          <ChatVisualArtifact
                            key={artifact.id}
                            artifact={artifact}
                            isSidePanelOpen={isSidePanelOpen}
                          />
                        ))}
                      </div>
                    )}
                    {message.role === 'assistant' && message.editChangeSummary && (
                      <ChartChangeSummaryCard summary={message.editChangeSummary} />
                    )}
                    {message.role === 'assistant' && message.dashboardCard && (
                      <DashboardMessageCard
                        dashboardCard={message.dashboardCard}
                        isCompact={isSidePanelOpen}
                        isDashboardOpen={isDashboardOpen}
                        hasMessageContent={Boolean(message.content)}
                        onOpen={onSwitchToDashboard}
                      />
                    )}
                    <div className={`flex items-center mt-1 ${isUser ? "justify-end" : "justify-start"}`}>
                      <div className={`flex items-center gap-1.5 ${isUser ? "" : "flex-row-reverse"}`}>
                        {canCopyMessage && (
                          <button
                            type="button"
                            onClick={copyMessage}
                            className={`rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:opacity-100 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white ${isUser ? "" : "opacity-0 group-hover/message:opacity-100"}`}
                            aria-label="Copy message"
                            title="Copy message"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatToDisplay(
                            message.timestamp instanceof Date ? message.timestamp.toISOString() : String(message.timestamp),
                            { format: "full" },
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Live thinking under the active user message or while waiting for a clarification answer */}
              {message.role === 'user' && ((isProcessing && index === messages.length - 1) || index === pendingClarificationUserIndex) && (
                <div className="flex justify-start">
                  <ThinkingProcess
                    events={index === pendingClarificationUserIndex ? undefined : thinkingEvents}
                    fallbackTasks={index === pendingClarificationUserIndex
                      ? [{ id: 'waiting-for-clarification', text: 'Waiting for your answer' }]
                      : [
                        ...priorWorkflowSteps.map(s => ({ id: s, text: mapStepToDisplayText(s) })),
                        ...(currentWorkflowStep && !priorWorkflowSteps.includes(currentWorkflowStep)
                          ? [{ id: currentWorkflowStep, text: mapStepToDisplayText(currentWorkflowStep) }]
                          : []),
                        ...(!currentWorkflowStep && priorWorkflowSteps.length === 0
                          ? [{ id: 'start', text: 'Queued for analysis' }]
                          : []),
                      ]}
                    isActive={true}
                    compactSurface={!isSidePanelOpen}
                  />
                </div>
              )}
            </div>
          )
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompts */}
      {messages.length <= 1 && (
        <div className="mt-auto">
          <p className="text-xs mx-2 text-muted-foreground mb-2">Quick starts:</p>
          <div className="flex flex-wrap w-full items-start gap-2 mx-2 pr-3">
            {suggestedPrompts.slice(0, 4).map((prompt, index) => (
              <button
                key={index}
                onClick={() => setInputValue(prompt.text)}
                className="inline-flex self-start px-2 py-1 text-xs text-muted-foreground hover:text-foreground dark:text-white/30 border border-border dark:border-white/10 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200 text-left whitespace-normal break-words leading-snug overflow-hidden box-border max-w-full"
              >
                <span className="block min-w-0 break-words dark:group-hover:text-white/80">{prompt.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Area: Input */}
      <div className="mt-auto min-w-0">
        {/* Input Area */}
        <div className={compactComposer ? "m-1.5" : "m-2"}>
          {/* Main Chat Input with Hero Section Styling */}
          <div
            className={`w-full min-h-[60px] text-sm ${pendingClarificationMessage ? 'p-2' : compactComposer ? 'p-3 pb-2' : 'p-4 pb-2'} bg-background dark:bg-[#292929] border border-border dark:border-transparent rounded-xl resize-none transition-all duration-300 relative`}
            onDragOver={pendingClarificationMessage ? undefined : handleDragOver}
            onDragLeave={pendingClarificationMessage ? undefined : handleDragLeave}
            onDrop={pendingClarificationMessage ? undefined : handleDrop}
            onPasteCapture={pendingClarificationMessage ? undefined : handlePaste}
          >
            {/* Drag Overlay */}
            {isDragging && (
              <div className={`absolute inset-0 rounded-xl border-2 border-dashed border-primary/60 flex flex-col items-center justify-center z-10 pointer-events-none ${dragOver ? 'bg-primary/10' : ''}`}>
                <FileText className="w-8 h-8 text-primary mb-2" />
                <span className="text-sm text-primary font-medium">Drop file here to upload</span>
              </div>
            )}

            {pendingClarificationMessage?.clarificationRequests?.length ? (
              <ClarificationInputOverlay
                requests={pendingClarificationMessage.clarificationRequests}
                disabled={isProcessing || isDismissingClarification}
                onDismiss={() => handleClarificationDismiss(pendingClarificationMessage)}
                onSubmit={(answers) => handleClarificationSubmit(pendingClarificationMessage, answers)}
              />
            ) : (
              <>
                {/* First-run discoverability hint for the @chart editing flow */}
                <FirstRunHint show={isDashboardOpen && !isContextPickerOpen} />

                {/* Context Picker */}
                {isContextPickerOpen && (
                  <ProjectContextPicker
                    files={
                      pickerTriggerMode === 'mention'
                        ? projectAssets.filter(asset => asset.name.toLowerCase().includes(mentionQuery.toLowerCase()))
                        : projectAssets
                    }
                    charts={isDashboardOpen ? availableCharts : []}
                    onSelect={handleAssetSelect}
                    onChartSelect={handleChartSelect}
                    onPreview={(fileId) => window.open(`/preview/${fileId}`, '_blank')}
                    query={mentionQuery}
                    className={`project-context-picker-container max-w-[calc(100vw_-_2rem)] ${compactComposer ? 'max-w-full' : ''} ${pickerTriggerMode === 'button' ? 'bottom-full left-0 mb-2' : ''}`}
                  />
                )}

                {/* Active File, Chart & Theme Correlations */}
                {(stagedFiles.length > 0 || mentionedCharts.length > 0 || (selectedTemplate && isTemplatePending)) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {compactComposer ? (
                      <>
                        {visibleComposerTokens.map((token) => (
                          <Fragment key={token.id}>{token.renderInline()}</Fragment>
                        ))}
                        <MetadataOverflowToken tokens={overflowComposerTokens} />
                      </>
                    ) : (
                      <>
                        {/* Theme Selection Pill */}
                        {selectedTemplate && isTemplatePending && (
                          <ThemeInlineToken
                            theme={selectedTemplate}
                            variant="composer"
                            onRemove={handleTemplateRemove}
                            className="animate-in fade-in slide-in-from-left-2 duration-300"
                          />
                        )}

                        {mentionedCharts.map(chart => (
                          <ChartPreviewChip
                            key={`chart-${chart.componentId}`}
                            chart={chart}
                            onRemove={() => setMentionedCharts(prev => prev.filter(c => c.componentId !== chart.componentId))}
                          />
                        ))}
                        {stagedFiles.map((file, i) => (
                          <FilePreviewChip
                            key={file.fileID || i}
                            file={file}
                            onRemove={() => removeUploadedFile(file.fileID)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* Textarea Row */}
                <div className="relative mb-3">
                  {/* Expand/Collapse button */}
                  {inputValue.length > 100 && (
                    <button
                      onClick={() => setIsInputExpanded(!isInputExpanded)}
                      className="absolute top-0 right-0 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10 transition-all z-10"
                      title={isInputExpanded ? 'Collapse input' : 'Expand input'}
                      type="button"
                    >
                      {isInputExpanded ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <TextareaAutosize
                    minRows={2}
                    maxRows={isInputExpanded ? 20 : 6}
                    value={inputValue}
                    onChange={(e) => {
                      const value = e.target.value;
                      setInputValue(value);

                      // Detect @ mention
                      const cursorPos = e.target.selectionStart || 0;
                      const textBeforeCursor = value.slice(0, cursorPos);
                      const lastAtIndex = textBeforeCursor.lastIndexOf('@');

                      if (lastAtIndex !== -1 && lastAtIndex === cursorPos - 1) {
                        // User just typed @
                        setIsContextPickerOpen(true);
                        setPickerTriggerMode('mention');
                        setMentionQuery('');
                        setMentionCursorPos(cursorPos);

                        // Mutual Exclusion
                        setModelDropdownOpen(false);
                        setDropdownOpen(false);

                        // Fetch assets if not already loaded
                        if (projectId && projectAssets.length === 0) {
                          fetchProjectAssets(projectId).then(setProjectAssets);
                        }
                      } else if (lastAtIndex !== -1 && cursorPos > lastAtIndex) {
                        // User is typing after @. Allow spaces so multi-word
                        // mentions like "@chart revenue trend" keep the picker
                        // open; only bail out on a newline or a sentence-length
                        // query (likely no longer a mention).
                        const query = textBeforeCursor.slice(lastAtIndex + 1);
                        if (!/\n/.test(query) && query.length <= 50) {
                          setMentionQuery(query);
                          setIsContextPickerOpen(true);
                          setPickerTriggerMode('mention');

                          // Mutual Exclusion
                          setModelDropdownOpen(false);
                          setDropdownOpen(false);
                        } else {
                          setIsContextPickerOpen(false);
                        }
                      } else {
                        // Only close if we are in mention mode (don't close button mode on typing)
                        if (pickerTriggerMode === 'mention') {
                          setIsContextPickerOpen(false);
                        }
                      }
                    }}
                    placeholder={isListening ? 'Listening...' : "Ask anything, or type @ to reference a chart or dataset"}
                    className={`w-full bg-transparent border-none outline-none resize-none text-sm placeholder:text-muted-foreground/60 chat-scrollbar-hide ${inputValue.length > 100 ? 'pr-6' : ''}`}
                    data-chat-input
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSend();
                      }
                    }}
                  />
                </div>

                {/* Recording Bar - Positioned between textarea and buttons */}
                <RecordingBarSidebar
                  isVisible={isListening}
                  detectedLanguage={detectedLanguage}
                  onCancel={handleRecordingCancel}
                  onConfirm={handleRecordingConfirm}
                />

                {/* Credit exhausted banner */}
                {creditUsage?.can_use_credits === false && (
                  <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="text-xs text-amber-300/80 truncate">Daily data-run limit reached · Try again after reset</span>
                    </div>
                    <a
                      href="/pricing"
                      className="shrink-0 inline-flex items-center justify-center h-7 px-3 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20 hover:bg-amber-500/25 transition-colors"
                    >
                      View limits
                    </a>
                  </div>
                )}

                {/* Buttons Row */}
                <div className={`chat-composer-actions flex items-center justify-between ${compactComposer ? 'flex-wrap gap-2' : 'gap-2'}`}>
                  {/* Left side - secondary composer actions */}
                  <div className={`flex items-center ${compactComposer ? 'min-w-0 flex-wrap gap-1.5' : 'gap-2'}`}>
                    <ComposerAddMenu
                      onUpload={handleFileUpload}
                      onAddProjectContext={handleAddProjectContextClick}
                      onChooseTheme={handleCloneTemplateClick}
                      onOpen={() => {
                        setModelDropdownOpen(false);
                        setDropdownOpen(false);
                        setIsContextPickerOpen(false);
                      }}
                    />

                    {/* Data Connector Dropup */}
                    <div className="relative data-source-dropdown">
                      <button
                        type="button"
                        onClick={() => {
                          const newState = !dropdownOpen;
                          setDropdownOpen(newState);
                          if (newState) {
                            setModelDropdownOpen(false);
                            setIsContextPickerOpen(false);
                          }
                        }}
                        className={`flex h-[34px] items-center justify-center gap-1 rounded-md px-2 transition-all duration-200 ${selectedDataSource
                          ? `${getDataSourceColors(selectedDataSource).bg} ${getDataSourceColors(selectedDataSource).border} ${getDataSourceColors(selectedDataSource).text} ${getDataSourceColors(selectedDataSource).hover} border`
                          : 'border border-border/50 text-muted-foreground hover:text-foreground dark:border-white/30 dark:text-gray-400 dark:hover:text-white'
                          }`}
                        aria-expanded={dropdownOpen}
                        aria-haspopup="true"
                        aria-label="Connect data source"
                        title="Connect data source"
                      >
                        <Link className="h-4 w-4" />
                        <ChevronUp className={`h-3 w-3 transition-transform duration-200 ${selectedDataSource ? 'text-white' : 'text-muted-foreground/60 dark:text-white/60'
                          } ${dropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {dropdownOpen && (
                        <div className="absolute bottom-full left-0 z-[300] mb-2 w-[min(13rem,calc(100vw_-_2rem))] rounded-xl border border-border/30 bg-background/95 p-2 shadow-2xl backdrop-blur-sm">
                          <p className="px-2 pb-1.5 pt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground dark:text-white/25">Popular</p>

                          {CONNECTORS.filter(c => ['GA4', 'Google Ads', 'Firebase', 'Google Sheets'].includes(c.name)).map(con => {
                            const availability = connectorCapability(capabilities, con.connectorKey);
                            return (
                              <button
                                key={con.name}
                                type="button"
                                onClick={() => handleIntegrationClick(con)}
                                disabled={!availability.enabled}
                                title={availability.enabled ? `Connect ${con.name}` : availability.reason ?? `${con.name} is unavailable`}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors enabled:cursor-pointer enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 dark:enabled:hover:bg-white/10"
                              >
                                <img src={con.icon} alt={con.name} className="h-4 w-4 flex-shrink-0 object-contain" />
                                <span className="text-foreground dark:text-white/90">{con.name}</span>
                                <span className="ml-auto text-[9px] text-muted-foreground/70 dark:text-white/30">
                                  {availability.enabled ? "AVAILABLE" : "UNAVAILABLE"}
                                </span>
                              </button>
                            );
                          })}

                          {([
                            { name: 'Meta Ads', icon: '/meta.png', category: 'Advertising Platform' as const },
                            { name: 'TikTok Ads', icon: '/tiktok.png', category: 'Advertising Platform' as const },
                          ] as const).map(con => (
                            <button
                              key={con.name}
                              type="button"
                              onClick={() => handleIntegrationClick(con)}
                              disabled
                              title={`${con.name} is unavailable in the Hobby demo`}
                              className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm opacity-60"
                            >
                              <img src={con.icon} alt={con.name} className="h-4 w-4 flex-shrink-0 object-contain opacity-50" />
                              <span className="text-muted-foreground dark:text-white/50">{con.name}</span>
                              <span className="ml-auto text-[9px] text-muted-foreground/70 dark:text-white/30">UNAVAILABLE</span>
                            </button>
                          ))}

                          <div className="mt-1.5 border-t border-border/60 pt-1.5 dark:border-white/10">
                            <button
                              type="button"
                              onClick={() => { setDropdownOpen(false); setAllConnectorsModalOpen(true); }}
                              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                            >
                              Browse all connectors
                              <ChevronRight className="ml-auto h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right side - Model Selector + Send Button */}
                  <div className={`flex items-center ${compactComposer ? 'ml-auto shrink-0 gap-1.5' : 'gap-2'}`}>
                    {/* Model Dropdown */}
                    {/* Model Selector Component */}
                    <ModelSelector
                      selectedModel={selectedModel}
                      onSelect={(model) => {
                        setSelectedModel(model);
                        setModelDropdownOpen(false);
                      }}
                      dailyRunLimit={dailyDataRunLimit}
                      isOpen={modelDropdownOpen}
                      onToggle={() => {
                        const newState = !modelDropdownOpen;
                        setModelDropdownOpen(newState);
                        if (newState) {
                          setDropdownOpen(false);
                          setIsContextPickerOpen(false);
                        }
                      }}
                      anchor="right"
                      placement="top"
                      variant="compact"
                      labelMode={compactComposer ? 'adaptive' : 'full'}
                    />

                    {/* Send / Stop Button */}
                    {(isProcessing || uploadedFiles.some(f => f.status === 'processing')) ? (
                      <Button
                        onClick={() => stopGeneration()}
                        className={`button-gradient ${compactComposer ? 'p-2.5' : 'p-3'}`}
                      >
                        <Square className="w-4 h-4" />
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleSend()}
                        disabled={!inputValue.trim() || isTyping || uploadedFiles.some(f => f.status === 'uploading')}
                        className={`button-gradient ${compactComposer ? 'p-2.5' : 'p-3'} disabled:opacity-50`}
                      >
                        <CornerRightUp className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            if (uploadedFiles.length + files.length > maxFilesPerRun) {
              toast({
                title: "Too many files",
                description: `Maximum ${maxFilesPerRun} files allowed. Please remove some files first.`,
                variant: "destructive"
              });
              e.target.value = '';
              return;
            }
            let batchProjectId = projectId || uploadedFiles.find((file) => file.projectId)?.projectId;
            for (const file of files) {
              const uploadedProjectId = await processFileUpload(file, batchProjectId);
              if (!batchProjectId && uploadedProjectId) batchProjectId = uploadedProjectId;
            }
            e.target.value = '';
          }}
        />
      </div>
        </>
      )}

      {/* Template Modal */}
      <TemplateModal
        open={isTemplateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onTemplateSelect={handleTemplateSelect}
        initialSelection={selectedTemplate}
        source={templateModalSource}
        onRequestTemplate={() => setFeedbackModal({ open: true, category: "Request Template", placeholder: "What template would you like to see? (e.g. specific industry, use case, layout...)" })}
      />
      <FeedbackModal
        open={feedbackModal.open}
        onClose={() => setFeedbackModal((prev) => ({ ...prev, open: false }))}
        category={feedbackModal.category}
        placeholder={feedbackModal.placeholder}
      />
    </div>
  );
};

export default ChatInterface;
