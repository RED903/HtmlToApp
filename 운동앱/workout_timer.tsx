import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Check, PlayCircle, RotateCcw, Dumbbell, Sun } from 'lucide-react';

const REST_TIME = 120; // 휴식 시간 2분 (120초)

// 운동 루틴 데이터
const routine = [
  { name: '풀업', weight: '맨몸', reps: '12회', sets: 3, query: '풀업+자세' },
  { name: '덤벨 프레스', weight: '14kg 양손', reps: '12회', sets: 3, query: '덤벨+프레스+자세' },
  { name: '불가리안 스플릿 스쿼트', weight: '14kg 양손', reps: '각 12회', sets: 3, query: '불가리안+스플릿+스쿼트+자세' },
  { name: '해머컬 & 이두컬', weight: '7.5kg 양손', reps: '해머 13회 + 이두 12회', sets: 3, query: '해머컬+이두컬+자세' },
  { name: '원암 오버헤드 익스텐션', weight: '7.5kg', reps: '각 12회', sets: 3, query: '원암+오버헤드+익스텐션+자세' },
  { name: '사레레', weight: '7.5kg 양손', reps: '12회', sets: 3, query: '사이드+레터럴+레이즈+자세' },
];

// 루틴을 단계(Step) 배열로 변환
const steps = [];
routine.forEach((exercise, eIndex) => {
  for (let i = 1; i <= exercise.sets; i++) {
    // 1. 운동 단계
    steps.push({
      type: 'workout',
      exerciseIndex: eIndex + 1,
      totalExercises: routine.length,
      name: exercise.name,
      set: i,
      totalSets: exercise.sets,
      query: exercise.query
    });
    
    // 2. 휴식 단계 (마지막 세트 후 제외) - 세트 정보 유지
    const isLastExercise = eIndex === routine.length - 1 && i === exercise.sets;
    if (!isLastExercise) {
      steps.push({
        type: 'rest',
        exerciseIndex: eIndex + 1,
        totalExercises: routine.length,
        name: exercise.name,
        set: i,
        totalSets: exercise.sets,
        query: exercise.query
      });
    }
  }
});

export default function App() {
  const [stepIndex, setStepIndex] = useState(-1);
  const [time, setTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const audioCtxRef = useRef(null);
  const wakeLockRef = useRef(null);

  // 화면 꺼짐 방지 (Wake Lock)
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        setWakeLockActive(true);
      }
    } catch (err) {
      console.warn('Wake Lock 요청 실패:', err);
      setWakeLockActive(false);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current !== null) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  };

  // 탭 전환 시 화면 꺼짐 방지 재요청
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && stepIndex >= 0 && stepIndex < steps.length) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [stepIndex]);

  // 오디오 컨텍스트 초기화
  const initAudio = () => {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.001);
    }
  };

  // "또도동 x 3" Sound Synthesizer
  const playTtododongX3 = () => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const notes = [523.25, 659.25, 784.00]; // C5, E5, G5
    let startTime = ctx.currentTime + 0.05;

    for (let rep = 0; rep < 3; rep++) {
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.3, startTime);
        const noteDuration = idx === 2 ? 0.16 : 0.08;
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + noteDuration);

        startTime += noteDuration + 0.02;
      });
      startTime += 0.22;
    }
  };

  // 타이머 틱 (휴식 시에만 카운트다운)
  useEffect(() => {
    let interval = null;
    const currentStep = steps[stepIndex];
    
    if (isRunning && currentStep?.type === 'rest') {
      interval = setInterval(() => {
        setTime((prevTime) => prevTime - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning, stepIndex]);

  // 휴식 종료 시 소리 재생 및 다음 단계로
  useEffect(() => {
    const currentStep = steps[stepIndex];
    if (currentStep?.type === 'rest' && time <= 0 && isRunning) {
      playTtododongX3();
      handleNextStep();
    }
  }, [time, isRunning, stepIndex]);

  // [1]번 메인 버튼 액션
  const handleNextStep = async () => {
    if (stepIndex === -1) {
      initAudio();
      await requestWakeLock();
    }
    
    if (stepIndex >= steps.length - 1) {
      setStepIndex(steps.length);
      setIsRunning(false);
      releaseWakeLock();
      return;
    }

    const nextIdx = stepIndex + 1;
    setStepIndex(nextIdx);
    
    if (steps[nextIdx].type === 'rest') {
      setTime(REST_TIME);
      setIsRunning(true);
    } else {
      setTime(0);
      setIsRunning(false);
    }
  };

  // [2]번 뒤로가기
  const handlePrevStep = () => {
    if (stepIndex <= 0) {
      setStepIndex(-1);
      setTime(0);
      setIsRunning(false);
      releaseWakeLock();
      return;
    }

    const prevIdx = stepIndex - 1;
    setStepIndex(prevIdx);
    
    if (steps[prevIdx].type === 'rest') {
      setTime(REST_TIME);
      setIsRunning(true);
    } else {
      setTime(0);
      setIsRunning(false);
    }
  };

  // [3]번 일시정지/재생
  const toggleTimer = () => {
    const currentStep = steps[stepIndex];
    if (currentStep?.type === 'rest') {
      setIsRunning(!isRunning);
    }
  };

  // 리셋
  const resetWorkout = () => {
    setStepIndex(-1);
    setTime(0);
    setIsRunning(false);
    releaseWakeLock();
  };

  const formatTime = (seconds) => {
    const m = Math.floor(Math.abs(seconds) / 60).toString().padStart(2, '0');
    const s = (Math.abs(seconds) % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const currentStep = steps[stepIndex];
  const isFinished = stepIndex >= steps.length;
  const isIdle = stepIndex === -1;

  let bgTheme = "bg-slate-900 border-slate-800";
  if (currentStep?.type === 'workout') bgTheme = "bg-slate-900 border-indigo-500/30";
  if (currentStep?.type === 'rest') bgTheme = "bg-emerald-950 border-emerald-500/40";
  if (isFinished) bgTheme = "bg-blue-950 border-blue-500/40";

  return (
    <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-2 sm:p-4 font-sans select-none">
      
      {/* 1:1 Aspect Ratio Compact Square Container */}
      <div className={`w-full max-w-[440px] aspect-square ${bgTheme} border-2 rounded-2xl sm:rounded-3xl flex flex-col justify-between shadow-2xl p-3 sm:p-5 relative transition-colors duration-500 overflow-hidden`}>
        
        {/* Header */}
        <div className="flex items-center justify-between text-xs text-gray-400 border-b border-white/10 pb-1.5 shrink-0">
          <div className="flex items-center gap-1 font-bold text-gray-200">
            <Dumbbell className="w-3.5 h-3.5 text-indigo-400" />
            <span>주 3회 루틴</span>
          </div>

          <div className="flex items-center gap-1.5">
            {wakeLockActive && (
              <span className="flex items-center gap-1 text-emerald-400 text-[10px] sm:text-xs bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <Sun className="w-3 h-3 animate-spin" /> 화면 켜짐
              </span>
            )}
            {!isIdle && !isFinished && (
              <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-bold ${
                currentStep.type === 'workout' 
                  ? 'bg-indigo-500/20 text-indigo-300' 
                  : 'bg-emerald-500/20 text-emerald-300'
              }`}>
                {currentStep.exerciseIndex} / {routine.length}
              </span>
            )}
          </div>
        </div>

        {/* Center Content Section */}
        <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-1 overflow-hidden">
          
          {/* 1. 시작 전 (Idle) */}
          {isIdle && (
            <div className="animate-fade-in flex flex-col items-center justify-center">
              <h2 className="text-xl sm:text-2xl font-black text-white mb-1">운동 시작하기</h2>
              <p className="text-gray-400 text-xs mb-3">
                6개 운동 (해머컬&이두컬 통합)<br/>
                <span className="text-emerald-400 font-medium">휴식 2분 · 화면 꺼짐 방지</span>
              </p>
              <div 
                onClick={handleNextStep}
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-indigo-600/20 hover:bg-indigo-600/30 border-4 border-indigo-500 flex items-center justify-center cursor-pointer transition-transform active:scale-95 shadow-[0_0_25px_rgba(99,102,241,0.3)]"
              >
                <Play className="w-10 h-10 text-indigo-400 ml-1" />
              </div>
            </div>
          )}

          {/* 공통 세트 표시부 (운동 중 & 휴식 중 모두 유지) */}
          {!isIdle && !isFinished && (
            <div className="flex flex-col items-center mb-2 shrink-0">
              {/* 세트 도트 게이지 */}
              <div className="flex items-center gap-1.5 mb-1">
                {Array.from({ length: currentStep.totalSets }).map((_, idx) => {
                  const setNum = idx + 1;
                  const isCurrent = setNum === currentStep.set;
                  const isDone = setNum < currentStep.set;
                  return (
                    <div
                      key={idx}
                      className={`h-2 rounded-full transition-all duration-300 ${
                        isCurrent
                          ? currentStep.type === 'workout'
                            ? 'w-7 bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.8)]'
                            : 'w-7 bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]'
                          : isDone
                          ? 'w-2 bg-indigo-600/60'
                          : 'w-2 bg-gray-700'
                      }`}
                    />
                  );
                })}
              </div>

              {/* 세트수 강조 Badge */}
              <span className={`text-xs sm:text-sm font-black tracking-widest uppercase px-3.5 py-0.5 rounded-full border shadow-md ${
                currentStep.type === 'workout'
                  ? 'text-indigo-200 bg-indigo-900/60 border-indigo-400/40'
                  : 'text-emerald-200 bg-emerald-900/60 border-emerald-400/40'
              }`}>
                {currentStep.set} / {currentStep.totalSets} 세트 {currentStep.type === 'rest' && '(완료)'}
              </span>
            </div>
          )}

          {/* 2. 운동 진행 중 카드 */}
          {!isIdle && !isFinished && currentStep?.type === 'workout' && (
            <div className="animate-fade-in w-full flex flex-col items-center justify-center px-2 my-auto">
              <div className="w-full bg-slate-800/80 border border-indigo-500/40 rounded-2xl p-4 sm:p-5 shadow-lg backdrop-blur-sm flex flex-col items-center justify-center">
                <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider mb-1">
                  진행 중인 운동
                </span>
                <a 
                  href={`https://www.youtube.com/results?search_query=${currentStep.query}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-2xl sm:text-3xl font-black text-blue-300 hover:text-blue-100 underline decoration-blue-400/60 underline-offset-4 transition-all text-center leading-tight line-clamp-2"
                >
                  {currentStep.name} 🔗
                </a>
              </div>
            </div>
          )}

          {/* 3. 휴식 중 서클 타이머 */}
          {!isIdle && !isFinished && currentStep?.type === 'rest' && (
            <div className="animate-fade-in w-full flex flex-col items-center justify-center my-auto">
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-emerald-900/40 border-4 border-emerald-500 flex flex-col items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)] relative">
                <span className="text-[10px] sm:text-xs text-emerald-300 font-bold tracking-wider mb-0.5">휴식 타이머</span>
                <span className="text-3xl sm:text-4xl font-black tracking-tighter text-white">
                  {formatTime(time)}
                </span>
                {!isRunning && (
                  <span className="absolute bottom-2 text-red-400 text-[9px] font-bold animate-pulse">일시정지</span>
                )}
              </div>
            </div>
          )}

          {/* 4. 운동 완료 */}
          {isFinished && (
            <div className="animate-fade-in flex flex-col items-center justify-center">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-blue-600/20 border-4 border-blue-400 flex items-center justify-center shadow-[0_0_25px_rgba(59,130,246,0.4)] mb-2">
                <Check className="w-12 h-12 text-blue-300" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-blue-200">오늘 운동 완료!</h2>
              <p className="text-xs text-blue-300/80 mt-0.5">수고하셨습니다 👏</p>
            </div>
          )}

        </div>

        {/* Bottom Control Buttons */}
        <div className="pt-1.5 border-t border-white/10 flex flex-col gap-1.5 shrink-0">
          
          {/* [1]번 주요 버튼 */}
          <button
            onClick={isFinished ? resetWorkout : handleNextStep}
            className={`w-full py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] shadow-md
              ${isIdle 
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white' 
                : isFinished 
                  ? 'bg-gray-800 hover:bg-gray-700 text-gray-200'
                  : currentStep?.type === 'workout'
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
          >
            {isIdle && <><PlayCircle className="w-4 h-4"/> [1] 운동 시작하기</>}
            {isFinished && <><RotateCcw className="w-4 h-4"/> [1] 루틴 처음으로</>}
            {!isIdle && !isFinished && currentStep?.type === 'workout' && <><Check className="w-4 h-4"/> [1] 세트 완료 (휴식 시작)</>}
            {!isIdle && !isFinished && currentStep?.type === 'rest' && <><SkipForward className="w-4 h-4"/> [1] 휴식 건너뛰기</>}
          </button>

          {/* [2]번, [3]번 서브 버튼 */}
          <div className="flex gap-1.5">
            <button
              onClick={handlePrevStep}
              disabled={isIdle || stepIndex <= 0}
              className="flex-1 py-2 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 flex items-center justify-center gap-1 text-[11px] sm:text-xs font-bold text-gray-300 transition-all active:scale-[0.98]"
            >
              <SkipBack className="w-3.5 h-3.5"/> [2] 뒤로
            </button>
            
            <button
              onClick={toggleTimer}
              disabled={isIdle || isFinished || currentStep?.type !== 'rest'}
              className={`flex-1 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-[0.98] disabled:opacity-30
                ${isRunning ? 'bg-amber-900/70 text-amber-200 hover:bg-amber-800' : 'bg-slate-700 text-white hover:bg-slate-600'}
              `}
            >
              {isRunning && currentStep?.type === 'rest' ? (
                <><Pause className="w-3.5 h-3.5"/> [3] 일시정지</>
              ) : (
                <><Play className="w-3.5 h-3.5"/> [3] 재생</>
              )}
            </button>
          </div>

        </div>

      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .animate-fade-in { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
      `}} />
    </div>
  );
}