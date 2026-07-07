import { useState, useRef, useEffect, useCallback } from "react";
import {
  Mic, Send, Volume2, VolumeX, Sparkles, RotateCcw,
  BookOpen, MessageCircle, Trash2, X, Repeat, Loader2, Languages,
} from "lucide-react";

const COLORS = {
  bg: "#12121a",
  surface: "#1c1c29",
  surfaceAlt: "#22222f",
  border: "#2a2a3a",
  accent: "#ff5d7a",
  accentSoft: "#ff5d7a22",
  mint: "#4fd1a5",
  mintSoft: "#4fd1a522",
  gold: "#ffc861",
  text: "#f5f3f7",
  muted: "#9a97ab",
};

const SCENARIOS = [
  {
    id: "free",
    label: "フリートーク",
    greetings: [
      "Hey hey! I'm Kuro. Let's just chat — what's on your mind today?",
      "Hi! Good to see you. So, how's everything going?",
      "Hey! I was hoping you'd show up. What should we talk about today?",
      "Hello hello! Anything interesting happen today?",
    ],
    context:
      "This is an open free-talk session. Follow whatever topic the learner brings up and keep the conversation natural and curious.",
  },
  {
    id: "travel",
    label: "旅行・チェックイン",
    greetings: [
      "Welcome! I'll play the hotel front desk. Go ahead — you can start checking in whenever you're ready.",
      "Good afternoon, welcome to the Grand Hotel! How may I help you today?",
      "Hi there! Checking in? May I have your name, please?",
      "Welcome! You must be tired from your trip. Do you have a reservation with us?",
    ],
    context:
      "Roleplay: you are hotel front-desk staff. Stay in character, ask for name/reservation/room preferences naturally.",
  },
  {
    id: "restaurant",
    label: "レストラン",
    greetings: [
      "Good evening! Table for one? I'll be your server tonight — what can I get started for you?",
      "Hi, welcome in! Can I start you off with something to drink?",
      "Good evening! Here's the menu — today's special is the grilled salmon. Take your time!",
      "Hey there, welcome! Is this your first time dining with us?",
    ],
    context:
      "Roleplay: you are a restaurant server. Stay in character, take the order, suggest dishes, ask follow-up questions.",
  },
  {
    id: "interview",
    label: "ビジネス面談",
    greetings: [
      "Nice to meet you. I'll be interviewing you today — could you start by telling me a bit about your work?",
      "Thanks for coming in today. Shall we start with a quick introduction of yourself?",
      "Good morning! I've read your profile — impressive background. What made you interested in this role?",
      "Nice to meet you! Let's keep this casual. First off — what kind of projects are you working on these days?",
    ],
    context:
      "Roleplay: you are a professional interviewer for a business/technical role. Ask about experience, technical background, motivations.",
  },
  {
    id: "smalltalk",
    label: "スモールトーク",
    greetings: [
      "Hey! How's your day going so far?",
      "Morning! Beautiful day, isn't it?",
      "Hey! Did you do anything fun over the weekend?",
      "Hi! You look busy lately — how's work treating you?",
    ],
    context:
      "This is a casual small-talk session — weather, weekend plans, hobbies, that kind of light conversation.",
  },
];

function pickGreeting(s) {
  return s.greetings[Math.floor(Math.random() * s.greetings.length)];
}

// ---- voice gender heuristics (Web Speech API has no gender metadata) ----
const FEMALE_HINTS = [
  "samantha", "zira", "aria", "jenny", "michelle", "ana",
  "female", "woman", "google us english", "karen", "moira",
  "tessa", "victoria", "allison", "ava", "susan", "joanna",
  "sonia", "libby", "hazel", "heera", "emma", "olivia", "amber",
  "salli", "kimberly", "ivy", "kendra", "clara", "natasha", "catherine",
];
const MALE_HINTS = [
  "david", "mark", "george", "guy", "james", "ryan", "eric",
  "richard", "sean", "william", "thomas", "brian", "christopher",
  "male", "man", "daniel", "alex", "fred", "oliver", "liam",
];
function isLikelyMale(v) {
  const n = v.name.toLowerCase();
  if (n.includes("female")) return false;
  return MALE_HINTS.some((h) => n.includes(h));
}
function isLikelyFemale(v) {
  const n = v.name.toLowerCase();
  return !isLikelyMale(v) && FEMALE_HINTS.some((h) => n.includes(h));
}

function buildSystemPrompt(scenario) {
  return `You are Kuro — a bright, energetic, warm AI conversation partner helping a Japanese professional practice spoken English. Think of the vibe as someone genuinely fun to talk to: upbeat, quick with a light exclamation, never condescending, never a "lecture mode" tutor. You're a companion in the conversation, not a service desk.

Personality notes:
- Warm energy that comes toward the person, but never pushy or over the top.
- If you (Kuro) need to walk something back or you misread something, you shrug it off lightly — "oh, my bad!" energy — and keep moving.
- You can lighten a heavy topic a little without dismissing it.
- You're genuinely curious about what the learner says — react like a real conversation partner, not a script.

Scenario context: ${scenario.context}

Rules:
1. Reply in natural, conversational English. Keep it short — 1 to 3 sentences — so the learner has room to jump back in.
2. Look at the learner's most recent message. If it had a grammar, word-choice, or naturalness issue, put a short corrected version (max 15 words) in "correction". If it was already fine, set "correction" to null. Never correct things that are already correct just to have something to say.
3. SPECIAL CASE — Japanese input: if the learner's message is mostly Japanese, they're asking "how do I say this in English?". Reply with the natural English phrase in double quotes, then one short cheerful line inviting them to try saying it themselves (e.g. Now you try!). Set "correction" to null in this case.
4. Stay fully in the flow of the roleplay/topic — never lecture, never break character to explain grammar rules at length.
5. Respond with ONLY valid JSON, no markdown fences, no extra text, in exactly this shape:
{"reply": "...", "correction": "..." or null}`;
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
const API_CALL_COUNT_KEY = "kuro-english-api-call-count";

// 呼び出し回数をlocalStorageに積算する（会話・翻訳・単語検索すべてを含む総量）
function bumpApiCallCount() {
  try {
    const current = Number(localStorage.getItem(API_CALL_COUNT_KEY) || "0");
    const next = current + 1;
    localStorage.setItem(API_CALL_COUNT_KEY, String(next));
    window.dispatchEvent(new CustomEvent("kuro-api-call-count", { detail: next }));
    return next;
  } catch {
    return null;
  }
}

// body: { system?: string, messages: [{role: "user"|"assistant", content: string}], json?: boolean (default true) }
async function callClaude(body) {
  if (!GEMINI_API_KEY) {
    throw new Error("APIキー未設定（ビルドにVITE_GEMINI_API_KEYが入っていません）");
  }
  const { system, messages, json = true } = body;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const payload = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
  };
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = await response.json();
  if (data?.error) {
    throw new Error(`Gemini APIエラー: ${data.error.message || data.error.status || "不明"}`);
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("\n");
  if (!text.trim()) {
    throw new Error(`Geminiから空の応答（finishReason: ${data?.candidates?.[0]?.finishReason || "不明"}）`);
  }
  bumpApiCallCount();
  return text;
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return fallback;
  }
}

// split text into clickable word tokens + punctuation/space
function tokenize(text) {
  return text.split(/(\s+)/).map((chunk) => {
    const word = chunk.replace(/^[^A-Za-z'-]+|[^A-Za-z'-]+$/g, "");
    return { chunk, word: /[A-Za-z]/.test(word) ? word : null };
  });
}

export default function KuroEnglish() {
  const [tab, setTab] = useState("chat"); // chat | review
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [messages, setMessages] = useState([
    { role: "assistant", text: pickGreeting(SCENARIOS[0]), correction: null },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [handsFree, setHandsFree] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [stats, setStats] = useState({ totalTurns: 0 });
  const [apiCallCount, setApiCallCount] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [lookup, setLookup] = useState(null); // {word, loading, meaning, example}
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");

  const recognitionRef = useRef(null);
  const scrollRef = useRef(null);
  const voiceRef = useRef(null);
  const messagesRef = useRef(messages);
  const loadingRef = useRef(false);
  const handsFreeRef = useRef(false);
  const scenarioRef = useRef(scenario);
  const statsRef = useRef(stats);
  const reviewsRef = useRef(reviews);
  const lookupCache = useRef({});

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);
  useEffect(() => { scenarioRef.current = scenario; }, [scenario]);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { reviewsRef.current = reviews; }, [reviews]);

  // ---- persisted data (localStorage) ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem("kuro-english-stats");
      if (raw) setStats(JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem("kuro-english-reviews");
      if (raw) setReviews(JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem(API_CALL_COUNT_KEY);
      if (raw) setApiCallCount(Number(raw));
    } catch {}
  }, []);

  // callClaude() が成功するたびに発火するイベントを購読し、表示中の件数を更新する
  useEffect(() => {
    const onCount = (e) => setApiCallCount(e.detail);
    window.addEventListener("kuro-api-call-count", onCount);
    return () => window.removeEventListener("kuro-api-call-count", onCount);
  }, []);

  const saveReview = useCallback((original, corrected) => {
    const next = [
      { original, corrected, date: new Date().toISOString().slice(0, 10) },
      ...reviewsRef.current,
    ].slice(0, 200);
    setReviews(next);
    try { localStorage.setItem("kuro-english-reviews", JSON.stringify(next)); } catch {}
  }, []);

  const deleteReview = useCallback((idx) => {
    const next = reviewsRef.current.filter((_, i) => i !== idx);
    setReviews(next);
    try { localStorage.setItem("kuro-english-reviews", JSON.stringify(next)); } catch {}
  }, []);

  const bumpStats = useCallback(() => {
    const next = { totalTurns: statsRef.current.totalTurns + 1 };
    setStats(next);
    try { localStorage.setItem("kuro-english-stats", JSON.stringify(next)); } catch {}
  }, []);

  // ---- voices (female only) ----
  useEffect(() => {
    const pickVoice = () => {
      const all = (window.speechSynthesis?.getVoices() || []).filter((v) =>
        v.lang?.toLowerCase().startsWith("en")
      );
      const females = all.filter(isLikelyFemale);
      // female-confirmed voices only; if none found, fall back to "not male" ; last resort all
      const notMale = all.filter((v) => !isLikelyMale(v));
      const shown = females.length > 0 ? females : notMale.length > 0 ? notMale : all;
      setVoices(shown);
      const scored = [...shown].sort((a, b) => {
        const score = (v) => {
          const n = v.name.toLowerCase();
          let s = 0;
          if (isLikelyFemale(v)) s += 10;
          if (n.includes("natural") || n.includes("online")) s += 5;
          if (v.lang === "en-US") s += 3;
          return s;
        };
        return score(b) - score(a);
      });
      const best = scored[0] || null;
      voiceRef.current = best;
      if (best) setVoiceName(best.name);
    };
    pickVoice();
    window.speechSynthesis?.addEventListener("voiceschanged", pickVoice);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", pickVoice);
  }, []);

  function selectVoice(name) {
    const v = voices.find((x) => x.name === name);
    if (v) {
      voiceRef.current = v;
      setVoiceName(name);
      speakNow("Hey! I'm Kuro. How's this voice?", false);
    }
  }

  // ---- speech synthesis ----
  const startMic = useCallback(() => {
    if (!recognitionRef.current || loadingRef.current) return;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {}
  }, []);

  function speakNow(text, allowHandsFreeLoop = true) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 0.98;
    if (voiceRef.current) utter.voice = voiceRef.current;
    if (allowHandsFreeLoop) {
      utter.onend = () => {
        if (handsFreeRef.current) setTimeout(() => startMic(), 250);
      };
    }
    window.speechSynthesis.speak(utter);
  }

  // ---- send message ----
  const sendMessage = useCallback(
    async (rawText) => {
      const text = (rawText || "").trim();
      if (!text || loadingRef.current) return;
      const userMsg = { role: "user", text, correction: null };
      const nextMessages = [...messagesRef.current, userMsg];
      setMessages(nextMessages);
      setInput("");
      setLoading(true);
      try {
        const raw = await callClaude({
          system: buildSystemPrompt(scenarioRef.current),
          messages: nextMessages.map((m) => ({ role: m.role, content: m.text })),
        });
        const parsed = parseJson(raw, { reply: raw || "Sorry, say that again?", correction: null });
        const reply = parsed.reply || "...";
        const correction = parsed.correction || null;
        setMessages((prev) => [...prev, { role: "assistant", text: reply, correction }]);
        if (correction) saveReview(text, correction);
        if (soundOn || handsFreeRef.current) speakNow(reply);
        bumpStats();
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Oops, something went wrong — try once more?\n⚠ ${e?.message || e}`,
            correction: null,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [soundOn, saveReview, bumpStats]
  );

  const sendRef = useRef(sendMessage);
  useEffect(() => { sendRef.current = sendMessage; }, [sendMessage]);

  // ---- speech recognition (auto-send) ----
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicSupported(false);
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      if (transcript && transcript.trim()) sendRef.current(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  function toggleMic() {
    if (!micSupported || loading) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
    } else {
      startMic();
    }
  }

  function switchScenario(s) {
    setScenario(s);
    setMessages([{ role: "assistant", text: pickGreeting(s), correction: null }]);
    window.speechSynthesis?.cancel();
  }

  function resetConversation() {
    setMessages([{ role: "assistant", text: pickGreeting(scenario), correction: null }]);
    window.speechSynthesis?.cancel();
  }

  // ---- sentence translation ----
  const [translations, setTranslations] = useState({}); // {msgIndex: {text, show}}

  async function toggleTranslate(idx, text) {
    const existing = translations[idx];
    if (existing) {
      // already fetched — just toggle visibility
      setTranslations((prev) => ({ ...prev, [idx]: { ...existing, show: !existing.show } }));
      return;
    }
    setTranslations((prev) => ({ ...prev, [idx]: { text: null, show: true, loading: true } }));
    try {
      const raw = await callClaude({
        json: false,
        messages: [
          {
            role: "user",
            content: `Translate this English sentence into natural Japanese. Respond with ONLY the Japanese translation, nothing else:\n\n${text}`,
          },
        ],
      });
      setTranslations((prev) => ({ ...prev, [idx]: { text: raw.trim(), show: true, loading: false } }));
    } catch {
      setTranslations((prev) => ({
        ...prev,
        [idx]: { text: "翻訳エラー。もう一回タップしてみて", show: true, loading: false },
      }));
    }
  }

  // ---- word lookup ----
  async function openLookup(word) {
    const key = word.toLowerCase();
    if (lookupCache.current[key]) {
      setLookup({ word, loading: false, ...lookupCache.current[key] });
      return;
    }
    setLookup({ word, loading: true });
    try {
      const raw = await callClaude({
        messages: [
          {
            role: "user",
            content: `Define the English word "${word}" for a Japanese English learner. Respond with ONLY valid JSON, no markdown fences: {"meaning":"日本語での簡潔な意味（品詞も。40字以内）","example":"a short natural example sentence in English","exampleJa":"その例文の日本語訳"}`,
          },
        ],
      });
      const parsed = parseJson(raw, null);
      if (parsed && parsed.meaning) {
        lookupCache.current[key] = parsed;
        setLookup({ word, loading: false, ...parsed });
      } else {
        setLookup({ word, loading: false, meaning: "うまく取得できなかった…もう一回タップしてみて", example: "", exampleJa: "" });
      }
    } catch {
      setLookup({ word, loading: false, meaning: "通信エラー。もう一回試してみて", example: "", exampleJa: "" });
    }
  }

  // ---- render helpers ----
  function renderAssistantText(text) {
    return tokenize(text).map((t, i) =>
      t.word ? (
        <span
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            openLookup(t.word);
          }}
          style={{ cursor: "pointer", borderBottom: `1px dotted ${COLORS.border}` }}
        >
          {t.chunk}
        </span>
      ) : (
        <span key={i}>{t.chunk}</span>
      )
    );
  }

  const chipStyle = (active) => ({
    background: active ? COLORS.accent : COLORS.surface,
    color: active ? "#12121a" : COLORS.muted,
    border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
  });

  return (
    <div
      className="flex flex-col w-full overflow-hidden relative"
      style={{
        height: "100dvh",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "system-ui, sans-serif",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {/* header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: COLORS.border, background: COLORS.surface }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `linear-gradient(135deg, ${COLORS.accent}, #ffb199)` }}
          >
            <Sparkles size={18} color="#12121a" />
          </div>
          <div>
            <div className="font-semibold leading-tight">くろ</div>
            <div className="text-xs" style={{ color: COLORS.muted }}>
              英会話パートナー ・ 発話 {stats.totalTurns}回
            </div>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] underline"
              style={{ color: COLORS.muted }}
            >
              API利用 累計{apiCallCount}回（正確な残り枠はAI Studioで確認）
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHandsFree((v) => !v)}
            className="px-2.5 py-2 rounded-full flex items-center gap-1.5 text-xs font-medium"
            style={{
              background: handsFree ? COLORS.mintSoft : COLORS.surfaceAlt,
              color: handsFree ? COLORS.mint : COLORS.muted,
              border: `1px solid ${handsFree ? COLORS.mint : COLORS.border}`,
            }}
            aria-label="ハンズフリー会話モード"
          >
            <Repeat size={14} />
            {handsFree ? "連続会話ON" : "連続会話"}
          </button>
          <button
            onClick={resetConversation}
            className="p-2 rounded-full"
            style={{ background: COLORS.surfaceAlt }}
            aria-label="会話をリセット"
          >
            <RotateCcw size={16} color={COLORS.muted} />
          </button>
          <button
            onClick={() => {
              setSoundOn((v) => !v);
              window.speechSynthesis?.cancel();
            }}
            className="p-2 rounded-full"
            style={{ background: COLORS.surfaceAlt }}
            aria-label="音声読み上げの切り替え"
          >
            {soundOn ? <Volume2 size={16} color={COLORS.mint} /> : <VolumeX size={16} color={COLORS.muted} />}
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex px-4 pt-2 gap-2 shrink-0" style={{ background: COLORS.bg }}>
        <button
          onClick={() => setTab("chat")}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
          style={chipStyle(tab === "chat")}
        >
          <MessageCircle size={13} /> 会話
        </button>
        <button
          onClick={() => setTab("review")}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
          style={chipStyle(tab === "review")}
        >
          <BookOpen size={13} /> 復習ノート{reviews.length > 0 ? ` (${reviews.length})` : ""}
        </button>
      </div>

      {tab === "chat" ? (
        <>
          {/* scenario chips + voice */}
          <div className="flex gap-2 px-4 py-2.5 overflow-x-auto shrink-0 items-center" style={{ background: COLORS.bg }}>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => switchScenario(s)}
                className="text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 transition"
                style={chipStyle(s.id === scenario.id)}
              >
                {s.label}
              </button>
            ))}
            {voices.length > 0 ? (
              <select
                value={voiceName}
                onChange={(e) => selectVoice(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-full shrink-0 outline-none"
                style={{
                  background: COLORS.surface,
                  color: COLORS.muted,
                  border: `1px solid ${COLORS.border}`,
                  maxWidth: 180,
                }}
                aria-label="くろの声を選ぶ"
              >
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    🎤 {v.name}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="text-[10px] px-2 py-1.5 rounded-full shrink-0"
                style={{ background: COLORS.surface, color: COLORS.muted, border: `1px solid ${COLORS.border}` }}
              >
                🎤 端末標準の声を使用（変更は端末の「テキスト読み上げ」設定から）
              </span>
            )}
          </div>

          {/* chat area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
            <div className="text-[11px] text-center pb-1" style={{ color: COLORS.muted }}>
              単語タップ→意味 ・ 🔊読み上げ ・ 🌐日本語訳 ・ 日本語で書くと英語の言い方を教えるよ
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[85%]">
                  <div
                    className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed"
                    style={{
                      background: m.role === "user" ? COLORS.accent : COLORS.surface,
                      color: m.role === "user" ? "#12121a" : COLORS.text,
                      border: m.role === "assistant" ? `1px solid ${COLORS.border}` : "none",
                    }}
                  >
                    {m.role === "assistant" ? renderAssistantText(m.text) : m.text}
                    {m.role === "assistant" && (
                      <>
                        <button
                          onClick={() => speakNow(m.text, false)}
                          aria-label="読み上げ"
                          style={{ marginLeft: 8, verticalAlign: "-2px" }}
                        >
                          <Volume2 size={13} color={COLORS.mint} />
                        </button>
                        <button
                          onClick={() => toggleTranslate(i, m.text)}
                          aria-label="日本語に翻訳"
                          style={{ marginLeft: 6, verticalAlign: "-2px" }}
                        >
                          <Languages
                            size={13}
                            color={translations[i]?.show ? COLORS.gold : COLORS.muted}
                          />
                        </button>
                      </>
                    )}
                  </div>
                  {m.role === "assistant" && translations[i]?.show && (
                    <div
                      className="mt-1.5 px-3 py-1.5 rounded-xl text-xs leading-relaxed"
                      style={{ background: COLORS.surfaceAlt, color: COLORS.muted }}
                    >
                      {translations[i].loading ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 size={12} className="animate-spin" /> 翻訳中…
                        </span>
                      ) : (
                        <>🇯🇵 <span style={{ color: COLORS.text }}>{translations[i].text}</span></>
                      )}
                    </div>
                  )}
                  {m.correction && (
                    <div
                      className="mt-1.5 px-3 py-1.5 rounded-xl text-xs leading-relaxed"
                      style={{ background: COLORS.mintSoft, color: COLORS.mint }}
                    >
                      💡 <span style={{ color: COLORS.text }}>{m.correction}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div
                  className="px-3.5 py-2.5 rounded-2xl flex gap-1"
                  style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
                >
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ background: COLORS.muted, animationDelay: `${d * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* input bar */}
          <div
            className="p-3 border-t shrink-0"
            style={{
              borderColor: COLORS.border,
              background: COLORS.surface,
              paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
            }}
          >
            {!micSupported && (
              <div className="text-xs mb-2 text-center" style={{ color: COLORS.muted }}>
                この端末は音声入力非対応みたい。テキストで話しかけてね（Chrome/Edge推奨）
              </div>
            )}
            <div className="flex items-center gap-2">
              {micSupported && (
                <button
                  onClick={toggleMic}
                  disabled={loading}
                  className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 transition"
                  style={{
                    background: listening ? COLORS.accent : COLORS.surfaceAlt,
                    boxShadow: listening ? `0 0 0 5px ${COLORS.accentSoft}` : "none",
                  }}
                  aria-label="音声入力（喋り終わると自動送信）"
                >
                  <Mic size={19} color={listening ? "#12121a" : COLORS.muted} />
                </button>
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                placeholder={listening ? "Listening... 喋り終わると自動送信" : "英語で入力（日本語もOK）"}
                className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none"
                style={{ background: COLORS.surfaceAlt, color: COLORS.text }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                style={{ background: input.trim() ? COLORS.accent : COLORS.surfaceAlt }}
                aria-label="送信"
              >
                <Send size={17} color={input.trim() ? "#12121a" : COLORS.muted} />
              </button>
            </div>
          </div>
        </>
      ) : (
        /* review tab */
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {reviews.length === 0 ? (
            <div className="text-sm text-center pt-10" style={{ color: COLORS.muted }}>
              まだ復習フレーズはないよ。<br />
              会話中に訂正💡が出ると、ここに自動で貯まっていく！
            </div>
          ) : (
            reviews.map((r, i) => (
              <div
                key={i}
                className="rounded-2xl px-3.5 py-3"
                style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs line-through break-words" style={{ color: COLORS.muted }}>
                      {r.original}
                    </div>
                    <div className="text-sm mt-1 break-words" style={{ color: COLORS.mint }}>
                      ✅ {r.corrected}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => speakNow(r.corrected, false)}
                      className="p-1.5 rounded-full"
                      style={{ background: COLORS.surfaceAlt }}
                      aria-label="読み上げ"
                    >
                      <Volume2 size={14} color={COLORS.mint} />
                    </button>
                    <button
                      onClick={() => deleteReview(i)}
                      className="p-1.5 rounded-full"
                      style={{ background: COLORS.surfaceAlt }}
                      aria-label="削除"
                    >
                      <Trash2 size={14} color={COLORS.muted} />
                    </button>
                  </div>
                </div>
                <div className="text-[10px] mt-1.5" style={{ color: COLORS.muted }}>
                  {r.date}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* word lookup bottom sheet */}
      {lookup && (
        <div
          className="absolute inset-0 flex items-end justify-center"
          style={{ background: "#00000088", zIndex: 50 }}
          onClick={() => setLookup(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl px-5 pt-4 pb-6"
            style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-lg font-semibold">{lookup.word}</span>
                <button
                  onClick={() => speakNow(lookup.word, false)}
                  className="p-1.5 rounded-full"
                  style={{ background: COLORS.surfaceAlt }}
                  aria-label="単語を読み上げ"
                >
                  <Volume2 size={15} color={COLORS.mint} />
                </button>
              </div>
              <button onClick={() => setLookup(null)} className="p-1.5" aria-label="閉じる">
                <X size={18} color={COLORS.muted} />
              </button>
            </div>
            {lookup.loading ? (
              <div className="flex items-center gap-2 text-sm py-3" style={{ color: COLORS.muted }}>
                <Loader2 size={16} className="animate-spin" /> 調べてる…
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="text-sm leading-relaxed">{lookup.meaning}</div>
                {lookup.example && (
                  <div
                    className="rounded-xl px-3 py-2.5 text-sm leading-relaxed"
                    style={{ background: COLORS.surfaceAlt }}
                  >
                    <span
                      onClick={() => speakNow(lookup.example, false)}
                      style={{ cursor: "pointer", color: COLORS.gold }}
                    >
                      {lookup.example} 🔊
                    </span>
                    {lookup.exampleJa && (
                      <div className="text-xs mt-1" style={{ color: COLORS.muted }}>
                        {lookup.exampleJa}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
