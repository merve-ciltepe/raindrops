import React, { useEffect, useRef, useState, CSSProperties } from "react";

const API_URL = "http://localhost:4000/api/problem";
const LEADERBOARD_API = "http://localhost:4000/api/leaderboard";
const SCORES_API = "http://localhost:4000/api/scores";
const START_LIVES = 3;

type DropType = 'normal' | 'ice' | 'storm' | 'bonus' | 'boss';

type LeaderboardEntry = {
  id: number | string;
  nickname: string;
  score: number;
  level: number;
  streak: number;
  mode: string;
  date: string;
};

type Problem = {
  id: number;
  question: string;
  answer: number;
  isBonus?: boolean;
};

type ActiveDrop = {
  problem: Problem;
  createdAt: number;
  startX: number;
  dropType: DropType;
  durationMs: number;
};

type Particle = {
  id: number;
  x: number;
  y: number;
  color: string;
  createdAt: number;
  angle: number;
  index: number;
};

type Feedback = "correct" | "wrong" | null;

type GameStats = {
  totalGames: number;
  bestScore: number;
  bestStreak: number;
  bestLevel: number;
  totalCorrect: number;
};

let audioCtx: AudioContext | null = null;
let soundEnabled = true;

// ─── Arka Plan Müziği ────────────────────────────────────────────
let bgRainSource: AudioBufferSourceNode | null = null;
let bgRainGain: GainNode | null = null;
let bgDroneOsc: OscillatorNode | null = null;
let bgDroneGain: GainNode | null = null;
let bgMelodyInterval: ReturnType<typeof setInterval> | null = null;
const MELODY = [220, 247, 262, 294, 330, 294, 262, 247]; // Am pentatonik

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function startBgMusic(level: number = 1) {
  if (!soundEnabled) return;
  const ctx = ensureAudioCtx();

  // Yağmur sesi: filtrelenmiş white noise
  if (!bgRainSource) {
    const bufLen = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    bgRainSource = ctx.createBufferSource();
    bgRainSource.buffer = buf;
    bgRainSource.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = Math.min(300 + level * 60, 800);

    bgRainGain = ctx.createGain();
    bgRainGain.gain.value = 0;

    bgRainSource.connect(filter);
    filter.connect(bgRainGain);
    bgRainGain.connect(ctx.destination);
    bgRainSource.start();

    // Fade in
    bgRainGain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 2);
  }

  // Bas drone
  if (!bgDroneOsc) {
    bgDroneOsc = ctx.createOscillator();
    bgDroneOsc.type = "sine";
    bgDroneOsc.frequency.value = 55;
    bgDroneGain = ctx.createGain();
    bgDroneGain.gain.value = 0.04;
    bgDroneOsc.connect(bgDroneGain);
    bgDroneGain.connect(ctx.destination);
    bgDroneOsc.start();
  }

  // Melodi döngüsü
  if (!bgMelodyInterval) {
    let step = 0;
    bgMelodyInterval = setInterval(() => {
      if (!soundEnabled || !audioCtx) return;
      const ctx2 = audioCtx;
      const osc = ctx2.createOscillator();
      const g = ctx2.createGain();
      osc.type = "triangle";
      osc.frequency.value = MELODY[step % MELODY.length] * (level > 3 ? 2 : 1);
      g.gain.setValueAtTime(0.06, ctx2.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + 0.4);
      osc.connect(g);
      g.connect(ctx2.destination);
      osc.start();
      osc.stop(ctx2.currentTime + 0.4);
      step++;
    }, 500);
  }
}

function stopBgMusic() {
  if (bgRainGain && audioCtx) {
    bgRainGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1);
    setTimeout(() => {
      bgRainSource?.stop();
      bgRainSource = null;
      bgRainGain = null;
    }, 1100);
  }
  bgDroneOsc?.stop();
  bgDroneOsc = null;
  bgDroneGain = null;
  if (bgMelodyInterval) { clearInterval(bgMelodyInterval); bgMelodyInterval = null; }
}

function updateBgMusicLevel(level: number) {
  if (!bgRainGain || !audioCtx) return;
  // Seviye arttıkça yağmur biraz daha gürleşir
  bgRainGain.gain.linearRampToValueAtTime(Math.min(0.12 + level * 0.015, 0.25), audioCtx.currentTime + 2);
}
// ─────────────────────────────────────────────────────────────────

function playSound(type: "correct" | "wrong" | "gameover" | "tick", streak: number = 0) {
  if (!soundEnabled) return;
  const ctx = ensureAudioCtx();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === "correct") {
    osc.type = "sine";
    const baseFreq = 600 + (Math.min(streak, 15) * 50);
    const peakFreq = 1200 + (Math.min(streak, 15) * 100);
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(peakFreq, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } else if (type === "wrong") {
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } else if (type === "gameover") {
    osc.type = "square";
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } else if (type === "tick") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }
}

export default function App() {
  const [nickname, setNickname] = useState<string>("");
  const [hasStarted, setHasStarted] = useState<boolean>(false);
  
  const [drops, setDrops] = useState<ActiveDrop[]>([]);
  const [input, setInput] = useState("");
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(START_LIVES);
  const [gameOver, setGameOver] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isHit, setIsHit] = useState(false);
  
  const [stats, setStats] = useState<GameStats>({ totalGames: 0, bestScore: 0, bestStreak: 0, bestLevel: 0, totalCorrect: 0 });
  const [achievements, setAchievements] = useState<string[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [levelUpText, setLevelUpText] = useState<string>("");
  const [timePressureText, setTimePressureText] = useState<string>("");
  const [achievementToast, setAchievementToast] = useState<string>("");
  const [lightningBolts, setLightningBolts] = useState<{ id: number; x: number; path: string }[]>([]);
  const [lightningFlash, setLightningFlash] = useState(false);
  const [gameMode, setGameMode] = useState<'typing' | 'multiple-choice'>('typing');
  const [mcOptions, setMcOptions] = useState<number[]>([]);
  const [isSoundOn, setIsSoundOn] = useState<boolean>(() => {
    const saved = localStorage.getItem("raindrops_sound");
    return saved !== "off"; // varsayılan: açık
  });
  const [showExitModal, setShowExitModal] = useState<boolean>(false);
  const [motivationalText, setMotivationalText] = useState<string>("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState<boolean>(false);
  const [latestRank, setLatestRank] = useState<number | null>(null);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const pressureTimeoutRef = useRef<number | null>(null);
  const achievementTimeoutRef = useRef<number | null>(null);
  const motivTimeoutRef = useRef<number | null>(null);
  const tickIntervalRef = useRef<number | null>(null);
  const lastBossLevelRef = useRef<number>(0);
  const prevDropCountRef = useRef<number>(0);
  
  const spawnRateMs = Math.max(1500, 4000 - (level * 200));
  const dropDurationMs = Math.max(3000, 7500 - (level * 300));

  const spawnRateMsRef = useRef(spawnRateMs);
  const dropDurationMsRef = useRef(dropDurationMs);
  const levelRef = useRef(level);

  useEffect(() => {
    spawnRateMsRef.current = spawnRateMs;
    dropDurationMsRef.current = dropDurationMs;
    levelRef.current = level;
  }, [spawnRateMs, dropDurationMs, level]);

  const lastSpawnTimeRef = useRef<number>(0);
  const processedDropsRef = useRef<Set<number>>(new Set());
  const handleMissRef = useRef<() => void>(() => {});

  useEffect(() => {
    const savedNick = localStorage.getItem("raindrops_nickname");
    if (savedNick) setNickname(savedNick); // pre-doldur ama ekranı atlatma
    const savedMode = localStorage.getItem("raindrops_gamemode");
    if (savedMode === 'typing' || savedMode === 'multiple-choice') setGameMode(savedMode);
    const savedStats = localStorage.getItem("raindrops_stats");
    if (savedStats) setStats(JSON.parse(savedStats));
    const savedAchievs = localStorage.getItem("raindrops_achievements");
    if (savedAchievs) setAchievements(JSON.parse(savedAchievs));
  }, []);

  const fetchLeaderboard = async () => {
    setLoadingLeaderboard(true);
    try {
      const res = await fetch(LEADERBOARD_API);
      const data = await res.json();
      if (data.leaderboard) setLeaderboard(data.leaderboard);
    } catch (err) {
      console.error("Liderlik tablosu çekilemedi:", err);
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  const submitScoreToServer = async (finalScore: number, finalLevel: number, finalStreak: number) => {
    try {
      const res = await fetch(SCORES_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname || "Anonim",
          score: finalScore,
          level: finalLevel,
          streak: finalStreak,
          mode: gameMode,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLatestRank(data.rank);
        if (data.leaderboard) setLeaderboard(data.leaderboard);
      }
    } catch (err) {
      console.error("Skor sunucuya kaydedilemedi:", err);
    }
  };

  const saveStats = (newStats: GameStats) => {
    setStats(newStats);
    localStorage.setItem("raindrops_stats", JSON.stringify(newStats));
  };

  const unlockAchievement = (achiev: string) => {
    if (achievements.includes(achiev)) return;
    const newAchievs = [...achievements, achiev];
    setAchievements(newAchievs);
    localStorage.setItem("raindrops_achievements", JSON.stringify(newAchievs));
    
    setAchievementToast(achiev);
    if (achievementTimeoutRef.current) window.clearTimeout(achievementTimeoutRef.current);
    achievementTimeoutRef.current = window.setTimeout(() => setAchievementToast(""), 3000);
  };

  useEffect(() => {
    if (streak >= 10) unlockAchievement('🔥 Kombo Ustası');
    if (level >= 5) unlockAchievement('⚡ Fırtına Avcısı');
    if (score >= 50) unlockAchievement('🏆 Efsane');
  }, [streak, level, score]);

  useEffect(() => {
    if (streak >= 3 && !gameOver && hasStarted) {
      if (!tickIntervalRef.current) {
        tickIntervalRef.current = window.setInterval(() => {
          playSound("tick");
        }, Math.max(200, 1500 / streak * 0.15));
      } else {
        window.clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = window.setInterval(() => {
          playSound("tick");
        }, Math.max(200, 1500 / streak * 0.15));
      }
    } else {
      if (tickIntervalRef.current) {
        window.clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    }
    return () => {
      if (tickIntervalRef.current) window.clearInterval(tickIntervalRef.current);
    };
  }, [streak, gameOver, hasStarted]);

  // Global soundEnabled flag ile React state senkronize et
  useEffect(() => {
    soundEnabled = isSoundOn;
    localStorage.setItem("raindrops_sound", isSoundOn ? "on" : "off");
    if (!isSoundOn) stopBgMusic();
    else if (hasStarted && !gameOver) startBgMusic(level);
  }, [isSoundOn]);

  // Oyun başlayınca müzik başlat, bitince durdur
  useEffect(() => {
    if (hasStarted && !gameOver) {
      startBgMusic(level);
    } else {
      stopBgMusic();
    }
    return () => { /* cleanup restart'ta stopBgMusic ile yapılıyor */ };
  }, [hasStarted, gameOver]);

  // Seviye değişince yağmur yoğunluğunu güncelle
  useEffect(() => {
    if (hasStarted && !gameOver) updateBgMusicLevel(level);
  }, [level]);

  const fetchProblem = async (lvl: number): Promise<Problem> => {
    try {
      const res = await fetch(`${API_URL}?level=${lvl}`);
      return await res.json();
    } catch (err) {
      const a = Math.floor(Math.random() * (10 + lvl * 2)) + 1;
      const b = Math.floor(Math.random() * (10 + lvl * 2)) + 1;
      return { id: Math.random(), question: `${a} + ${b}`, answer: a + b };
    }
  };

  const spawnDrop = async (now: number) => {
    const prob = await fetchProblem(levelRef.current);
    let type: DropType = 'normal';
    let duration = dropDurationMsRef.current;
    
    if (prob.isBonus) {
      type = 'bonus';
    } else {
      const r = Math.random();
      if (r < 0.15) {
        type = 'ice';
        duration *= 1.5;
      } else if (r < 0.30) {
        type = 'storm';
        duration *= 0.7;
      }
    }
    
    setDrops(prev => [...prev, {
      problem: prob,
      createdAt: now,
      startX: 10 + Math.random() * 80,
      dropType: type,
      durationMs: duration
    }]);
  };

  const spawnBoss = async () => {
    const lvl = levelRef.current;
    const a = Math.floor(Math.random() * (15 + lvl * 3)) + 5;
    const b = Math.floor(Math.random() * (15 + lvl * 3)) + 5;
    const prob = { id: Math.random(), question: `${a} + ${b}`, answer: a + b, isBonus: false };
    setDrops(prev => [...prev, {
      problem: prob,
      createdAt: performance.now(),
      startX: 30 + Math.random() * 40,
      dropType: 'boss',
      durationMs: dropDurationMsRef.current * 2
    }]);
  };

  useEffect(() => {
    if (!hasStarted) return;
    if (gameOver) return;
    if (rafRef.current !== null) return;

    lastSpawnTimeRef.current = 0;

    function gameLoop(now: number) {
      const currentSpawnRate = spawnRateMsRef.current;

      if (!lastSpawnTimeRef.current) {
        lastSpawnTimeRef.current = now;
        spawnDrop(now);
      }

      if (now - lastSpawnTimeRef.current > currentSpawnRate) {
        lastSpawnTimeRef.current = now;
        spawnDrop(now);
      }

      setDrops(prev => {
        const active = prev.filter(drop => {
          const elapsed = now - drop.createdAt;
          const progress = (elapsed / drop.durationMs) * 100;
          if (progress >= 100) {
            if (drop.dropType !== 'bonus' && !processedDropsRef.current.has(drop.problem.id)) {
              processedDropsRef.current.add(drop.problem.id);
              setTimeout(() => handleMissRef.current(), 0);
            }
            return false;
          }
          return true;
        });
        return active;
      });

      rafRef.current = requestAnimationFrame(gameLoop);
    }

    rafRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [gameOver, hasStarted]);

  useEffect(() => {
    const newLevel = Math.floor(score / 5) + 1;
    if (newLevel > level) {
      setLevel(newLevel);
      setLevelUpText(`SEVİYE ${newLevel}!`);
      setTimeout(() => setLevelUpText(""), 2000);
      
      if (newLevel % 3 === 0 && lastBossLevelRef.current !== newLevel) {
        lastBossLevelRef.current = newLevel;
        spawnBoss();
      }
    }
  }, [score, level]);

  const handleMiss = () => {
    playSound("wrong");
    setIsHit(true);
    setTimeout(() => setIsHit(false), 400);
    setLives(prev => {
      const next = prev - 1;
      if (next <= 0) {
        setTimeout(() => {
          playSound("gameover");
          setGameOver(true);
          const totalGames = stats.totalGames + 1;
          const bestScore = Math.max(stats.bestScore, score);
          const bestStreak = Math.max(stats.bestStreak, streak);
          const bestLevel = Math.max(stats.bestLevel, levelRef.current);
          saveStats({ ...stats, totalGames, bestScore, bestStreak, bestLevel });
          submitScoreToServer(score, levelRef.current, streak);
        }, 0);
      }
      return next;
    });
    setStreak(0);
  };
  handleMissRef.current = handleMiss;

  const showFeedback = (kind: Feedback) => {
    setFeedback(kind);
    if (feedbackTimeoutRef.current) window.clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = window.setTimeout(() => setFeedback(null), 450);
  };

  const triggerMotivation = (currentStreak: number) => {
    let slogan = "";
    if (currentStreak === 2) slogan = "GOOD! 👍";
    else if (currentStreak === 3) slogan = "GREAT! ✨";
    else if (currentStreak === 4) slogan = "EXCELLENT! 🌟";
    else if (currentStreak === 5) slogan = "AMAZING! 🔥";
    else if (currentStreak === 6) slogan = "SUPERB! 💫";
    else if (currentStreak === 7) slogan = "FANTASTIC! ⚡";
    else if (currentStreak === 8) slogan = "INCREDIBLE! 🎯";
    else if (currentStreak === 9) slogan = "OUTSTANDING! 🏆";
    else if (currentStreak >= 10 && currentStreak < 15) slogan = "UNSTOPPABLE! 💥";
    else if (currentStreak >= 15 && currentStreak < 20) slogan = "GODLIKE! 👑";
    else if (currentStreak >= 20) slogan = "LEGENDARY! 🚀";

    if (slogan) {
      setMotivationalText(slogan);
      if (motivTimeoutRef.current) window.clearTimeout(motivTimeoutRef.current);
      motivTimeoutRef.current = window.setTimeout(() => setMotivationalText(""), 1200);
    }
  };

  const spawnParticles = (x: number, color: string) => {
    const now = Date.now();
    const newParticles: Particle[] = [];
    for (let i = 0; i < 8; i++) {
      newParticles.push({
        id: Math.random(),
        x,
        y: 85,
        color,
        createdAt: now,
        angle: (i * 45) * (Math.PI / 180),
        index: i,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  useEffect(() => {
    if (particles.length > 0) {
      const timeout = setTimeout(() => {
        const now = Date.now();
        setParticles(prev => prev.filter(p => now - p.createdAt < 700));
      }, 700);
      return () => clearTimeout(timeout);
    }
  }, [particles]);

  // Şimşek efekti — seviyeye göre sıklaşır
  useEffect(() => {
    if (gameOver || !hasStarted || level < 3) return;

    // Level 3-4: 8-14s, Level 5-7: 4-8s, Level 8+: 1.5-4s
    const minMs = level >= 8 ? 1500 : level >= 5 ? 4000 : 8000;
    const maxMs = level >= 8 ? 4000 : level >= 5 ? 8000 : 14000;

    const scheduleNext = () => Math.random() * (maxMs - minMs) + minMs;

    let timeoutId: number;

    const triggerLightning = () => {
      // Rastgele kırık çizgi SVG path üret
      const x = 10 + Math.random() * 80; // Yüzde olarak yatay konum
      const segments = 6 + Math.floor(Math.random() * 5);
      let path = `M 50 0`;
      let cy = 0;
      for (let i = 1; i <= segments; i++) {
        const nx = 30 + Math.random() * 40;
        cy = (i / segments) * 100;
        path += ` L ${nx} ${cy}`;
      }

      const bolt = { id: Date.now(), x, path };
      setLightningBolts(prev => [...prev, bolt]);
      setLightningFlash(true);
      setTimeout(() => setLightningFlash(false), 80);
      setTimeout(() => setLightningBolts(prev => prev.filter(b => b.id !== bolt.id)), 300);

      timeoutId = window.setTimeout(triggerLightning, scheduleNext());
    };

    timeoutId = window.setTimeout(triggerLightning, scheduleNext());
    return () => window.clearTimeout(timeoutId);
  }, [level, gameOver, hasStarted]);

  // Çoktan seçmeli mod — seçenekleri üret (yalnızca drop EKLENINCE güncelle, çıkınca değil)
  useEffect(() => {
    if (gameMode !== 'multiple-choice' || gameOver) return;

    // Sadece drop sayısı arttığında güncelle (flickering önlemi)
    if (drops.length > 0 && drops.length > prevDropCountRef.current) {
      const answers = [...new Set(drops.map(d => d.problem.answer))];
      const options = new Set<number>(answers);
      let attempts = 0;
      while (options.size < 4 && attempts < 100) {
        attempts++;
        const base = answers[Math.floor(Math.random() * answers.length)];
        const offset = Math.floor(Math.random() * 18) - 8;
        const decoy = base + offset;
        if (decoy > 0 && !options.has(decoy)) options.add(decoy);
      }
      // Karıştır
      const arr = [...options].slice(0, 4);
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      setMcOptions(arr);
    }
    prevDropCountRef.current = drops.length;
  }, [drops.length, gameMode, gameOver]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (gameOver || !hasStarted) return;

    const parsed = Number(input.trim());
    if (Number.isNaN(parsed)) return;

    const now = performance.now();
    let matchingIndices: number[] = [];
    let hasTimePressureBonus = false;

    drops.forEach((drop, idx) => {
      if (drop.problem.answer === parsed) {
        matchingIndices.push(idx);
        const progress = (now - drop.createdAt) / drop.durationMs;
        if (progress > 0.75) {
          hasTimePressureBonus = true;
        }
      }
    });

    if (matchingIndices.length > 0) {
      const newStreak = streak + matchingIndices.length;
      playSound("correct", newStreak);
      showFeedback("correct");
      
      let newPoints = 0;
      let newCorrect = stats.totalCorrect;
      
      matchingIndices.forEach(idx => {
        const targetDrop = drops[idx];
        let basePts = 1;
        if (targetDrop.dropType === 'ice') basePts = 2;
        if (targetDrop.dropType === 'storm') basePts = 3;
        if (targetDrop.dropType === 'boss') basePts = 5;
        
        let pts = basePts + Math.floor(newStreak / 3);
        if (hasTimePressureBonus) pts *= 2;
        newPoints += pts;
        newCorrect++;

        if (targetDrop.dropType === 'bonus' || targetDrop.dropType === 'boss') {
          setLives(l => l + 1);
        }

        if (targetDrop.dropType === 'bonus') unlockAchievement('💎 Bonus Avcısı');
        if (targetDrop.dropType === 'ice') unlockAchievement('❄️ Buz Avcısı');
        if (targetDrop.dropType === 'boss') unlockAchievement('👑 Boss Katili');

        let pColor = '#fff';
        if (targetDrop.dropType === 'ice') pColor = '#00E5FF';
        if (targetDrop.dropType === 'storm') pColor = '#FFEB3B';
        if (targetDrop.dropType === 'bonus') pColor = '#FF3D00';
        if (targetDrop.dropType === 'boss') pColor = '#D500F9';
        spawnParticles(targetDrop.startX, pColor);
      });

      setStreak(newStreak);
      triggerMotivation(newStreak);
      setScore(s => s + newPoints);
      setStats(prev => ({ ...prev, totalCorrect: newCorrect }));

      if (hasTimePressureBonus) {
        setTimePressureText("⚡ Baskı Bonusu!");
        if (pressureTimeoutRef.current) window.clearTimeout(pressureTimeoutRef.current);
        pressureTimeoutRef.current = window.setTimeout(() => setTimePressureText(""), 1000);
      }
      
      setDrops(prev => prev.filter((_, i) => !matchingIndices.includes(i)));
      setInput("");
    } else {
      playSound("wrong");
      showFeedback("wrong");
      setStreak(0);
      setInput("");
    }
  };

  const handleRestart = () => {
    setScore(0);
    setStreak(0);
    setLevel(1);
    setLives(START_LIVES);
    setGameOver(false);
    setDrops([]);
    setFeedback(null);
    setIsHit(false);
    setMcOptions([]);
    setShowExitModal(false);
    setShowLeaderboard(false);
    setLatestRank(null);
    setMotivationalText("");
    setHasStarted(false); // Başlangıç ekranını tekrar göster
    lastBossLevelRef.current = 0;
    lastSpawnTimeRef.current = 0;
    prevDropCountRef.current = 0;
    processedDropsRef.current.clear();
  };

  const currentMultiplier = 1 + Math.floor(streak / 3);

  const getBackgroundStyle = () => {
    if (level >= 5) return "linear-gradient(135deg, #0d0005 0%, #1a0010 50%, #0d0020 100%)";
    if (level >= 3) return "linear-gradient(135deg, #0a0f14 0%, #111a22 50%, #1a2c3d 100%)";
    return "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)";
  };

  const renderLeaderboardModal = () => {
    if (!showLeaderboard) return null;
    return (
      <div style={styles.modalBackdrop}>
        <div style={{ ...styles.modalCard, maxWidth: 500, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#FFD700", display: "flex", alignItems: "center", gap: 8 }}>
              🏆 Liderlik Tablosu (Top 10)
            </h3>
            <button
              onClick={() => setShowLeaderboard(false)}
              style={{ background: "transparent", border: "none", color: "#8FA3B8", fontSize: 22, cursor: "pointer", padding: 4 }}
            >
              ✕
            </button>
          </div>

          <div style={{ overflowY: "auto", flex: 1, paddingRight: 4, display: "flex", flexDirection: "column", gap: 8 }}>
            {loadingLeaderboard ? (
              <div style={{ padding: "30px 0", color: "#8FA3B8" }}>Skorlar yükleniyor...</div>
            ) : leaderboard.length === 0 ? (
              <div style={{ padding: "30px 0", color: "#8FA3B8" }}>Henüz kayıtlı skor bulunamadı.</div>
            ) : (
              leaderboard.map((entry, idx) => {
                const rankBadge = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
                const isTop3 = idx < 3;
                return (
                  <div
                    key={entry.id || idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: 12,
                      background: isTop3 ? "rgba(255, 215, 0, 0.08)" : "rgba(255, 255, 255, 0.04)",
                      border: isTop3 ? "1px solid rgba(255, 215, 0, 0.3)" : "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
                      <span style={{ fontSize: 18, fontWeight: 800, minWidth: 26, color: idx === 0 ? "#FFD700" : idx === 1 ? "#E0E0E0" : idx === 2 ? "#CD7F32" : "#8FA3B8" }}>
                        {rankBadge}
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>
                          {entry.nickname}
                        </div>
                        <div style={{ fontSize: 11, color: "#8FA3B8" }}>
                          Seviye {entry.level} • {entry.mode === "multiple-choice" ? "👆 Seçmeli" : "⌨️ Yazma"} • {entry.date}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#00E5FF" }}>
                      {entry.score} <span style={{ fontSize: 11, fontWeight: 400, color: "#8FA3B8" }}>Puan</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <button
            style={{ ...styles.modalCancelBtn, marginTop: 16 }}
            onClick={() => setShowLeaderboard(false)}
          >
            Kapat
          </button>
        </div>
      </div>
    );
  };

  if (!hasStarted) {
    return (
      <div style={{ ...styles.page, background: getBackgroundStyle(), justifyContent: 'center', alignItems: 'center' }}>
        <div style={styles.startCard}>
          <h1 style={styles.startTitle}>Raindrops 🌧️</h1>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (nickname.trim()) {
              localStorage.setItem("raindrops_nickname", nickname.trim());
              localStorage.setItem("raindrops_gamemode", gameMode);
              setHasStarted(true);
            }
          }}>
            <input
              style={styles.nickInput}
              placeholder="Takma adını yaz..."
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              autoFocus
            />

            {/* Mod Seçimi */}
            <div style={{ marginTop: 20, marginBottom: 8 }}>
              <p style={{ color: '#8FA3B8', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
                Oyun Modu
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setGameMode('typing')}
                  style={{
                    flex: 1, padding: '14px 8px', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    border: `2px solid ${gameMode === 'typing' ? '#00E5FF' : 'rgba(255,255,255,0.15)'}`,
                    background: gameMode === 'typing' ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.05)',
                    color: gameMode === 'typing' ? '#00E5FF' : '#8FA3B8',
                    transition: 'all 0.2s',
                  }}
                >
                  ⌨️ Yazarak Oyna
                  <div style={{ fontSize: 11, fontWeight: 400, marginTop: 4, opacity: 0.8 }}>
                    Cevabı kendin yaz
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setGameMode('multiple-choice')}
                  style={{
                    flex: 1, padding: '14px 8px', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    border: `2px solid ${gameMode === 'multiple-choice' ? '#00E5FF' : 'rgba(255,255,255,0.15)'}`,
                    background: gameMode === 'multiple-choice' ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.05)',
                    color: gameMode === 'multiple-choice' ? '#00E5FF' : '#8FA3B8',
                    transition: 'all 0.2s',
                  }}
                >
                  👆 Seçerek Oyna
                  <div style={{ fontSize: 11, fontWeight: 400, marginTop: 4, opacity: 0.8 }}>
                    4 seçenekten tıkla
                  </div>
                </button>
              </div>
            </div>

            <button type="submit" style={styles.startButton}>Oyna! 🚀</button>

            {/* Liderlik Tablosu Butonu */}
            <button
              type="button"
              onClick={() => {
                fetchLeaderboard();
                setShowLeaderboard(true);
              }}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "12px",
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 12,
                border: "1px solid rgba(255, 215, 0, 0.4)",
                background: "rgba(255, 215, 0, 0.1)",
                color: "#FFD700",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "all 0.2s",
              }}
            >
              🏆 Liderlik Tablosu (Top 10)
            </button>
          </form>
        </div>
        {renderLeaderboardModal()}
      </div>
    );
  }

  return (
    <div style={{ ...styles.page, background: getBackgroundStyle(), ...(isHit ? styles.pageHit : {}) }}>
      <div style={styles.stormOverlay} />
      <div style={styles.cartoonClouds} />

      {/* Şimşek flash overlay */}
      {lightningFlash && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1,
          background: 'rgba(200, 220, 255, 0.12)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Şimşek SVG'leri */}
      {lightningBolts.map(bolt => (
        <svg
          key={bolt.id}
          style={{
            position: 'absolute',
            top: 0,
            left: `${bolt.x}%`,
            width: 100,
            height: '70%',
            zIndex: 1,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 0 6px #a0d0ff) drop-shadow(0 0 12px #ffffff)',
            animation: 'lightningBolt 0.25s ease-out forwards',
          }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path d={bolt.path} stroke="#d0eeff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d={bolt.path} stroke="white" strokeWidth="0.8" fill="none" strokeLinecap="round" />
        </svg>
      ))}

      <div style={styles.hud}>
        <div style={styles.hudBlock}>
          <span style={styles.hudLabel}>Skor (Level {level})</span>
          <span style={styles.hudValue}>{score} <span style={styles.highScoreText}>/ Rekor: {stats.bestScore}</span></span>
        </div>
        <div style={styles.hudCenterBlock}>
          {streak > 1 && (
            <span style={styles.streakText}>
              🔥 {streak} Combo! (x{currentMultiplier})
            </span>
          )}
          {timePressureText && <span style={styles.pressureText}>{timePressureText}</span>}
        </div>
        <div style={styles.hudBlock}>
          <span style={styles.hudLabel}>Can</span>
          <span style={styles.hudValue}>
            {"❤️".repeat(Math.max(lives, 0))}
            <span style={{ opacity: 0.25 }}>{"🤍".repeat(Math.max(START_LIVES - lives, 0))}</span>
          </span>
        </div>
        {/* Kontrol Butonları (Çıkış & Ses) */}
        <div style={{ position: 'absolute', top: 10, right: 14, zIndex: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowExitModal(true)}
            title="Oyundan Çıkış Yap"
            style={styles.hudExitButton}
          >
            🚪 Çıkış
          </button>
          <button
            onClick={() => setIsSoundOn(v => !v)}
            title={isSoundOn ? "Sesi Kapat" : "Sesi Aç"}
            style={styles.hudSoundButton}
          >
            {isSoundOn ? "🔊" : "🔇"}
          </button>
        </div>
      </div>

      <div style={styles.playfield}>
        <div style={styles.floorLine} />

        {levelUpText && (
          <div style={styles.levelUpOverlay}>
            {levelUpText}
          </div>
        )}

        {motivationalText && (
          <div style={styles.motivationalOverlay}>
            {motivationalText}
          </div>
        )}

        {!gameOver && drops.map((drop) => {
          let tStyles = { ...styles.teardrop };
          if (drop.dropType === 'bonus') tStyles = { ...tStyles, ...styles.teardropBonus };
          if (drop.dropType === 'ice') tStyles = { ...tStyles, ...styles.teardropIce };
          if (drop.dropType === 'storm') tStyles = { ...tStyles, ...styles.teardropStorm };
          if (drop.dropType === 'boss') tStyles = { ...tStyles, ...styles.teardropBoss };

          if (feedback === "correct") tStyles = { ...tStyles, ...styles.teardropCorrect };
          if (feedback === "wrong") tStyles = { ...tStyles, ...styles.teardropWrong };

          return (
            <div
              key={drop.problem.id}
              style={{
                ...styles.dropContainer,
                left: `${drop.startX}%`,
                animation: `fallDown ${drop.durationMs}ms linear forwards`,
                ...(drop.dropType === 'boss' ? { width: 130, height: 130 } : {})
              }}
            >
              {currentMultiplier > 1 && (
                <div style={styles.multiplierBadge}>x{currentMultiplier}</div>
              )}
              <div style={tStyles}>
                <div style={styles.teardropText}>
                  {drop.problem.question}
                </div>
              </div>
            </div>
          );
        })}

        {particles.map(p => {
          return (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: p.color,
                animation: `particleFly${p.index} 0.6s ease-out forwards`,
                transform: `translate(-50%, -50%)`,
              } as CSSProperties}
            />
          )
        })}

        {gameOver && (
          <div style={styles.gameOverCard}>
            <div style={styles.gameOverTitle}>Yağmur durdu</div>
            <div style={styles.gameOverNick}>{nickname}</div>
            <div style={styles.gameOverScore}>Skorun: {score} | Rekor: {stats.bestScore} | Seviye: {level}</div>
            <div style={styles.gameOverStats}>
              Toplam Oyun: {stats.totalGames} | En İyi Skor: {stats.bestScore} | En Uzun Seri: {stats.bestStreak}
            </div>
            {latestRank && (
              <div style={{ color: "#FFD700", fontWeight: 800, fontSize: 15, marginTop: 10 }}>
                ✨ Liderlik Sıralaman: #{latestRank}!
              </div>
            )}
            <div style={{display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20}}>
              <button style={styles.restartButton} onClick={handleRestart}>
                Yeniden Başla
              </button>
              <button
                style={{ ...styles.shareButton, background: "linear-gradient(45deg, #FFD700, #FFA000)", color: "#000", fontWeight: 800 }}
                onClick={() => {
                  fetchLeaderboard();
                  setShowLeaderboard(true);
                }}
              >
                🏆 Sıralama
              </button>
              <button style={styles.shareButton} onClick={() => {
                const txt = `Raindrops oyununda ${score} puan yaptım! Seviye ${level} | Seri: ${streak} 🌧️`;
                navigator.clipboard.writeText(txt);
                alert("Kopyalandı!");
              }}>
                Paylaş
              </button>
            </div>
          </div>
        )}

        {achievementToast && (
          <div style={styles.toast}>
            Başarım Kazanıldı: {achievementToast}
          </div>
        )}

        {/* Liderlik Tablosu Modalı */}
        {renderLeaderboardModal()}

        {/* Çıkış Onay Modalı */}
        {showExitModal && (
          <div style={styles.modalBackdrop}>
            <div style={styles.modalCard}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>🚪</div>
              <h3 style={styles.modalTitle}>Oyundan Çıkmak İstiyor musunuz?</h3>
              <p style={styles.modalSubtitle}>
                Mevcut oyununuz ve ilerlemeniz sonlandırılacak, ana başlangıç menüsüne döneceksiniz.
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
                <button
                  style={styles.modalCancelBtn}
                  onClick={() => setShowExitModal(false)}
                >
                  Oyuna Devam Et
                </button>
                <button
                  style={styles.modalConfirmBtn}
                  onClick={handleRestart}
                >
                  Evet, Çıkış Yap
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {gameMode === 'typing' ? (
        <form style={styles.inputRow} onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            style={styles.input}
            type="text"
            inputMode="numeric"
            placeholder="Cevabı yaz ve Enter'a bas..."
            value={input}
            disabled={gameOver}
            onChange={(e) => setInput(e.target.value)}
            onBlur={() => {
              if (!gameOver) inputRef.current?.focus();
            }}
            autoFocus
          />
          <button style={styles.submitButton} type="submit" disabled={gameOver}>
            Gönder
          </button>
        </form>
      ) : (
        /* Çoktan Seçmeli Mod */
        <div style={styles.mcRow}>
          {mcOptions.length === 0 ? (
            <div style={styles.mcWaiting}>Sorular yükleniyor...</div>
          ) : (
            mcOptions.map((opt, i) => {
              const isCorrect = drops.some(d => d.problem.answer === opt);
              return (
                <button
                  key={i}
                  disabled={gameOver}
                  onClick={() => {
                    if (gameOver) return;
                    // handleSubmit mantığını MC için çalıştır
                    const now = performance.now();
                    let targetIndex = -1;
                    let maxProgress = -1;
                    drops.forEach((drop, idx) => {
                      if (drop.problem.answer === opt) {
                        const progress = (now - drop.createdAt) / drop.durationMs;
                        if (progress > maxProgress) { maxProgress = progress; targetIndex = idx; }
                      }
                    });
                    if (targetIndex !== -1) {
                      const newStreak = streak + 1;
                      playSound("correct", newStreak);
                      showFeedback("correct");
                      const targetDrop = drops[targetIndex];
                      if (targetDrop.dropType === 'bonus' || targetDrop.problem.isBonus) { setLives(l => l + 1); unlockAchievement('💎 Bonus Avcısı'); }
                      if (targetDrop.dropType === 'boss') unlockAchievement('👑 Boss Katili');
                      if (targetDrop.dropType === 'ice') unlockAchievement('❄️ Buz Avcısı');
                      setStreak(newStreak);
                      triggerMotivation(newStreak);
                      if (newStreak >= 10) unlockAchievement('🔥 Kombo Ustası');
                      const isTimePressure = maxProgress > 0.75;
                      const basePoints = targetDrop.dropType === 'boss' ? 5 : targetDrop.dropType === 'ice' ? 2 : targetDrop.dropType === 'storm' ? 3 : 1;
                      const points = (basePoints + Math.floor(newStreak / 3)) * (isTimePressure ? 2 : 1);
                      setScore(s => s + points);
                      if (isTimePressure) { setTimePressureText('⚡ Baskı Bonusu!'); if (pressureTimeoutRef.current) window.clearTimeout(pressureTimeoutRef.current); pressureTimeoutRef.current = window.setTimeout(() => setTimePressureText(''), 1000); }
                      const pColor = targetDrop.dropType === 'ice' ? '#00d4ff' : targetDrop.dropType === 'storm' ? '#FFD600' : targetDrop.dropType === 'boss' ? '#D500F9' : '#00E676';
                      spawnParticles(targetDrop.startX, pColor);
                      setDrops(prev => prev.filter((_, i2) => i2 !== targetIndex));
                    } else {
                      playSound("wrong");
                      showFeedback("wrong");
                      setStreak(0);
                    }
                  }}
                  style={{
                    ...styles.mcButton,
                    ...(gameOver ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                  }}
                >
                  {opt}
                </button>
              );
            })
          )}
        </div>
      )}

      <style>
        {`
          @keyframes fallDown {
            from { top: -10%; opacity: 0; transform: translate(-50%, -50%) scale(1); }
            5% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            95% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            to { top: 92%; opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
          }
          @keyframes shakeEffect {
            0% { transform: translate(0, 0) rotate(0deg); }
            10% { transform: translate(-10px, -10px) rotate(-2deg); }
            20% { transform: translate(10px, 10px) rotate(2deg); }
            30% { transform: translate(-10px, 10px) rotate(-2deg); }
            40% { transform: translate(10px, -10px) rotate(2deg); }
            50% { transform: translate(-5px, -5px) rotate(-1deg); }
            60% { transform: translate(5px, 5px) rotate(1deg); }
            70% { transform: translate(-5px, 5px) rotate(-1deg); }
            80% { transform: translate(5px, -5px) rotate(1deg); }
            100% { transform: translate(0, 0) rotate(0deg); }
          }
          @keyframes pulseBoss {
            0% { box-shadow: 0 0 20px rgba(213, 0, 249, 0.4); }
            50% { box-shadow: 0 0 50px rgba(213, 0, 249, 1); }
            100% { box-shadow: 0 0 20px rgba(213, 0, 249, 0.4); }
          }
          @keyframes particleFly0 { to { transform: translate(-50px, -60px) scale(0); opacity: 0; } }
          @keyframes particleFly1 { to { transform: translate(50px, -60px) scale(0); opacity: 0; } }
          @keyframes particleFly2 { to { transform: translate(70px, 0px) scale(0); opacity: 0; } }
          @keyframes particleFly3 { to { transform: translate(50px, 60px) scale(0); opacity: 0; } }
          @keyframes particleFly4 { to { transform: translate(-50px, 60px) scale(0); opacity: 0; } }
          @keyframes particleFly5 { to { transform: translate(-70px, 0px) scale(0); opacity: 0; } }
          @keyframes particleFly6 { to { transform: translate(-30px, -80px) scale(0); opacity: 0; } }
          @keyframes particleFly7 { to { transform: translate(30px, -80px) scale(0); opacity: 0; } }
          @keyframes levelUpAnim {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
            20% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
            80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          }
          @keyframes toastSlideUp {
            0% { transform: translateY(100px); opacity: 0; }
            15% { transform: translateY(0); opacity: 1; }
            85% { transform: translateY(0); opacity: 1; }
            100% { transform: translateY(100px); opacity: 0; }
          }
          @keyframes lightningBolt {
            0% { opacity: 1; }
            60% { opacity: 0.9; }
            100% { opacity: 0; }
          }
          @keyframes popupMotiv {
            0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
            20% { transform: translate(-50%, -50%) scale(1.25); opacity: 1; }
            75% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(1.35); opacity: 0; }
          }
        `}
      </style>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    position: "relative",
    width: "100vw",
    height: "100vh",
    color: "#EAF2F8",
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    transition: "background 0.5s",
  },
  startCard: {
    background: "rgba(10, 20, 30, 0.9)",
    padding: 40,
    borderRadius: 24,
    textAlign: "center",
    boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
    border: "2px solid rgba(0, 229, 255, 0.4)",
  },
  startTitle: {
    fontSize: 48,
    marginBottom: 24,
    color: "#fff",
    textShadow: "0 0 10px rgba(0, 229, 255, 0.4)",
  },
  nickInput: {
    padding: "16px 24px",
    fontSize: 22,
    borderRadius: 12,
    border: "2px solid #00E5FF",
    background: "rgba(0,0,0,0.5)",
    color: "#fff",
    marginBottom: 20,
    outline: "none",
  },
  startButton: {
    display: "block",
    width: "100%",
    padding: "16px",
    fontSize: 20,
    fontWeight: "bold",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(45deg, #00E5FF, #00B0FF)",
    cursor: "pointer",
  },
  pageHit: {
    animation: "shakeEffect 0.4s",
  },
  stormOverlay: {
    position: "absolute",
    inset: 0,
    background: "url('data:image/svg+xml;utf8,<svg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\"><filter id=\"noiseFilter\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.85\" numOctaves=\"3\" stitchTiles=\"stitch\"/></filter><rect width=\"100%\" height=\"100%\" filter=\"url(%23noiseFilter)\" opacity=\"0.05\"/></svg>')",
    pointerEvents: "none",
  },
  cartoonClouds: {
    position: "absolute",
    top: -10,
    left: 0,
    right: 0,
    height: 140,
    zIndex: 1,
    pointerEvents: "none",
    background: "url('data:image/svg+xml;utf8,<svg viewBox=\"0 0 1440 320\" xmlns=\"http://www.w3.org/2000/svg\"><path fill=\"%23ffffff\" fill-opacity=\"1\" d=\"M0,96L48,112C96,128,192,160,288,160C384,160,480,128,576,122.7C672,117,768,139,864,144C960,149,1056,139,1152,117.3C1248,96,1344,64,1392,48L1440,32L1440,0L1392,0C1344,0,1248,0,1152,0C1056,0,960,0,864,0C768,0,672,0,576,0C480,0,384,0,288,0C192,0,96,0,48,0L0,0Z\"></path></svg>')",
    backgroundSize: "cover",
    backgroundPosition: "top",
    backgroundRepeat: "no-repeat",
    filter: "drop-shadow(0 10px 10px rgba(0,0,0,0.4))",
  },
  hud: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "24px 32px",
    zIndex: 2,
    background: "rgba(0, 0, 0, 0.4)",
    backdropFilter: "blur(5px)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
  },
  hudBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  hudCenterBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  hudLabel: {
    fontSize: 12,
    letterSpacing: 1.5,
    color: "#8FA3B8",
    textTransform: "uppercase",
    fontWeight: 600,
  },
  hudValue: {
    fontSize: 26,
    fontWeight: 700,
    fontFamily: "'Consolas', 'Menlo', monospace",
    color: "#00E5FF",
    textShadow: "0 0 10px rgba(0, 229, 255, 0.4)",
  },
  highScoreText: {
    fontSize: 14,
    color: "#8FA3B8",
    textShadow: "none",
  },
  streakText: {
    color: "#FF3D00",
    fontSize: 22,
    fontWeight: 800,
    textShadow: "0 0 15px rgba(255, 61, 0, 0.7)",
  },
  pressureText: {
    color: "#FFEB3B",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 4,
  },
  playfield: {
    position: "relative",
    flex: 1,
    margin: "0 24px",
    zIndex: 2,
  },
  floorLine: {
    position: "absolute",
    left: "-5%",
    right: "-5%",
    bottom: "8%",
    height: 4,
    background: "linear-gradient(90deg, transparent, #00E5FF, transparent)",
    opacity: 0.6,
    boxShadow: "0 0 15px #00E5FF",
  },
  dropContainer: {
    position: "absolute",
    width: 90,
    height: 90,
  },
  multiplierBadge: {
    position: "absolute",
    top: -24,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#F2B705",
    color: "#0F1B2D",
    padding: "2px 8px",
    borderRadius: 12,
    fontWeight: "bold",
    fontSize: 14,
    zIndex: 10,
    boxShadow: "0 4px 10px rgba(242, 183, 5, 0.5)",
  },
  teardrop: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "100%",
    height: "100%",
    background: "rgba(255, 255, 255, 0.15)",
    backdropFilter: "blur(10px)",
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "rgba(255, 255, 255, 0.4)",
    borderRadius: "0 50% 50% 50%",
    transform: "translate(-50%, -50%) rotate(45deg)",
    boxShadow: "0 10px 25px rgba(0,0,0,0.4), inset 0 0 15px rgba(255,255,255,0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  teardropBonus: {
    borderColor: "#FF3D00",
    background: "rgba(255, 61, 0, 0.25)",
    boxShadow: "0 10px 30px rgba(255, 61, 0, 0.8), inset 0 0 20px rgba(255, 61, 0, 0.4)",
  },
  teardropIce: {
    borderColor: "#00E5FF",
    background: "rgba(0, 229, 255, 0.2)",
    boxShadow: "0 10px 30px rgba(0, 229, 255, 0.6), inset 0 0 20px rgba(0, 229, 255, 0.3)",
  },
  teardropStorm: {
    borderColor: "#FFEB3B",
    background: "rgba(255, 235, 59, 0.25)",
    boxShadow: "0 10px 30px rgba(255, 235, 59, 0.8), inset 0 0 20px rgba(255, 235, 59, 0.4)",
  },
  teardropBoss: {
    borderColor: "#D500F9",
    background: "rgba(213, 0, 249, 0.25)",
    animation: "pulseBoss 2s infinite",
  },
  teardropCorrect: {
    borderColor: "#00E676",
    boxShadow: "0 0 30px rgba(0,230,118,0.7), inset 0 0 15px rgba(0,230,118,0.3)",
    background: "rgba(0, 230, 118, 0.2)",
  },
  teardropWrong: {
    borderColor: "#FF1744",
    boxShadow: "0 0 30px rgba(255,23,68,0.7), inset 0 0 15px rgba(255,23,68,0.3)",
    background: "rgba(255, 23, 68, 0.2)",
  },
  teardropText: {
    transform: "rotate(-45deg)",
    fontFamily: "'Consolas', 'Menlo', monospace",
    fontSize: 22,
    fontWeight: 800,
    color: "#fff",
    textAlign: "center",
    letterSpacing: 1,
    whiteSpace: "nowrap",
  },
  levelUpOverlay: {
    position: "absolute",
    top: "30%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    fontSize: 64,
    fontWeight: "bold",
    color: "#00E5FF",
    textShadow: "0 0 30px #00E5FF, 0 0 10px #fff",
    zIndex: 10,
    animation: "pulse 1s infinite alternate",
  },
  gameOverCard: {
    position: "absolute",
    top: "40%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    textAlign: "center",
    background: "rgba(10, 20, 30, 0.9)",
    backdropFilter: "blur(20px)",
    border: "2px solid rgba(0, 229, 255, 0.4)",
    borderRadius: 24,
    padding: "40px 56px",
    boxShadow: "0 20px 50px rgba(0,0,0,0.6), 0 0 40px rgba(0, 229, 255, 0.2)",
  },
  gameOverTitle: {
    fontSize: 28,
    fontWeight: 800,
    marginBottom: 4,
    color: "#fff",
    textShadow: "0 0 10px rgba(255,255,255,0.4)",
  },
  gameOverNick: {
    fontSize: 20,
    color: "#00E5FF",
    marginBottom: 16,
    fontWeight: "bold",
  },
  gameOverScore: {
    fontSize: 18,
    color: "#8FA3B8",
    marginBottom: 8,
  },
  gameOverStats: {
    fontSize: 14,
    color: "#6c8093",
    marginBottom: 24,
  },
  restartButton: {
    background: "linear-gradient(45deg, #00E5FF, #00B0FF)",
    color: "#000",
    border: "none",
    borderRadius: 12,
    padding: "14px 24px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(0, 229, 255, 0.5)",
  },
  shareButton: {
    background: "#FFEB3B",
    color: "#000",
    border: "none",
    borderRadius: 12,
    padding: "14px 24px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(255, 235, 59, 0.5)",
  },
  inputRow: {
    display: "flex",
    gap: 16,
    padding: "24px 32px 40px",
    zIndex: 3,
    background: "rgba(0, 0, 0, 0.3)",
    backdropFilter: "blur(12px)",
  },
  input: {
    flex: 1,
    background: "rgba(0, 0, 0, 0.5)",
    border: "2px solid rgba(0, 229, 255, 0.4)",
    borderRadius: 12,
    padding: "16px 24px",
    fontSize: 22,
    color: "#fff",
    fontFamily: "'Consolas', 'Menlo', monospace",
    outline: "none",
    boxShadow: "inset 0 2px 10px rgba(0,0,0,0.6)",
  },
  submitButton: {
    background: "linear-gradient(45deg, #00E5FF, #00B0FF)",
    color: "#000",
    border: "none",
    borderRadius: 12,
    padding: "0 40px",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 15px rgba(0, 229, 255, 0.4)",
  },
  toast: {
    position: "absolute",
    bottom: "20%",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(0,255,100,0.8)",
    color: "#000",
    padding: "10px 20px",
    borderRadius: "20px",
    fontWeight: "bold",
    zIndex: 100,
    animation: "fallDown 3s",
  },
  mcRow: {
    display: "flex",
    gap: 12,
    padding: "20px 24px 32px",
    zIndex: 3,
    background: "rgba(0, 0, 0, 0.35)",
    backdropFilter: "blur(12px)",
    justifyContent: "center",
  },
  mcButton: {
    flex: 1,
    maxWidth: 160,
    minHeight: 72,
    background: "rgba(255, 255, 255, 0.08)",
    border: "2px solid rgba(255, 255, 255, 0.2)",
    borderRadius: 16,
    color: "#EAF2F8",
    fontSize: 28,
    fontWeight: 800,
    fontFamily: "'Consolas', 'Menlo', monospace",
    cursor: "pointer",
    transition: "all 0.15s",
    boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
    letterSpacing: 1,
  },
  mcButtonHint: {
    border: "2px solid rgba(0, 229, 255, 0.5)",
    background: "rgba(0, 229, 255, 0.08)",
  },
  mcWaiting: {
    color: "#8FA3B8",
    fontSize: 16,
    alignSelf: "center",
    padding: "20px 0",
  },
  hudExitButton: {
    background: "rgba(255, 60, 60, 0.15)",
    border: "1px solid rgba(255, 90, 90, 0.4)",
    borderRadius: 8,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    color: "#FF6B6B",
    display: "flex",
    alignItems: "center",
    gap: 4,
    transition: "all 0.2s",
  },
  hudSoundButton: {
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    borderRadius: 8,
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 18,
    lineHeight: 1,
    color: "#fff",
    transition: "background 0.2s",
  },
  motivationalOverlay: {
    position: "absolute",
    top: "35%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    fontSize: 36,
    fontWeight: 900,
    color: "#FFE600",
    textShadow: "0 0 20px rgba(255, 230, 0, 0.8), 0 0 40px rgba(255, 120, 0, 0.6), 0 4px 10px rgba(0,0,0,0.9)",
    pointerEvents: "none",
    zIndex: 25,
    animation: "popupMotiv 1.2s ease-out forwards",
    letterSpacing: 2,
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  modalBackdrop: {
    position: "absolute",
    inset: 0,
    background: "rgba(0, 0, 0, 0.75)",
    backdropFilter: "blur(10px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    animation: "levelUpAnim 0.3s ease-out",
  },
  modalCard: {
    background: "rgba(15, 23, 42, 0.95)",
    border: "2px solid rgba(0, 229, 255, 0.4)",
    borderRadius: 24,
    padding: "32px 36px",
    textAlign: "center",
    maxWidth: 420,
    width: "90%",
    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(0, 229, 255, 0.2)",
  },
  modalTitle: {
    margin: "0 0 10px",
    fontSize: 22,
    fontWeight: 800,
    color: "#fff",
  },
  modalSubtitle: {
    margin: "0 0 20px",
    fontSize: 14,
    color: "#8FA3B8",
    lineHeight: 1.5,
  },
  modalCancelBtn: {
    flex: 1,
    padding: "12px 18px",
    borderRadius: 12,
    border: "1px solid rgba(255, 255, 255, 0.2)",
    background: "rgba(255, 255, 255, 0.1)",
    color: "#EAF2F8",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  modalConfirmBtn: {
    flex: 1,
    padding: "12px 18px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(45deg, #FF1744, #D50000)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 15px rgba(255, 23, 68, 0.4)",
    transition: "all 0.2s",
  },
};
