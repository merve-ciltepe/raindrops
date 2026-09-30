const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const DB_FILE = path.join(__dirname, "scores.json");

// ─── Veritabanı Yardımcı Fonksiyonları ─────────────────────────
function readScores() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialScores = [
        { id: 1, nickname: "MatematikUstası", score: 95, level: 19, streak: 18, mode: "typing", date: new Date().toLocaleDateString("tr-TR") },
        { id: 2, nickname: "RainChampion", score: 82, level: 16, streak: 14, mode: "multiple-choice", date: new Date().toLocaleDateString("tr-TR") },
        { id: 3, nickname: "HızlıParmak", score: 68, level: 13, streak: 11, mode: "typing", date: new Date().toLocaleDateString("tr-TR") },
        { id: 4, nickname: "FırtınaAvcısı", score: 54, level: 10, streak: 8, mode: "multiple-choice", date: new Date().toLocaleDateString("tr-TR") },
        { id: 5, nickname: "DahiÇocuk", score: 40, level: 8, streak: 6, mode: "typing", date: new Date().toLocaleDateString("tr-TR") }
      ];
      fs.writeFileSync(DB_FILE, JSON.stringify(initialScores, null, 2), "utf-8");
      return initialScores;
    }
    const data = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(data || "[]");
  } catch (err) {
    console.error("Veritabanı okuma hatası:", err);
    return [];
  }
}

function saveScores(scores) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(scores, null, 2), "utf-8");
  } catch (err) {
    console.error("Veritabanı yazma hatası:", err);
  }
}

function generateProblem(level = 1) {
  let ops = ["+", "-"];
  if (level > 2) ops.push("*");
  if (level > 4) ops.push("/"); // 4. seviyeden sonra bölme

  const op = ops[Math.floor(Math.random() * ops.length)];
  
  // %15 ihtimalle bonus
  const isBonus = Math.random() < 0.15;
  const multiplier = isBonus ? 2 : 1;
  
  let maxNumber = (10 + (level * 5)) * multiplier;

  let a, b, answer, question;

  if (op === "/") {
    answer = Math.floor(Math.random() * Math.min(maxNumber, 12)) + 1;
    b = Math.floor(Math.random() * Math.min(maxNumber, 10)) + 1;
    a = answer * b;
    question = `${a} / ${b}`;
  } else {
    a = Math.floor(Math.random() * maxNumber) + 1;
    b = Math.floor(Math.random() * (op === "*" ? Math.min(maxNumber, 12) : maxNumber)) + 1;

    if (op === "-" && b > a) {
      [a, b] = [b, a];
    }
    answer = op === "+" ? a + b : op === "-" ? a - b : a * b;
    question = `${a} ${op} ${b}`;
  }

  return {
    id: Date.now() + Math.random(),
    question,
    answer,
    isBonus
  };
}

// ─── REST API Endpoint'leri ────────────────────────────────────

app.get("/api/problem", (req, res) => {
  const level = parseInt(req.query.level) || 1;
  res.json(generateProblem(level));
});

// Liderlik Tablosunu Getir (En Yüksek 10 Skor)
app.get("/api/leaderboard", (req, res) => {
  const scores = readScores();
  // Skor ve seviyeye göre azalan sırala
  const sorted = scores.sort((a, b) => b.score - a.score || b.level - a.level).slice(0, 10);
  res.json({ leaderboard: sorted });
});

// Yeni Skor Kaydet
app.post("/api/scores", (req, res) => {
  const { nickname, score, level, streak, mode } = req.body;
  if (!nickname || typeof score !== "number") {
    return res.status(400).json({ error: "Geçersiz veri gönderildi." });
  }

  const scores = readScores();
  const newEntry = {
    id: Date.now(),
    nickname: String(nickname).trim().slice(0, 20),
    score,
    level: level || 1,
    streak: streak || 0,
    mode: mode || "typing",
    date: new Date().toLocaleDateString("tr-TR")
  };

  scores.push(newEntry);
  saveScores(scores);

  const sorted = scores.sort((a, b) => b.score - a.score || b.level - a.level);
  const rank = sorted.findIndex(s => s.id === newEntry.id) + 1;

  res.json({
    success: true,
    rank,
    leaderboard: sorted.slice(0, 10)
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Raindrops backend ${PORT} portunda çalışıyor (Veritabanı aktif: ${DB_FILE})`);
});

