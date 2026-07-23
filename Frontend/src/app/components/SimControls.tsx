import React, { useState } from "react";
import { useSim } from "../context/SimContext";
import { useTheme } from "../context/ThemeContext";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Badge } from "./ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";
import { Play, Pause, Square, Zap, Settings, FastForward, Calendar as CalendarIcon } from "lucide-react";

import { SIM_BASE_DATE } from "../engine/types";

export function SimControls() {
  const { state, start, reset, togglePause, updateSpeed, startFastForward } = useSim();
  const { isDark } = useTheme();
  const [scenario, setScenario] = useState<"daily" | "weekly">("weekly");
  const [turnaround, setTurnaround] = useState(1);
  const defaultTarget = new Date(SIM_BASE_DATE);
  defaultTarget.setDate(defaultTarget.getDate() + 1);
  const [targetDate, setTargetDate] = useState<Date>(defaultTarget);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handleFastForward = () => {
    if (!targetDate) return;
    const dt = new Date(targetDate);
    dt.setHours(0, 0, 0, 0);
    startFastForward(dt);
  };

  const formatDateLabel = (d: Date) =>
    d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  const cardBg = isDark ? "bg-[#1e293b]/50 border-[#334155]" : "bg-white border-[#cbd5e1]";
  const titleColor = isDark ? "text-[#e2e8f0]" : "text-[#0f172a]";
  const labelColor = isDark ? "text-[#94a3b8]" : "text-[#475569]";
  const inputBg = isDark ? "bg-[#0f172a] border-[#334155] text-[#e2e8f0]" : "bg-[#f8fafc] border-[#cbd5e1] text-[#0f172a]";
  const selectBg = isDark ? "bg-[#1e293b] border-[#334155]" : "bg-white border-[#cbd5e1]";
  const infoBg = isDark ? "bg-[#0f172a]" : "bg-[#f1f5f9] border border-[#e2e8f0]";
  const infoLabel = isDark ? "text-[#64748b]" : "text-[#64748b]";
  const infoValue = isDark ? "text-[#e2e8f0]" : "text-[#0f172a]";
  const btnOutline = isDark ? "border-[#334155] text-[#94a3b8]" : "border-[#cbd5e1] text-[#475569]";
  const speedBtnCls = (active: boolean) => active
    ? "bg-blue-600 text-white"
    : isDark ? "border-[#334155] text-[#94a3b8]" : "border-[#cbd5e1] text-[#475569]";

  const minDate = SIM_BASE_DATE;
  const ffDisabled = state.fastForwardState === "running";

  return (
    <Card className={cardBg}>
      <CardHeader className="pb-3">
        <CardTitle className={`${titleColor} text-[14px] flex items-center gap-2`}>
          <Settings className="w-4 h-4" /> Control de Simulación
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Scenario */}
        <div>
          <label className={`${labelColor} text-[12px] mb-1 block`}>Escenario</label>
          <Select value={scenario} onValueChange={(v) => setScenario(v as any)}>
            <SelectTrigger className={inputBg}><SelectValue /></SelectTrigger>
            <SelectContent className={selectBg}>
              <SelectItem value="daily">Día a Día (Tiempo Real)</SelectItem>
              <SelectItem value="weekly">Simulación Semanal (5 días)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Turnaround */}
        <div>
          <label className={`${labelColor} text-[12px] mb-1 block`}>
            Turnaround en aeropuerto: {turnaround}h
          </label>
          <Slider value={[turnaround]} onValueChange={([v]) => setTurnaround(v)} min={0} max={4} step={0.5} className="mt-2" />
        </div>

        {/* Speed */}
        <div>
          <label className={`${labelColor} text-[12px] mb-1 block`}>
            Velocidad: x{state.speed}
          </label>
          <div className="flex gap-2">
            {[1, 2, 5, 10, 20].map(s => (
              <Button
                key={s}
                size="sm"
                variant={state.speed === s ? "default" : "outline"}
                className={`text-[11px] px-2 py-1 ${speedBtnCls(state.speed === s)}`}
                onClick={() => updateSpeed(s)}
                disabled={state.fastForwardState === "running"}
              >
                x{s}
              </Button>
            ))}
          </div>
        </div>

        {/* Fast Forward to Date */}
        <div>
          <label className={`${labelColor} text-[12px] mb-1 block`}>
            Acelerar hasta fecha
          </label>
          <div className="flex gap-2">
            <Popover open={calendarOpen} onOpenChange={(o) => !ffDisabled && setCalendarOpen(o)}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={ffDisabled}
                  className={`flex-1 flex items-center gap-2 rounded-md text-[12px] px-2 py-1.5 border transition-colors ${inputBg} ${ffDisabled ? "opacity-50 cursor-not-allowed" : (isDark ? "hover:border-cyan-500/40" : "hover:border-blue-600/40")}`}
                >
                  <CalendarIcon className={`w-3.5 h-3.5 ${isDark ? "text-[#94a3b8]" : "text-[#64748b]"}`} />
                  <span className="truncate">{formatDateLabel(targetDate)}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className={`w-auto p-0 ${selectBg}`} align="start">
                <Calendar
                  mode="single"
                  selected={targetDate}
                  onSelect={(d) => {
                    if (d) {
                      setTargetDate(d);
                      setCalendarOpen(false);
                    }
                  }}
                  disabled={{ before: minDate }}
                  defaultMonth={targetDate}
                  required
                />
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant="outline"
              className={btnOutline}
              onClick={handleFastForward}
              disabled={ffDisabled}
            >
              <FastForward className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button onClick={() => start(scenario, turnaround)} className="bg-green-600 hover:bg-green-700 flex-1" size="sm">
            <Play className="w-3 h-3 mr-1" /> Iniciar
          </Button>
          <Button
            onClick={togglePause}
            variant="outline"
            className={`${btnOutline} flex-1`}
            size="sm"
            disabled={!state.running && state.currentTime === 0}
          >
            {state.running ? <><Pause className="w-3 h-3 mr-1" /> Pausar</> : <><Play className="w-3 h-3 mr-1" /> Reanudar</>}
          </Button>
          <Button
            onClick={() => reset(scenario, turnaround)}
            variant="outline"
            className="border-red-500/30 text-red-400 flex-1"
            size="sm"
          >
            <Zap className="w-3 h-3 mr-1" /> Reiniciar
          </Button>
        </div>

        {/* Info */}
        <div className={`${infoBg} rounded-lg p-3 space-y-1`}>
          <div className="flex justify-between text-[11px]">
            <span className={infoLabel}>Tiempo simulado</span>
            <span className={infoValue}>{state.currentTime.toFixed(1)}h ({state.day} días)</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className={infoLabel}>Grupos de equipaje</span>
            <span className={infoValue}>{state.baggageGroups.length}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className={infoLabel}>Almacén global</span>
            <span className={infoValue}>{state.stats.warehouseUtilization.toFixed(1)}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
