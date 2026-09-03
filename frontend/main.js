const BACKEND_URL = 'http://127.0.0.1:5000/analyze';

// alphaTab: سیم ۱ = زیرترین سیم (high E). تیونینگ استاندارد گیتار:
// string 1 = E4(64), 2 = B3(59), 3 = G3(55), 4 = D3(50), 5 = A2(45), 6 = E2(40)
const STRING_TUNING = [64, 59, 55, 50, 45, 40];
const FRET_LIMIT = 22;
const CHORD_TOLERANCE_S = 0.05; // نت‌هایی با فاصله کمتر = یک کورد (یک بیت)

let tabApi = null;

document.getElementById('analyzeBtn').addEventListener('click', analyze);

async function analyze() {
  const fileInput = document.getElementById('audioInput');
  const statusEl = document.getElementById('status');
  const file = fileInput.files[0];

  if (!file) {
    statusEl.textContent = 'لطفاً اول یک فایل صوتی انتخاب کنید.';
    return;
  }

  statusEl.textContent = '⏳ در حال پردازش روی سرور...';
  const form = new FormData();
  form.append('audio', file);

  try {
    const res = await fetch(BACKEND_URL, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`سرور خطای ${res.status} داد`);
    const data = await res.json();

    const lastOnset = data.notes[data.notes.length - 1]?.onset ?? 0;
    statusEl.textContent = `✅ ${data.note_count} نت استخراج شد (${lastOnset.toFixed(1)} ثانیه صدا).`;
    renderTab(data.notes);
  } catch (err) {
    statusEl.textContent = `❌ خطا: ${err.message}`;
  }
}

// تبدیل MIDI pitch به بهترین موقعیت {سیم، فرت}: کمترین فرت ممکن، روی زیرترین سیم ممکن
function midiToFret(midi) {
  let best = null;
  for (let s = 0; s < STRING_TUNING.length; s++) {
    const fret = midi - STRING_TUNING[s];
    if (fret >= 0 && fret <= FRET_LIMIT) {
      if (!best || fret < best.fret) best = { string: s + 1, fret };
    }
  }
  return best;
}

// مدت‌زمان واقعی نت → نزدیک‌ترین ارزش کشش در نت‌نویسی
function quantizeDuration(seconds) {
  if (seconds <= 0.25) return '16';
  if (seconds <= 0.5) return '8';
  if (seconds <= 0.95) return '4';
  if (seconds <= 1.9) return '2';
  return '1';
}

// گروه‌بندی نت‌های هم‌زمان (کورد) در یک بیت
function groupIntoBeats(notes) {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset);
  const beats = [];
  for (const n of sorted) {
    const last = beats[beats.length - 1];
    if (last && n.onset - last.onset <= CHORD_TOLERANCE_S) {
      last.pitches.push(n.pitch);
    } else {
      beats.push({ duration: n.offset - n.onset, pitches: [n.pitch] });
    }
  }
  return beats;
}

function beatsToTex(beats) {
  return beats
    .map((beat) => {
      const positions = beat.pitches.map(midiToFret).filter(Boolean);
      if (!positions.length) return null; // خارج از محدوده (مثل نت 87)

      const dur = quantizeDuration(beat.duration);
      if (positions.length === 1) {
        const { string, fret } = positions[0];
        return `${fret}.${string}.${dur}`;
      }
      const chord = positions.map(({ string, fret }) => `${fret}.${string}`).join(' ');
      return `(${chord}).${dur}`;
    })
    .filter(Boolean)
    .join(' ');
}

function renderTab(notes) {
  const beats = groupIntoBeats(notes);
  const tex = `\\title "Mus2Tab"\n\\tempo 120\n.\n${beatsToTex(beats)}`;

  const container = document.getElementById('alphaTab');
  container.innerHTML = '';

  if (!tabApi) {
    tabApi = new alphaTab.AlphaTabApi(container, {
      core: { tex: true },
      display: { layoutMode: 'horizontal' },
    });
  }
  tabApi.tex(tex);
}
