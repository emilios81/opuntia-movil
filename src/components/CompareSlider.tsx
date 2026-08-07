
"use client"

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface CompareSliderProps {
  originalSrc: string;
  processedSrc: string | null;
  className?: string;
  aspectRatio: number;
  filterLabel?: string;
}

export function CompareSlider({ originalSrc, processedSrc, className = "", aspectRatio, filterLabel = "Enhanced" }: CompareSliderProps) {
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = (x / rect.width) * 100;
    setSliderPos(Math.max(0, Math.min(100, pos)));
  }, []);

  const onMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    handleMove(clientX);
  };

  useEffect(() => {
    const mouseMove = (e: MouseEvent) => {
      if (isDragging) handleMove(e.clientX);
    };
    const touchMove = (e: TouchEvent) => {
      if (isDragging) handleMove(e.touches[0].clientX);
    };
    const stopDragging = () => setIsDragging(false);

    window.addEventListener('mousemove', mouseMove);
    window.addEventListener('touchmove', touchMove);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);

    return () => {
      window.removeEventListener('mousemove', mouseMove);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('touchend', stopDragging);
    };
  }, [isDragging, handleMove]);

  return (
    <div 
      ref={containerRef}
      className={`relative w-full overflow-hidden select-none touch-none rounded-xl border border-border shadow-xl bg-muted/20 ${className}`}
      style={{ aspectRatio: aspectRatio || 1 }}
      onMouseDown={onMouseDown}
      onTouchStart={onMouseDown}
    >
      {/* Background Image (Original) */}
      <img
        src={originalSrc}
        alt="Original Rock Art"
        className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
      />

      {/* Foreground Image (Processed) */}
      {processedSrc && (
        <div 
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
        >
          <img
            src={processedSrc}
            alt="Enhanced Rock Art"
            className="w-full h-full object-contain"
          />
        </div>
      )}

      {/* Slider Handle */}
      {processedSrc && (
        <>
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)] z-10"
            style={{ left: `${sliderPos}%` }}
          />
          <div 
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-white border-2 border-primary shadow-lg z-20"
            style={{ left: `${sliderPos}%` }}
          >
            <div className="flex gap-0.5">
              <div className="w-0.5 h-3 bg-primary/40 rounded-full" />
              <div className="w-0.5 h-3 bg-primary/40 rounded-full" />
            </div>
          </div>
        </>
      )}

      {/* Labels */}
      {processedSrc && (
        <>
          <div className="absolute bottom-4 right-4 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded text-[8px] text-white font-code uppercase tracking-widest border border-white/10 z-20">
            Original
          </div>
          <div className="absolute bottom-4 left-4 bg-accent/80 backdrop-blur-md px-2 py-0.5 rounded text-[8px] text-white font-code uppercase tracking-widest border border-white/10 z-20">
            {filterLabel}
          </div>
        </>
      )}
    </div>
  );
}
