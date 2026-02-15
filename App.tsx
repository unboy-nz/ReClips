import React, { useState, useCallback, useRef } from 'react';
import { GeminiService } from './services/geminiService';
import { RecapState, VoiceName, VoiceDescriptions, StoryTone, ToneDescriptions } from './types';
import { decode, decodeAudioData, audioBufferToWav, applyEffects } from './utils/audioUtils';
import { generateSRT } from './utils/srtUtils';

// UI Components extracted from App to avoid re-declaration on render and fix type issues
const Panel = ({ children, className = "" }: { children?: React.ReactNode, className?: string }) => (
  <div className={`bg-[#0a0a0a]/60 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl overflow-hidden ${className}`}>
    {children}
  </div>
);

const SectionHeader = ({ title, icon }: { title: string, icon: React.ReactNode }) => (
  <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-white/5">
    <div className="p-2 rounded-lg bg-white/5 text-cyan-400">
      {icon}
    </div>
    <h3 className="font-bold text-white tracking-wide text-sm uppercase">{title}</h3>
  </div>
);

export const App: React.FC = () => {
  // App Content State
  const [state, setState] = useState<RecapState>({
    transcript: '',
    title: '',
    script: '',
    hooks: [],
    isGeneratingScript: false,
    isGeneratingAudio: false,
    audioUrl: null,
    srtUrl: null,
    error: null,
    narrationSpeed: 1.05,
    enableMastering: true,
    selectedTone: StoryTone.Dramatic,
    videoDuration: null,
    syncToVideo: false,
  });

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.Kore);
  const [previewingVoice, setPreviewingVoice] = useState<VoiceName | null>(null);
  const [copiedHookIndex, setCopiedHookIndex] = useState<number | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scriptTextareaRef = useRef<HTMLTextAreaElement>(null);

  const formatDuration = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const handleFetchUrl = async () => {
    if (!youtubeUrl.trim()) {
      setState(prev => ({ ...prev, error: "ကျေးဇူးပြု၍ YouTube URL ထည့်ပေးပါ။" }));
      return;
    }
    setIsFetchingUrl(true);
    setState(prev => ({ ...prev, error: null, videoDuration: null, syncToVideo: false }));
    try {
      const gemini = new GeminiService();
      const transcript = await gemini.fetchTranscriptFromUrl(youtubeUrl);
      setState(prev => ({ ...prev, transcript, error: null }));
    } catch (err: any) {
      setState(prev => ({ ...prev, error: "YouTube မှ အချက်အလက်ယူ၍မရပါ။ URL မှန်မမှန် စစ်ဆေးပေးပါ။" }));
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Updated Max Size to 20MB for inline processing
    const MAX_SIZE = 20 * 1024 * 1024; 
    if (file.size > MAX_SIZE) {
      setState(prev => ({ ...prev, error: "ဗီဒီယိုဖိုင် အရမ်းကြီးနေပါတယ်။ 20MB အောက်ဖိုင်များကိုသာ တိုက်ရိုက်တင်နိုင်ပါသည်။ ပိုကြီးသောဖိုင်များအတွက် YouTube Link ကိုအသုံးပြုပါ။" }));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsProcessingVideo(true);
    setState(prev => ({ ...prev, error: null, videoDuration: null, syncToVideo: false }));

    const objectUrl = URL.createObjectURL(file);
    const videoElement = document.createElement('video');
    videoElement.preload = 'metadata';
    videoElement.onloadedmetadata = () => {
      setState(prev => ({ ...prev, videoDuration: videoElement.duration }));
      URL.revokeObjectURL(objectUrl);
    };
    videoElement.onerror = () => {
       URL.revokeObjectURL(objectUrl);
    };
    videoElement.src = objectUrl;

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const base64String = (reader.result as string).split(',')[1];
          const gemini = new GeminiService();
          const transcript = await gemini.processVideo(base64String, file.type);
          setState(prev => ({ ...prev, transcript, error: null }));
        } catch (err: any) {
          console.error("Processing Error:", err);
          setState(prev => ({ ...prev, error: err.message || "ဗီဒီယိုကို စစ်ဆေးရာတွင် အမှားအယွင်းရှိနေပါသည်။" }));
        } finally {
          setIsProcessingVideo(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
    } catch (err: any) {
      setState(prev => ({ ...prev, error: "File handling error." }));
      setIsProcessingVideo(false);
    }
  };

  const handleGenerateScript = async () => {
    if (!state.transcript.trim()) return;
    setState(prev => ({ ...prev, isGeneratingScript: true, error: null }));
    try {
      const gemini = new GeminiService();
      const script = await gemini.generateRecapScript(state.transcript, state.selectedTone);
      const [hooks, title] = await Promise.all([
        gemini.extractHooks(script),
        gemini.generateTitle(script)
      ]);
      setState(prev => ({ ...prev, script, hooks, title, isGeneratingScript: false }));
    } catch (err: any) {
      setState(prev => ({ ...prev, error: "Script ဖန်တီး၍မရပါ။ ထပ်မံကြိုးစားကြည့်ပါ။", isGeneratingScript: false }));
    }
  };

  const applyFormatting = (type: 'bold' | 'italic' | 'bullet' | 'strike' | 'code') => {
    const textarea = scriptTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = state.script;
    const selectedText = text.substring(start, end);
    let newText = text;
    let cursorOffset = 0;
    switch (type) {
      case 'bold': newText = text.substring(0, start) + `**${selectedText}**` + text.substring(end); cursorOffset = 2; break;
      case 'italic': newText = text.substring(0, start) + `*${selectedText}*` + text.substring(end); cursorOffset = 1; break;
      case 'bullet': newText = text.substring(0, start) + selectedText.split('\n').map(l => `- ${l}`).join('\n') + text.substring(end); cursorOffset = 2; break;
      case 'strike': newText = text.substring(0, start) + `~~${selectedText}~~` + text.substring(end); cursorOffset = 2; break;
      case 'code': newText = text.substring(0, start) + `\`${selectedText}\`` + text.substring(end); cursorOffset = 1; break;
    }
    setState(prev => ({ ...prev, script: newText }));
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + cursorOffset, end + cursorOffset);
    }, 0);
  };

  const handlePreviewVoice = async (voice: VoiceName, e: React.MouseEvent) => {
    e.stopPropagation();
    if (previewingVoice) return;
    
    setPreviewingVoice(voice);
    try {
      const gemini = new GeminiService();
      const previewText = `မင်္ဂလာပါ၊ ကျွန်တော်ကတော့ ${VoiceDescriptions[voice].label} ဖြစ်ပါတယ်။`;
      const base64Audio = await gemini.generateAudio(previewText, voice);
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
      
      const processedBuffer = await applyEffects(audioBuffer, state.narrationSpeed, state.enableMastering);
      const url = URL.createObjectURL(audioBufferToWav(processedBuffer));
      
      const audio = new Audio(url);
      audio.onended = () => {
        setPreviewingVoice(null);
        URL.revokeObjectURL(url);
      };
      audio.play();
    } catch (err) {
      console.error("Voice preview failed", err);
      setPreviewingVoice(null);
    }
  };

  const handleGenerateAudio = async () => {
    if (!state.script) return;
    setState(prev => ({ ...prev, isGeneratingAudio: true, error: null }));
    try {
      const cleanScript = state.script.replace(/~~/g, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').replace(/^- /gm, '');
      const gemini = new GeminiService();
      const base64Audio = await gemini.generateAudio(cleanScript, selectedVoice);
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
      
      let speed = state.narrationSpeed;
      
      if (state.syncToVideo && state.videoDuration) {
        speed = audioBuffer.duration / state.videoDuration;
      }

      const processedBuffer = await applyEffects(audioBuffer, speed, state.enableMastering);
      const wavBlob = audioBufferToWav(processedBuffer);
      const audioUrl = URL.createObjectURL(wavBlob);

      // Generate SRT
      const srtContent = generateSRT(cleanScript, processedBuffer.duration);
      const srtBlob = new Blob([srtContent], { type: 'text/plain' });
      const srtUrl = URL.createObjectURL(srtBlob);

      setState(prev => ({ ...prev, audioUrl, srtUrl, isGeneratingAudio: false }));
    } catch (err: any) {
      console.error(err);
      setState(prev => ({ ...prev, error: "အသံဖိုင်ထုတ်လုပ်၍မရပါ။", isGeneratingAudio: false }));
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedHookIndex(index);
    setTimeout(() => setCopiedHookIndex(null), 2000);
  };

  const handleClearAll = () => {
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    if (state.srtUrl) URL.revokeObjectURL(state.srtUrl);
    setYoutubeUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setState({
      transcript: '', title: '', script: '', hooks: [],
      isGeneratingScript: false, isGeneratingAudio: false,
      audioUrl: null, srtUrl: null, error: null,
      narrationSpeed: 1.05, enableMastering: true,
      selectedTone: StoryTone.Dramatic,
      videoDuration: null,
      syncToVideo: false,
    });
  };

  return (
    <div className="min-h-screen text-slate-200 pb-20 selection:bg-cyan-500/30 selection:text-cyan-100 font-sans">
      
      {/* Top Navbar/Header */}
      <nav className="w-full border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg">M</div>
            <span className="font-bold text-lg tracking-tight text-white">MovieRecap<span className="text-cyan-400">.ai</span></span>
          </div>
          <button 
            onClick={handleClearAll} 
            className="text-xs font-semibold text-white/40 hover:text-white transition-colors uppercase tracking-wider"
          >
            Reset Project
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* Main Header Area */}
        <header className="text-center mb-12 py-10">
          <h1 className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-white/50 mb-4 tracking-tight drop-shadow-2xl">
            Turn Video into <br className="hidden md:block" />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">Compelling Burmese Stories</span>
          </h1>
          <p className="text-white/40 max-w-2xl mx-auto text-lg font-light">
            An advanced AI pipeline that transcribes, rewrites, and narrates movie recaps with cinematic precision.
          </p>
        </header>

        {/* Error Banner */}
        {state.error && (
          <div className="max-w-4xl mx-auto mb-8 animate-in fade-in slide-in-from-top-4">
             <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-4 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                <svg className="w-6 h-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <p className="text-sm font-medium myanmar-font">{state.error}</p>
             </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Input & Configuration */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* 1. Source Input */}
            <Panel>
              <SectionHeader 
                title="Input Source" 
                icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
              />
              
              <div className="p-6 space-y-6">
                {/* YouTube */}
                <div className="relative">
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">YouTube Link</label>
                  <div className="flex rounded-xl bg-black/30 border border-white/10 focus-within:ring-2 focus-within:ring-cyan-500/30 focus-within:border-cyan-500/50 transition-all">
                    <input 
                      type="text" 
                      value={youtubeUrl} 
                      onChange={e => setYoutubeUrl(e.target.value)} 
                      placeholder="https://youtube.com/watch?v=..."
                      className="flex-grow bg-transparent border-none text-white text-sm px-4 py-3 focus:ring-0 placeholder-white/20"
                    />
                    <button 
                      onClick={handleFetchUrl} 
                      disabled={isFetchingUrl || isProcessingVideo}
                      className="px-5 text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:bg-white/5 border-l border-white/10 transition-colors disabled:opacity-50"
                    >
                      {isFetchingUrl ? 'FETCHING...' : 'FETCH'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="h-px bg-white/10 flex-grow"></div>
                  <span className="text-[10px] font-bold text-white/30">OR</span>
                  <div className="h-px bg-white/10 flex-grow"></div>
                </div>

                {/* File Upload */}
                <div>
                   <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Upload Video</label>
                   <input type="file" ref={fileInputRef} onChange={handleVideoFileChange} accept="video/*" className="hidden" />
                   <button 
                     onClick={() => fileInputRef.current?.click()}
                     disabled={isProcessingVideo || isFetchingUrl}
                     className={`w-full group relative overflow-hidden border border-dashed rounded-xl p-6 transition-all duration-300 flex flex-col items-center gap-2 ${
                       isProcessingVideo 
                       ? 'border-cyan-500/50 bg-cyan-900/10 cursor-wait' 
                       : 'border-white/20 hover:border-cyan-400/50 hover:bg-white/5'
                     }`}
                   >
                      {isProcessingVideo ? (
                        <>
                           <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                           <span className="text-xs font-bold text-cyan-400 animate-pulse">ANALYZING VIDEO...</span>
                        </>
                      ) : (
                        <>
                           <svg className="w-8 h-8 text-white/30 group-hover:text-cyan-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                           <div className="text-center">
                              <span className="block text-sm font-medium text-white/80">Click to Browse</span>
                              <span className="block text-[10px] text-white/40 mt-1">MP4, MOV (Max 20MB)</span>
                           </div>
                        </>
                      )}
                   </button>
                </div>

                {/* Video Meta Stats */}
                {state.videoDuration && (
                  <div className="flex items-center justify-between bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-4 py-3">
                     <div className="flex items-center gap-2 text-cyan-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-xs font-bold">Duration Detected</span>
                     </div>
                     <span className="font-mono text-sm text-white font-medium">{formatDuration(state.videoDuration)}</span>
                  </div>
                )}
                
                {/* Transcript Preview */}
                <div className="pt-4 border-t border-white/5">
                   <div className="flex justify-between items-center mb-2">
                      <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Transcript / Analysis</label>
                      <span className="text-[10px] text-white/20">{state.transcript.length} chars</span>
                   </div>
                   <textarea 
                     value={state.transcript} 
                     onChange={e => setState(p => ({...p, transcript: e.target.value}))}
                     className="w-full h-32 bg-black/30 border border-white/10 rounded-lg p-3 text-xs text-white/60 font-mono resize-none focus:ring-1 focus:ring-white/20 focus:outline-none scrollbar-thin"
                     placeholder="Video content analysis will appear here..."
                   />
                </div>
              </div>
            </Panel>

            {/* 2. Narrative Style */}
            <Panel>
              <SectionHeader 
                title="Narrative Style" 
                icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>}
              />
              <div className="p-6">
                <div className="grid grid-cols-2 gap-3 mb-6">
                   {(Object.keys(ToneDescriptions) as StoryTone[]).map(tone => {
                      const info = ToneDescriptions[tone];
                      const isSelected = state.selectedTone === tone;
                      return (
                        <button
                           key={tone}
                           onClick={() => setState(p => ({ ...p, selectedTone: tone }))}
                           className={`relative p-3 rounded-xl border text-left transition-all duration-200 ${
                             isSelected 
                             ? 'bg-purple-500/20 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.15)]' 
                             : 'bg-white/5 border-white/5 hover:bg-white/10'
                           }`}
                        >
                           <div className="text-xl mb-1">{info.emoji}</div>
                           <div className={`text-xs font-bold uppercase tracking-wide ${isSelected ? 'text-purple-300' : 'text-white/60'}`}>{info.label}</div>
                           <div className="text-[10px] text-white/30 truncate mt-1 myanmar-font">{info.description}</div>
                        </button>
                      )
                   })}
                </div>

                <button 
                  onClick={handleGenerateScript} 
                  disabled={!state.transcript || state.isGeneratingScript}
                  className={`w-full py-4 rounded-xl font-bold uppercase tracking-wider text-sm shadow-lg transition-all transform active:scale-[0.98] flex items-center justify-center gap-3 ${
                    !state.transcript 
                    ? 'bg-white/10 text-white/20 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-purple-500/20'
                  }`}
                >
                   {state.isGeneratingScript ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        WRITING SCRIPT...
                      </>
                   ) : (
                      <>GENERATE SCRIPT</>
                   )}
                </button>
              </div>
            </Panel>
          </div>

          {/* Right Column: Editor & Output */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* 3. Script Editor */}
            <Panel className="min-h-[500px] flex flex-col">
               <SectionHeader 
                  title="Script Editor" 
                  icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
               />
               
               <div className="flex-grow p-6 flex flex-col">
                  {/* Title & Toolbar */}
                  <div className="flex flex-wrap gap-4 items-center justify-between mb-4 pb-4 border-b border-white/5">
                     <div className="flex-grow min-w-[200px]">
                        <input 
                           type="text" 
                           placeholder="Movie Title (Burmese)" 
                           value={state.title} 
                           onChange={e => setState(p => ({...p, title: e.target.value}))}
                           className="w-full bg-transparent border-none p-0 text-xl font-bold text-white placeholder-white/20 focus:ring-0 myanmar-font"
                        />
                     </div>
                     <div className="flex gap-1 bg-black/40 rounded-lg p-1">
                        {[
                          { id: 'bold', label: 'B', class: 'font-bold' },
                          { id: 'italic', label: 'I', class: 'italic' },
                          { id: 'strike', label: 'S', class: 'line-through' },
                          { id: 'bullet', label: '•', class: '' },
                        ].map((btn) => (
                           <button 
                              key={btn.id}
                              onClick={() => applyFormatting(btn.id as any)}
                              className={`w-7 h-7 rounded flex items-center justify-center text-xs text-white/60 hover:bg-white/10 hover:text-white transition-colors ${btn.class}`}
                           >
                              {btn.label}
                           </button>
                        ))}
                     </div>
                  </div>

                  {/* Textarea */}
                  <div className="flex-grow relative group">
                     {!state.script && (
                        <div className="absolute inset-0 flex items-center justify-center text-white/10 pointer-events-none">
                           <div className="text-center">
                              <svg className="w-12 h-12 mx-auto mb-2 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              <p className="text-sm">Generated script will appear here</p>
                           </div>
                        </div>
                     )}
                     <textarea 
                        ref={scriptTextareaRef}
                        value={state.script}
                        onChange={e => setState(p => ({...p, script: e.target.value}))}
                        className="w-full h-full min-h-[400px] bg-transparent border-none resize-none text-base leading-loose text-slate-200 placeholder-transparent focus:ring-0 myanmar-font scrollbar-thin"
                     />
                  </div>

                  {/* Hooks Chips */}
                  {state.hooks.length > 0 && (
                     <div className="mt-6 pt-6 border-t border-white/5">
                        <label className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest mb-3 block">Viral Hooks (Click to Copy)</label>
                        <div className="flex flex-wrap gap-2">
                           {state.hooks.map((hook, idx) => (
                              <button 
                                 key={idx} 
                                 onClick={() => copyToClipboard(hook, idx)}
                                 className="group relative max-w-full text-left bg-cyan-900/10 border border-cyan-500/20 hover:border-cyan-400/50 hover:bg-cyan-500/10 px-3 py-2 rounded-lg transition-all"
                              >
                                 <p className="text-xs text-cyan-100/80 truncate max-w-xs myanmar-font">{hook}</p>
                                 {copiedHookIndex === idx && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-cyan-500 rounded-lg">
                                       <span className="text-[10px] font-bold text-black uppercase">Copied!</span>
                                    </div>
                                 )}
                              </button>
                           ))}
                        </div>
                     </div>
                  )}
               </div>
            </Panel>

            {/* 4. Audio Production */}
            <Panel className={!state.script ? 'opacity-50 pointer-events-none grayscale' : ''}>
               <SectionHeader 
                  title="Voice & Production" 
                  icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>}
               />
               <div className="p-6">
                  {/* Voice Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
                     {(Object.keys(VoiceDescriptions) as VoiceName[]).map(v => {
                        const voice = VoiceDescriptions[v];
                        const isSelected = selectedVoice === v;
                        return (
                           <div 
                              key={v}
                              onClick={() => setSelectedVoice(v)}
                              className={`cursor-pointer rounded-xl p-3 border transition-all relative overflow-hidden group ${
                                 isSelected ? 'bg-cyan-500/10 border-cyan-500/50' : 'bg-white/5 border-white/5 hover:bg-white/10'
                              }`}
                           >
                              <div className="flex items-center gap-3 relative z-10">
                                 <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shadow-inner ${isSelected ? 'bg-cyan-500 text-black' : 'bg-black/40 text-white/50'}`}>
                                    {voice.icon}
                                 </div>
                                 <div className="overflow-hidden">
                                    <h4 className={`text-sm font-bold truncate ${isSelected ? 'text-white' : 'text-white/70'}`}>{voice.label}</h4>
                                    <p className="text-[10px] text-white/40 truncate">{voice.role}</p>
                                 </div>
                              </div>
                              
                              <button 
                                 onClick={(e) => handlePreviewVoice(v, e)}
                                 className="absolute top-2 right-2 p-1.5 rounded-full text-white/20 hover:text-cyan-400 hover:bg-white/10 transition-all z-20"
                                 title="Preview Voice"
                              >
                                 {previewingVoice === v ? (
                                    <span className="block w-2 h-2 bg-cyan-400 rounded-full animate-ping" />
                                 ) : (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" /></svg>
                                 )}
                              </button>
                           </div>
                        )
                     })}
                  </div>

                  {/* Settings */}
                  <div className="bg-black/30 rounded-xl p-5 border border-white/5 mb-8">
                     <div className="flex flex-col sm:flex-row gap-8">
                        {/* Speed */}
                        <div className="flex-1 space-y-3">
                           <div className="flex justify-between items-center">
                              <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Speed</label>
                              <span className="text-xs font-mono text-cyan-400 bg-cyan-900/30 px-2 py-0.5 rounded">{state.narrationSpeed.toFixed(2)}x</span>
                           </div>
                           <input 
                              type="range" min="0.75" max="1.5" step="0.05"
                              disabled={state.syncToVideo}
                              value={state.narrationSpeed}
                              onChange={e => setState(p => ({ ...p, narrationSpeed: parseFloat(e.target.value) }))}
                              className={`w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(6,182,212,0.5)] ${state.syncToVideo ? 'opacity-30 cursor-not-allowed' : ''}`}
                           />
                           {state.videoDuration && (
                              <label className="flex items-center gap-2 cursor-pointer mt-2 group">
                                 <input type="checkbox" checked={state.syncToVideo} onChange={e => setState(p => ({...p, syncToVideo: e.target.checked}))} className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-offset-0 focus:ring-0" />
                                 <span className={`text-xs ${state.syncToVideo ? 'text-cyan-300' : 'text-white/40 group-hover:text-white/60'} transition-colors`}>Match video duration ({formatDuration(state.videoDuration)})</span>
                              </label>
                           )}
                        </div>
                        
                        {/* Mastering */}
                        <div className="flex-1 space-y-3 pt-1 sm:border-l sm:border-white/10 sm:pl-8">
                           <div className="flex justify-between items-center">
                              <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Audio Processing</label>
                           </div>
                           <div className="flex items-center justify-between bg-white/5 p-2 rounded-lg border border-white/5">
                              <div className="flex items-center gap-2">
                                 <div className="p-1.5 bg-purple-500/20 rounded text-purple-400">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                                 </div>
                                 <span className="text-xs font-medium text-white/80">AI Mastering</span>
                              </div>
                              <button onClick={() => setState(p => ({ ...p, enableMastering: !p.enableMastering }))} className={`w-9 h-5 rounded-full relative transition-colors duration-300 ${state.enableMastering ? 'bg-purple-500' : 'bg-white/20'}`}>
                                 <div className={`absolute top-1 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-300 ${state.enableMastering ? 'translate-x-5' : 'translate-x-1'}`}></div>
                              </button>
                           </div>
                        </div>
                     </div>
                  </div>

                  <button 
                     onClick={handleGenerateAudio}
                     disabled={state.isGeneratingAudio}
                     className="w-full py-4 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 rounded-xl font-bold tracking-widest text-sm text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:transform-none"
                  >
                     {state.isGeneratingAudio ? (
                        <div className="flex items-center justify-center gap-2">
                           <div className="w-5 h-5 border-2 border-white/50 border-t-white rounded-full animate-spin"></div>
                           <span>RENDERING AUDIO...</span>
                        </div>
                     ) : (
                        "GENERATE FINAL AUDIO"
                     )}
                  </button>

                  {/* Result Player */}
                  {state.audioUrl && (
                     <div className="mt-8 animate-in slide-in-from-bottom-4 fade-in">
                        <div className="bg-[#111] border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
                           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-blue-500"></div>
                           
                           <div className="flex justify-between items-start mb-6">
                              <div>
                                 <h5 className="text-white font-bold text-lg mb-1">{state.title || "Untitled Project"}</h5>
                                 <p className="text-xs text-white/40 uppercase tracking-wider font-mono">Mastered • {state.syncToVideo ? 'Synced' : 'Standard'} • {VoiceDescriptions[selectedVoice].label}</p>
                              </div>
                              <div className="flex gap-2">
                                 {state.srtUrl && (
                                    <a 
                                        href={state.srtUrl} 
                                        download={`${(state.title || "recap").replace(/\s+/g, '_')}.srt`}
                                        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold text-white transition-colors border border-white/5"
                                    >
                                        <span className="text-cyan-400 font-mono text-[10px] border border-cyan-400 rounded px-1">CC</span>
                                        DOWNLOAD SRT
                                    </a>
                                 )}
                                 <a 
                                    href={state.audioUrl} 
                                    download={`${(state.title || "recap").replace(/\s+/g, '_')}.wav`}
                                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold text-white transition-colors"
                                 >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    DOWNLOAD .WAV
                                 </a>
                              </div>
                           </div>
                           
                           <audio src={state.audioUrl} controls className="w-full h-10 block rounded-lg outline-none invert-[.9] contrast-[.85] hue-rotate-180" />
                        </div>
                     </div>
                  )}
               </div>
            </Panel>

          </div>
        </div>
      </div>
    </div>
  );
};