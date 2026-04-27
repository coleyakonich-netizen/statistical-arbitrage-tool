"use client";

import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { Activity, Plus, Check, History, BarChart3, Play, Layers, Filter, Split, Trash2 } from 'lucide-react';

interface PairResult { id: string; assetA: string; assetB: string; passRate: number; halfLife: number; r2: number; sector?: string; }
interface BacktestData { day: string; portfolioReturn: number; spyReturn: number; [key: string]: string | number; }
interface TradeRecord { 
  pair: string; type: string; entry: string; entryZ: number; exit: string; exitZ: number; returnPct: number; 
  beta: number; entryPriceA: number; entryPriceB: number; exitPriceA: number; exitPriceB: number;
  exitReason: string;
}

const AVAILABLE_SECTORS = [
  'Technology', 'Financials', 'Healthcare', 'Energy', 
  'Industrials', 'Materials', 'Real Estate', 'Utilities', 
  'Cons. Discretionary', 'Cons. Staples', 'Communication'
];

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#84cc16'];

export default function QuantMatrix() {
  const [watchedPairs, setWatchedPairs] = useState<PairResult[]>([]);
  const [selectedPairs, setSelectedPairs] = useState<PairResult[]>([]);
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>("STANDBY");
  const [scannedPairs, setScannedPairs] = useState<PairResult[]>([]);
  
  const [scanSectors, setScanSectors] = useState<string[]>(['Technology', 'Financials']);
  const [scanLimit, setScanLimit] = useState<string>("50"); 
  const [capSize, setCapSize] = useState<'mid' | 'small'>('mid');
  const [isSniping, setIsSniping] = useState(false);

  const [backtestData, setBacktestData] = useState<BacktestData[]>([]);
  const [backtestTrades, setBacktestTrades] = useState<TradeRecord[]>([]);
  const [backtestMetrics, setBacktestMetrics] = useState({ winRate: 0, portfolioReturn: 0, alpha: 0, drawdown: 0 });
  const [isBacktesting, setIsBacktesting] = useState(false);
  
  const [chartMode, setChartMode] = useState<'combined' | 'compare'>('combined');
  const [btDays, setBtDays] = useState<number>(60);
  const [btTP, setBtTP] = useState<string>("5.0");
  const [btSL, setBtSL] = useState<string>("1.5");

  // AUTOMATED 2-PHASE SCANNER
  const startLiveScan = () => {
    setIsScanning(true);
    setScannedPairs([]);
    setScanStatus("Phase 1: Fast Radar Scanning...");

    const sectorQuery = scanSectors.length > 0 ? scanSectors.join(',') : 'All';
    const ws = new WebSocket(`ws://localhost:8000/api/ws/scan?sectors=${sectorQuery}&cap=${capSize}`);
    const maxLimit = parseInt(scanLimit) || 50;
    let radarResults: PairResult[] = [];
    
    ws.onmessage = (event) => {
      const res = JSON.parse(event.data);
      if (res.type === 'status') {
        setScanStatus(`Radar: ${res.msg}`); 
      } else if (res.type === 'pair') {
        radarResults.push(res.data);
        setScannedPairs([...radarResults].sort((a, b) => {
           const scoreA = (a.passRate * (1 + a.r2)) / Math.pow(a.halfLife, 1.5);
           const scoreB = (b.passRate * (1 + b.r2)) / Math.pow(b.halfLife, 1.5);
           return scoreB - scoreA;
        }).slice(0, maxLimit));
      } else if (res.type === 'done') {
        ws.close();
        if (radarResults.length > 0) {
            runAutomaticSniper(radarResults.slice(0, maxLimit));
        } else {
            setScanStatus("SCAN COMPLETE: No Pairs Found.");
            setIsScanning(false);
        }
      }
    };
    ws.onerror = () => {
        setScanStatus("CONNECTION ERROR");
        setIsScanning(false);
    };
  };

  const runAutomaticSniper = (radarPairs: PairResult[]) => {
    setIsSniping(true);
    setScanStatus(`Phase 2: Walk-Forward Testing ${radarPairs.length} Pairs...`);

    fetch(`http://localhost:8000/api/sniper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairs: radarPairs.map(p => ({ assetA: p.assetA, assetB: p.assetB })) })
    })
      .then(response => response.json())
      .then(data => {
        const top10 = data.top_pairs;
        if (top10 && top10.length > 0) {
            const promotedPairs: PairResult[] = top10.map((p: any) => ({
                id: p.id, assetA: p.assetA, assetB: p.assetB,
                passRate: Math.round(p.passRate), halfLife: Math.round(p.halfLife * 10) / 10,
                r2: p.r2, sector: p.sector || "Verified" 
            }));
            setScannedPairs(promotedPairs);
            setWatchedPairs(promotedPairs);
            setSelectedPairs(promotedPairs);
            setScanStatus("TARGETS ACQUIRED & VERIFIED");
        } else {
            setScanStatus("ZERO SURVIVORS FROM WALK-FORWARD");
            setScannedPairs([]);
        }
        setIsScanning(false);
        setIsSniping(false);
      })
      .catch(err => {
        console.error("Sniper Failed:", err);
        setScanStatus("DEEP SCAN ERROR");
        setIsScanning(false);
        setIsSniping(false);
      });
  };

  const toggleSectorSelection = (sector: string) => {
    if (scanSectors.includes(sector)) setScanSectors(scanSectors.filter(s => s !== sector));
    else setScanSectors([...scanSectors, sector]);
  };

  const togglePairSelection = (pair: PairResult) => {
    if (selectedPairs.find(p => p.id === pair.id)) setSelectedPairs(selectedPairs.filter(p => p.id !== pair.id));
    else setSelectedPairs([...selectedPairs, pair]);
    setBacktestData([]); 
  };

  const clearPortfolio = () => {
    setWatchedPairs([]);
    setSelectedPairs([]);
    setBacktestData([]);
    setBacktestTrades([]);
  };

  const runBacktest = () => {
    if (selectedPairs.length === 0) return;
    setIsBacktesting(true);
    setBacktestData([]);
    setBacktestTrades([]);
    
    const tpVal = Number(btTP) / 100;
    const slVal = Number(btSL) / 100;

    fetch(`http://localhost:8000/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: selectedPairs.map(p => ({ assetA: p.assetA, assetB: p.assetB })),
        days: btDays, tp: tpVal, sl: slVal
      })
    })
      .then(response => response.json())
      .then(data => {
        setBacktestData(data.chartData);
        setBacktestTrades(data.trades); 
        setBacktestMetrics(data.metrics);
        setIsBacktesting(false);
      })
      .catch(err => {
        console.error("Backtest Failed:", err);
        setIsBacktesting(false);
      });
  };

  const addToWatchlist = (pair: PairResult) => {
    if (!watchedPairs.find(p => p.id === pair.id)) {
      setWatchedPairs([...watchedPairs, pair]);
      if (selectedPairs.length === 0) setSelectedPairs([pair]); 
    }
  };

  return (
    <div className="h-screen w-full bg-[#050914] text-slate-300 font-sans overflow-hidden flex flex-col selection:bg-cyan-500/30 p-2 gap-2">
      
      {/* --- TOP HUD BAR --- */}
      <header className="h-12 bg-[#0a1020] border border-[#1e293b] rounded flex justify-between items-center px-4 shrink-0">
        <div /> {/* Empty div to keep the flex spacing correct */}
        <div className="flex gap-6 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span className="uppercase tracking-wider">Data Pipe:</span>
            <span className="text-emerald-400">STABLE</span>
          </div>
        </div>
      </header>

      {/* --- MAIN GRID --- */}
      <div className="flex-1 flex gap-2 min-h-0">
        
        {/* LEFT COLUMN: SCANNER & WATCHLIST */}
        <div className="w-[400px] flex flex-col gap-2 shrink-0">
          
          <div className="flex-1 bg-[#0a1020] border border-[#1e293b] rounded flex flex-col min-h-0">
            <div className="h-10 border-b border-[#1e293b] flex justify-between items-center px-3 bg-[#0d142b]/50 shrink-0">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Activity size={14} /> Global Radar
              </span>
              <button 
                onClick={startLiveScan}
                disabled={isScanning || isSniping}
                className={`text-[10px] uppercase font-bold tracking-widest px-3 py-1 rounded transition-colors ${isScanning || isSniping ? 'text-amber-400 bg-amber-900/30' : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'}`}
              >
                {isScanning || isSniping ? <span className="flex items-center gap-2"><Activity size={10} className="animate-spin" /> Scanning</span> : 'Initialize Scan'}
              </button>
            </div>

            <div className="p-3 border-b border-[#1e293b] bg-[#050914] flex flex-col gap-3 shrink-0">
              <div className="flex bg-[#0a1020] border border-[#1e293b] rounded p-1 mb-1">
                <button 
                  onClick={() => setCapSize('mid')}
                  className={`flex-1 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors ${capSize === 'mid' ? 'bg-cyan-900/40 text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  S&P 400 (Mid)
                </button>
                <button 
                  onClick={() => setCapSize('small')}
                  className={`flex-1 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors ${capSize === 'small' ? 'bg-amber-900/40 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  S&P 600 (Small)
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center gap-1"><Filter size={10}/> Sectors</span>
                  <span className="text-[10px] text-cyan-400 font-mono">{scanSectors.length > 0 ? scanSectors.length : 'ALL'} Selected</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_SECTORS.map(s => (
                    <button 
                      key={s}
                      onClick={() => toggleSectorSelection(s)}
                      className={`px-2 py-0.5 text-[9px] uppercase tracking-wider rounded border transition-colors ${scanSectors.includes(s) ? 'bg-cyan-900/40 border-cyan-500/50 text-cyan-300' : 'bg-[#0a1020] border-[#1e293b] text-slate-500 hover:border-slate-600'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest">Radar Net Limit:</span>
                <input 
                  type="text" value={scanLimit} onChange={(e) => setScanLimit(e.target.value)}
                  className="bg-[#0a1020] text-xs font-mono text-cyan-400 border border-[#1e293b] rounded px-2 py-0.5 outline-none w-16 text-right focus:border-cyan-500/50"
                  placeholder="Max"
                />
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1 relative">
              {(isScanning || isSniping || scannedPairs.length === 0) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a1020]/80 backdrop-blur-[1px] z-10 pointer-events-none">
                  {(isScanning || isSniping) && <Activity className={`animate-spin mb-3 ${isSniping ? 'text-amber-400' : 'text-cyan-400'}`} size={24} />}
                  <span className={`text-[10px] font-mono tracking-widest uppercase text-center px-4 ${isSniping ? 'text-amber-400' : 'text-cyan-400'}`}>
                    {scanStatus}
                  </span>
                </div>
              )}

              {scannedPairs.map((pair) => {
                const isWatched = watchedPairs.some(p => p.id === pair.id);
                const velocityScore = ((pair.passRate * (1 + pair.r2)) / Math.pow(pair.halfLife, 1.5)).toFixed(2);

                return (
                  <div key={pair.id} className="flex justify-between items-center p-2 bg-[#050914] border border-[#1e293b] rounded hover:border-cyan-900/50 transition-colors group">
                    <div className="flex flex-col">
                      <span className="font-bold text-sm text-slate-200">{pair.assetA}-{pair.assetB}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[8px] font-bold text-cyan-500/70 border border-cyan-500/20 px-1 rounded uppercase tracking-wider">{pair.sector}</span>
                        <span className="text-[9px] font-mono text-slate-500">HL:{pair.halfLife}d | Score: <span className="text-amber-400 font-bold">{velocityScore}</span></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-xs ${pair.passRate >= 80 ? 'text-emerald-400' : 'text-slate-400'}`}>{pair.passRate}%</span>
                      <button 
                        onClick={() => addToWatchlist(pair)} disabled={isWatched}
                        className={`p-1.5 rounded ${isWatched ? 'text-emerald-500 opacity-50 cursor-not-allowed' : 'bg-[#1e293b] text-slate-300 hover:bg-cyan-900/50 hover:text-cyan-400'}`}
                      >
                        {isWatched ? <Check size={14} /> : <Plus size={14} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex-1 bg-[#0a1020] border border-[#1e293b] rounded flex flex-col min-h-0">
            <div className="h-10 border-b border-[#1e293b] flex items-center justify-between px-3 bg-[#0d142b]/50 shrink-0">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Layers size={14} /> Active Portfolio
              </span>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-fuchsia-400 font-mono">{selectedPairs.length} Selected</span>
                {watchedPairs.length > 0 && (
                  <button 
                    onClick={clearPortfolio}
                    className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-widest text-slate-500 hover:text-rose-400 transition-colors outline-none"
                    title="Clear Portfolio"
                  >
                    <Trash2 size={12} /> Clear
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {watchedPairs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-600 font-mono">QUEUE EMPTY</div>
              ) : (
                watchedPairs.map((pair) => {
                  const isSelected = selectedPairs.some(p => p.id === pair.id);
                  return (
                    <div 
                      key={pair.id} onClick={() => togglePairSelection(pair)}
                      className={`cursor-pointer flex justify-between items-center p-2 rounded transition-all border ${isSelected ? 'bg-fuchsia-900/20 border-fuchsia-500/50' : 'bg-[#050914] border-[#1e293b] hover:border-slate-700'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-fuchsia-400' : 'bg-slate-700'}`}></div>
                        <span className={`font-bold text-sm ${isSelected ? 'text-fuchsia-400' : 'text-slate-300'}`}>
                          {pair.assetA}-{pair.assetB}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-slate-500 border border-[#1e293b] px-1.5 rounded">{pair.passRate}%</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: BACKTEST TERMINAL */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          
          <div className="h-24 flex gap-2 shrink-0">
            <div className="flex-1 bg-[#0a1020] border border-[#1e293b] rounded p-3 flex flex-col justify-center">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Portfolio Exposure</span>
              <span className="text-2xl font-bold text-white">
                {selectedPairs.length === 0 ? '---' : `${selectedPairs.length} Active Pair${selectedPairs.length > 1 ? 's' : ''}`}
              </span>
            </div>
            
            <div className="flex-1 bg-[#0a1020] border border-[#1e293b] rounded p-3 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Overall Net Return</span>
                <span className={`text-2xl font-mono font-light ${backtestMetrics.portfolioReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {backtestMetrics.portfolioReturn > 0 ? '+' : ''}{backtestMetrics.portfolioReturn.toFixed(2)}%
                </span>
              </div>
              <div className="h-full w-px bg-[#1e293b] mx-4"></div>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Overall Alpha vs SPY</span>
                <span className={`text-2xl font-mono font-light ${backtestMetrics.alpha >= 0 ? 'text-fuchsia-400' : 'text-rose-400'}`}>
                  {backtestMetrics.alpha > 0 ? '+' : ''}{backtestMetrics.alpha.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="w-64 bg-[#0a1020] border border-[#1e293b] rounded p-3 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Total Win Rate</span>
                <span className="text-xl font-bold text-white">{backtestMetrics.winRate}%</span>
              </div>
              <div className="flex flex-col text-right">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Max DD</span>
                <span className="text-xl font-mono text-rose-400">{backtestMetrics.drawdown.toFixed(2)}%</span>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 gap-2">
            
            <div className="h-14 bg-[#0a1020] border border-[#1e293b] rounded flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-6">
                <div className="flex bg-[#050914] border border-[#1e293b] rounded p-1">
                  <button 
                    onClick={() => setChartMode('combined')}
                    className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-2 ${chartMode === 'combined' ? 'bg-fuchsia-900/40 text-fuchsia-400' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    <Layers size={12} /> Combined
                  </button>
                  <button 
                    onClick={() => setChartMode('compare')}
                    className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-2 ${chartMode === 'compare' ? 'bg-cyan-900/40 text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    <Split size={12} className="rotate-90" /> Compare
                  </button>
                </div>
                
                <div className="h-6 w-px bg-[#1e293b]"></div>
                
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest">Window:</span>
                  <select 
                    value={btDays} onChange={(e) => setBtDays(Number(e.target.value))}
                    className="bg-[#050914] text-xs font-mono text-slate-300 border border-[#1e293b] rounded px-2 py-1 outline-none focus:border-fuchsia-500/50 transition-colors"
                  >
                    <option value={30}>30 Days</option>
                    <option value={60}>60 Days</option>
                    <option value={90}>90 Days</option>
                    <option value={180}>180 Days</option>
                    <option value={252}>1 Year (252 Trading Days)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest">Take Profit:</span>
                  <div className="relative">
                    <input 
                      type="text" value={btTP} onChange={(e) => setBtTP(e.target.value)}
                      className="bg-[#050914] text-xs font-mono text-emerald-400 border border-[#1e293b] rounded pl-2 pr-6 py-1 outline-none w-20 focus:border-emerald-500/50 transition-colors"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest">Stop Loss:</span>
                  <div className="relative">
                    <input 
                      type="text" value={btSL} onChange={(e) => setBtSL(e.target.value)}
                      className="bg-[#050914] text-xs font-mono text-rose-400 border border-[#1e293b] rounded pl-2 pr-6 py-1 outline-none w-20 focus:border-rose-500/50 transition-colors"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
                  </div>
                </div>
              </div>

              <button 
                onClick={runBacktest} disabled={isBacktesting || selectedPairs.length === 0}
                className={`h-8 shrink-0 px-4 rounded text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${isBacktesting ? 'bg-fuchsia-900/40 text-fuchsia-500 cursor-not-allowed' : 'bg-fuchsia-600 text-white hover:bg-fuchsia-500 shadow-[0_0_15px_-3px_rgba(217,70,239,0.4)]'}`}
              >
                <Play size={12} fill="currentColor" /> {isBacktesting ? 'Running...' : 'Run Simulation'}
              </button>
            </div>

            <div className="flex-1 bg-[#0a1020] border border-[#1e293b] rounded flex flex-col min-h-0 relative">
              <div className="absolute top-3 right-3 flex items-center gap-2 bg-[#050914] px-2 py-1 rounded border border-[#1e293b] z-10">
                <BarChart3 size={12} className={chartMode === 'combined' ? "text-fuchsia-400" : "text-cyan-400"} />
                <span className="text-[10px] font-mono text-slate-400">{chartMode === 'combined' ? 'AVERAGED PORTFOLIO CURVE' : 'INDIVIDUAL PAIR COMPARISON'}</span>
              </div>

              {selectedPairs.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm font-mono text-slate-600">NO PAIRS SELECTED</div>
              ) : isBacktesting ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-fuchsia-400">
                  <Activity className="animate-spin" size={32} />
                </div>
              ) : (
                <div className="flex-1 w-full h-full p-4 pb-0 pt-8">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={backtestData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="day" stroke="#475569" tick={{fontSize: 10, fontFamily: 'monospace'}} axisLine={false} tickLine={false} minTickGap={30} />
                      
                      <YAxis stroke="#475569" tick={{fontSize: 10, fontFamily: 'monospace'}} tickFormatter={(val: any) => `${val}%`} axisLine={false} tickLine={false} orientation="right" />
                      <Tooltip contentStyle={{ backgroundColor: '#050914', borderColor: '#1e293b', fontFamily: 'monospace', fontSize: '12px' }} itemStyle={{ color: '#f1f5f9' }} formatter={(value: any) => [`${value}%`]} />
                      
                      <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace', color: '#94a3b8' }} />
                      <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                      <Line type="monotone" name="S&P 500" dataKey="spyReturn" stroke="#64748b" strokeWidth={2} dot={false} isAnimationActive={true} />
                      
                      {chartMode === 'combined' ? (
                        <Line type="monotone" name="Portfolio Average" dataKey="portfolioReturn" stroke="#d946ef" strokeWidth={3} dot={false} isAnimationActive={true} />
                      ) : (
                        selectedPairs.map((p, idx) => {
                          const pairKey = `${p.assetA}-${p.assetB}`;
                          return (
                            <Line key={pairKey} type="monotone" name={pairKey} dataKey={pairKey} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={true} />
                          )
                        })
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="h-48 bg-[#0a1020] border border-[#1e293b] rounded flex flex-col min-h-0 relative shrink-0">
              <div className="h-8 border-b border-[#1e293b] flex items-center px-3 bg-[#0d142b]/50 shrink-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <History size={12} /> Execution Ledger
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {selectedPairs.length === 0 || isBacktesting ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-600 font-mono">STANDBY</div>
                ) : backtestTrades.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-600 font-mono">NO TRADES EXECUTED IN WINDOW</div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="text-[10px] uppercase tracking-widest text-slate-500 sticky top-0 bg-[#0a1020] z-10">
                      <tr>
                        <th className="pb-2 font-medium">Pair</th>
                        <th className="pb-2 font-medium">Signal</th>
                        <th className="pb-2 font-medium">Exit Reason</th>
                        <th className="pb-2 font-medium">Dates</th>
                        <th className="pb-2 font-medium text-right">Net Return</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs font-mono text-slate-300">
                      {backtestTrades.map((trade, idx) => (
                        <tr key={idx} className="border-b border-[#1e293b]/50 hover:bg-[#1e293b]/20 transition-colors">
                          <td className="py-3 font-bold text-fuchsia-400">{trade.pair}</td>
                          <td className={`py-3 ${trade.type === 'LONG SPREAD' ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.type}</td>
                          <td className={`py-3 font-bold ${trade.exitReason === 'TAKE PROFIT' ? 'text-emerald-500' : trade.exitReason === 'STOP LOSS' ? 'text-rose-500' : 'text-amber-500'}`}>{trade.exitReason}</td>
                          <td className="py-3 text-slate-400">{trade.entry} &rarr; {trade.exit}</td>
                          <td className={`py-3 text-right text-sm font-bold ${trade.returnPct > 0 ? 'text-emerald-400' : trade.returnPct < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {trade.returnPct > 0 ? '+' : ''}{trade.returnPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}