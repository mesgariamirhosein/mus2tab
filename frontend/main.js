// ─── ثوابت پیکربندی ──────────────────────────────────────────────
const BACKEND_URL   = 'http://127.0.0.1:5000/analyze';
const STRING_TUNING = [64, 59, 55, 50, 45, 40]; // E4 B3 G3 D3 A2 E2
const FRET_LIMIT    = 22;
const CHORD_TOL_S   = 0.05;

// ─── وضعیت سراسری ────────────────────────────────────────────────
let tabApi        = null;
let currentObjUrl = null; // برای رفع نشت حافظه

// ─── رفرنس‌های DOM ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const audioInput   = document.getElementById('audioInput');
  const statusEl     = document.getElementById('status');
  const playerBar    = document.getElementById('playerBar');
  const playBtn      = document.getElementById('playBtn');
  const stopBtn      = document.getElementById('stopBtn');
  const progressFill = document.getElementById('progressFill');
  const timeLabel    = document.getElementById('timeLabel');

  // ─── اتصال دکمه‌ها ─────────────────────────────────────────────
  document.getElementById('analyzeBtn').addEventListener('click', () => analyze(audioInput, statusEl, playerBar, playBtn, stopBtn, progressFill, timeLabel));

  playBtn.addEventListener('click', () => {
    if (!tabApi) return;
    tabApi.playPause();
  });

  stopBtn.addEventListener('click', () => {
    if (!tabApi) return;
    tabApi.stop();
    progressFill.style.width = '0%';
    timeLabel.textContent    = '0:00';
    playBtn.textContent      = '▶';
  });
});

// ─── مرحله ۱: آنالیز فایل صوتی ─────────────────────────────────
async function analyze(audioInput, statusEl, playerBar, playBtn, stopBtn, progressFill, timeLabel) {
  const file = audioInput.files[0];
  if (!file) {
    statusEl.textContent = '⚠️ ابتدا یک فایل صوتی انتخاب کنید.';
    return;
  }

  statusEl.textContent = '⏳ در حال پردازش روی سرور...';

  const form = new FormData();
  form.append('audio', file);

  try {
    const res = await fetch(BACKEND_URL, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`سرور خطای ${res.status} داد`);
    const data = await res.json();

    const last = data.notes[data.notes.length - 1]?.onset ?? 0;
    statusEl.textContent = `✅ ${data.note_count} نت استخراج شد (${last.toFixed(1)} ثانیه).`;

    renderTab(data.notes, playerBar, playBtn, progressFill, timeLabel);
  } catch (err) {
    statusEl.textContent = `❌ خطا: ${err.message}`;
  }
}

// ─── مرحله ۲: تبدیل MIDI → تبلچر ───────────────────────────────

/**
 * بهترین موقعیت سیم/فرت را برای یک نت MIDI برمی‌گرداند.
 * اولویت با پایین‌ترین فرت روی پایین‌ترین سیم ممکن است.
 */
function midiToFret(midi) {
  let best = null;
  for (let s = 0; s < STRING_TUNING.length; s++) {
    const fret = midi - STRING_TUNING[s];
    if (fret >= 0 && fret <= FRET_LIMIT) {
      if (!best || fret < best.fret) {
        best = { string: s + 1, fret };
      }
    }
  }
  return best;
}

/**
 * مدت زمان نت (ثانیه) را به مقدار تبلچر تبدیل می‌کند.
 */
function quantizeDuration(sec) {
  if (sec <= 0.25) return '16';
  if (sec <= 0.5)  return '8';
  if (sec <= 0.95) return '4';
  if (sec <= 1.9)  return '2';
  return '1';
}

/**
 * نت‌های نزدیک به هم را به عنوان آکورد گروه‌بندی می‌کند.
 * برای هر گروه، از سیم‌های منحصربه‌فرد استفاده می‌شود.
 */
function groupIntoBeats(notes) {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset);
  const beats  = [];

  for (const n of sorted) {
    const last = beats[beats.length - 1];
    if (last && n.onset - last.onset <= CHORD_TOL_S) {
      // جلوگیری از تکرار سیم در یک آکورد
      const pos = midiToFret(n.pitch);
      if (pos && !last.pitches.some(p => midiToFret(p)?.string === pos.string)) {
        last.pitches.push(n.pitch);
      }
    } else {
      beats.push({
        onset:    n.onset,
        duration: n.offset - n.onset,
        pitches:  [n.pitch],
      });
    }
  }
  return beats;
}

/**
 * BPM واقعی را بر اساس فاصله زمانی بین نت‌ها محاسبه می‌کند.
 */
function calcBpm(beats) {
  if (beats.length < 2) return 120;
  const gaps = beats
    .slice(1)
    .map((b, i) => b.onset - beats[i].onset)
    .filter(g => g > 0.05 && g < 2.0); // فیلتر نویز و مکث‌های طولانی

  if (!gaps.length) return 120;
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.max(40, Math.min(240, Math.round(60 / avg)));
}

/**
 * beats را به فرمت متن alphaTab تبدیل می‌کند.
 */
function beatsToTex(beats, bpm) {
  const noteLines = beats
    .map(beat => {
      const positions = beat.pitches.map(midiToFret).filter(Boolean);
      if (!positions.length) return null;
      const dur = quantizeDuration(beat.duration);
      if (positions.length === 1) {
        const { string, fret } = positions[0];
        return `${fret}.${string}.${dur}`;
      }
      // آکورد
      return `(${positions.map(({ string, fret }) => `${fret}.${string}`).join(' ')}).${dur}`;
    })
    .filter(Boolean)
    .join(' ');

  return `\\title "Mus2Tab"\n\\tempo ${bpm}\n.\n${noteLines}`;
}

// ─── مرحله ۳: رندر + راه‌اندازی player ─────────────────────────
function renderTab(notes, playerBar, playBtn, progressFill, timeLabel) {
  // بررسی وجود کتابخانه alphaTab
  if (typeof alphaTab === 'undefined') {
    document.getElementById('status').textContent = '❌ کتابخانه alphaTab بارگذاری نشده.';
    return;
  }

  const beats = groupIntoBeats(notes);
  const bpm   = calcBpm(beats);
  const tex   = beatsToTex(beats, bpm);

  const container = document.getElementById('alphaTab');
  container.innerHTML = '';

  tabApi = new alphaTab.AlphaTabApi(container, {
    core: { tex: true },
    player: {
      enablePlayer:             true,
      enableCursor:             true,
      enableAnimatedBeatCursor: true,
      soundFont: 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/soundfont/sonivox.sf2',
      scrollMode:               'continuous',
      scrollOffsetX:            -80,
      scrollOffsetY:            -20,
    },
    display: { layoutMode: 'horizontal' },
  });

  // ─── رویدادهای player ──────────────────────────────────────────

  tabApi.playerStateChanged.on((args) => {
    playBtn.textContent = args.state === 1 ? '⏸' : '▶';
  });

  tabApi.playerPositionChanged.on((args) => {
    const pct = args.endTime > 0 ? (args.currentTime / args.endTime) * 100 : 0;
    progressFill.style.width = `${pct}%`;
    timeLabel.textContent    = formatTime(args.currentTime / 1000);
  });
  playBtn.disabled = true;   // بلافاصله بعد از ساخت tabد از ساخت tabApi

  tabApi.playerReady.on(() => {
  playBtn.disabled = false;
  });


  tabApi.playerFinished.on(() => {
    playBtn.textContent      = '▶';
    progressFill.style.width = '0%';
    timeLabel.textContent    = '0:00';
  });

tabApi.scoreLoaded.on(() => {
  playerBar.hidden = false;
});

  tabApi.tex(tex);
}

// ─── کمکی ─────────────────────────────────────────────────────
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
