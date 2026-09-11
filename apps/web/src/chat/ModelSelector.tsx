import React, { useRef, useEffect } from "react";
import { Zap, Sparkles, ChevronDown, CheckCircle } from "lucide-react";
import { useUser } from "@/lib/clerk";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ModelSelectorProps {
  selectedModel: 'pro' | 'fast';
  onSelect: (model: 'pro' | 'fast') => void;
  dailyRunLimit: number;
  isOpen: boolean;
  onToggle: () => void;
  anchor: 'left' | 'right';
  placement?: 'top' | 'bottom';
  variant?: 'classic' | 'compact';
  labelMode?: 'full' | 'adaptive';
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onSelect,
  dailyRunLimit,
  isOpen,
  onToggle,
  anchor = 'right',
  placement = 'bottom',
  variant = 'classic',
  labelMode = 'full'
}) => {
  const { isSignedIn } = useUser();
  const containerRef = useRef<HTMLDivElement>(null);
  const adaptiveLabel = labelMode === 'adaptive';
  const selectedModelLabel = selectedModel === 'fast' ? 'Fast' : 'Thorough';
  const selectedModelShortLabel = selectedModel === 'fast' ? 'Fast' : 'Deep';
  const selectorTooltip = `${selectedModelLabel} model selector`;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onToggle();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onToggle]);

  if (!isSignedIn) return null;
  return (
    <div className="relative" ref={containerRef}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={`Select intelligence model (${selectedModelLabel})`}
            data-selected-model={selectedModel}
            className={`model-selector-button ${adaptiveLabel ? 'model-selector-adaptive-button w-[68px] justify-center gap-1.5 px-2' : 'gap-2'} flex items-center transition-all duration-300 group h-[34px] ${variant === 'compact'
              ? `${adaptiveLabel ? '' : 'px-2.5 py-1.5'} rounded-md border text-sm ${selectedModel === 'pro'
                ? 'border-primary bg-primary text-white shadow-lg shadow-primary/20'
                : isOpen
                  ? 'dark:border-white/50 border-input dark:bg-white/10 bg-black/5 dark:text-white text-foreground'
                  : 'dark:border-white/30 border-input/60 text-muted-foreground hover:text-foreground dark:text-white/60 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
              }`
              : `${adaptiveLabel ? '' : 'px-3 py-1.5'} text-sm button-outline ${selectedModel === 'pro'
                ? 'border-primary bg-primary text-white shadow-[0_4px_20px_hsl(var(--primary)/0.4)]'
                : 'hover:border-primary/60 hover:bg-black/5 dark:hover:bg-white/5 dark:text-white/90 text-foreground/90'
              }`
              } ${isOpen && variant === 'classic' ? 'ring-2 ring-primary/20 border-primary/40' : ''}`}
            title={adaptiveLabel ? undefined : "Select intelligence model"}
          >
            <div className="relative flex items-center justify-center">
              {selectedModel === 'fast' ? (
                <Zap className={`w-4 h-4 ${variant === 'compact' && selectedModel === 'fast' && !isOpen ? 'text-muted-foreground group-hover:text-foreground dark:text-white/60 dark:group-hover:text-white' : ''}`} />
              ) : (
                <Sparkles className="w-4 h-4 text-white animate-pulse-glow" />
              )}
              {selectedModel === 'pro' && (
                <div className="absolute inset-0 bg-primary/30 blur-md rounded-full -z-10" />
              )}
            </div>
            <span className={`model-selector-adaptive-label font-medium ${adaptiveLabel ? 'text-xs' : ''}`}>
              {adaptiveLabel ? selectedModelShortLabel : selectedModelLabel}
            </span>
            <ChevronDown className={`model-selector-adaptive-chevron w-3.5 h-3.5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''} ${selectedModel === 'pro'
              ? 'text-white/70 group-hover:text-white'
              : 'text-foreground/40 dark:text-white/40 group-hover:text-foreground/70 dark:group-hover:text-white/70'
              }`} />
          </button>
        </TooltipTrigger>
        {adaptiveLabel && (
          <TooltipContent side="top" align={anchor === 'right' ? 'end' : 'start'} className="text-xs">
            {selectorTooltip}
          </TooltipContent>
        )}
      </Tooltip>

      {/* CSS keyframes instead of framer-motion: this component is reached from the
          marketing homepage, and it was the last thing keeping framer-motion in the
          eager bundle. The trade-off is that the menu now closes instantly rather
          than animating out; the open animation is preserved. */}
      {isOpen && (
          <div
            className={`${placement === 'bottom' ? 'animate-dropdown-in-up' : 'animate-dropdown-in-down'} absolute ${placement === 'bottom' ? 'top-full mt-3' : 'bottom-full mb-3'
              } w-[min(18rem,calc(100vw_-_2rem))] bg-background/95 dark:bg-[#121214]/95 backdrop-blur-xl border border-border dark:border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-20 overflow-hidden ${anchor === 'right' ? 'right-0' : 'left-0'
              }`}
          >
            <div className="p-2 space-y-1">
              <button
                onClick={() => { onSelect('fast'); }}
                className={`w-full p-2 text-left rounded-xl transition-all duration-200 group flex items-start gap-3 ${selectedModel === 'fast' ? 'bg-black/5 dark:bg-white/10 ring-1 ring-border dark:ring-white/10 shadow-[inset_-2px_-2px_8px_rgba(255,255,255,0.05)]' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-60 hover:opacity-100'}`}
              >
                <div className={`p-2 rounded-lg ${selectedModel === 'fast' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-black/5 dark:bg-white/5 text-muted-foreground dark:text-white/40 group-hover:text-foreground dark:group-hover:text-white/60'}`}>
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground dark:text-white">Fast</span>
                    <div className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-muted-foreground dark:text-white/60">
                      <span>Demo</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground dark:text-white/40 mt-0.5">Optimized for speed & daily tasks</p>
                </div>
                {selectedModel === 'fast' && (
                  <CheckCircle className="w-4 h-4 text-emerald-400 mt-1" />
                )}
              </button>

              <button
                onClick={() => { onSelect('pro'); }}
                className={`w-full p-2 text-left rounded-xl transition-all duration-200 group flex items-start gap-3 ${selectedModel === 'pro' ? 'bg-primary/10 dark:bg-primary/20 ring-1 ring-primary/30 shadow-[inset_-2px_-2px_8px_hsl(var(--primary)/0.15)]' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-60 hover:opacity-100'}`}
              >
                <div className={`p-2 rounded-lg ${selectedModel === 'pro' ? 'bg-primary/20 dark:bg-primary/30 text-primary-glow dark:text-primary-glow' : 'bg-black/5 dark:bg-white/5 text-muted-foreground dark:text-white/40 group-hover:text-foreground dark:group-hover:text-white/60'}`}>
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground dark:text-white">Thorough</span>
                    <div className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 dark:bg-primary/20 text-primary">
                      <span>Demo</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground dark:text-white/40 mt-0.5">Deep reasoning & complex tasks</p>
                </div>
                {selectedModel === 'pro' && (
                  <CheckCircle className="w-4 h-4 text-emerald-400 mt-1" />
                )}
              </button>
            </div>

            <div className="mt-2 border-t border-border dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs text-muted-foreground dark:text-white/60">Free preview</span>
                </div>
                <span className="text-xs font-bold text-foreground dark:text-white">
                  Up to {dailyRunLimit.toLocaleString()}/day
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground/70 dark:text-white/35 mt-1.5">
                Server-enforced data-run cap; live remaining usage is not exposed.
              </p>
            </div>
          </div>
      )}
    </div>
  );
};

export default ModelSelector;
