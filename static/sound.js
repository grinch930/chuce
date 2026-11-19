// 出册的声音：背景音乐用 assets/bgm_study.mp3，音效用 WebAudio 现场合成
let ctx = null, master = null, verb = null, muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
  // 简单混响：衰减的噪声脉冲
  verb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  verb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.35; verb.connect(wet).connect(master);
  startBgm(); loadSamples();
}
// 背景音乐：每个场景一首，无缝循环；切换时交叉淡化（setBgm(曲名, 音量)）
const BGM_FILES = { study: './assets/bgm_study.mp3', shanhai: './assets/bgm_shanhai.mp3', alice: './assets/bgm_alice.mp3', boss: './assets/bgm_boss.mp3', prince: './assets/bgm_prince.mp3' };
const bgm = {};                       // name -> { gain, buf, src, loading }
let bgmName = 'study', bgmWant = 0.32;
function startBgm() { setBgm(bgmName, bgmWant, true); }
async function loadTrack(name) {
  const t = bgm[name] || (bgm[name] = { gain: null, loading: null });
  if (!t.loading) t.loading = (async () => {
    const buf = await ctx.decodeAudioData(await (await fetch(BGM_FILES[name])).arrayBuffer());
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    t.gain = ctx.createGain(); t.gain.gain.value = 0; src.connect(t.gain).connect(master); src.start();
  })().catch((e) => console.warn('bgm', name, e));
  await t.loading; return t;
}
export function setBgm(name, v, force = false) {
  if (!BGM_FILES[name]) name = 'study';
  if (!force && name === bgmName && v === bgmWant) return;
  bgmName = name; bgmWant = v;
  if (!ctx) return;
  for (const n in bgm) if (n !== name && bgm[n].gain) bgm[n].gain.gain.setTargetAtTime(0, ctx.currentTime, 0.9);
  loadTrack(name).then((t) => { if (bgmName === name && t.gain) t.gain.gain.setTargetAtTime(bgmWant, ctx.currentTime, name === 'study' && force ? 1.2 : 0.8); });
}
export function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05); }
export function isMuted() { return muted; }
const ok = () => ctx && ctx.state === 'running' && !muted;

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
}
function out(node, dry = 1, wet = 0.3) {
  const g1 = ctx.createGain(); g1.gain.value = dry; node.connect(g1).connect(master);
  if (wet) { const g2 = ctx.createGain(); g2.gain.value = wet; node.connect(g2).connect(verb); }
}

// 纸张窸窣：带通噪声 + 不规则的小爆裂
export function rustle(dur = 0.6, level = 0.5, freq = 2600) {
  if (!ok()) return;
  const t = ctx.currentTime, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.7;
  g.gain.setValueAtTime(0, t);
  const steps = Math.floor(dur * 34);
  for (let i = 0; i < steps; i++) {
    const tt = t + (i / steps) * dur, env = Math.sin((i / steps) * Math.PI);
    g.gain.setValueAtTime(level * env * (0.25 + Math.random() * 0.75), tt);
  }
  g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  n.connect(bp).connect(g); out(g, 1, 0.15);
  n.start(t, Math.random()); n.stop(t + dur + 0.1);
}

// 翻书：一阵风声 + 纸声 + 落下的轻响
// 真实录音的音效：载入后优先使用，没载到就退回合成音
const SAMPLE_FILES = { page: './assets/sfx_page.mp3', rise: './assets/sfx_rise.mp3', ret: './assets/sfx_return.mp3', sparkle: './assets/sfx_sparkle.mp3' };
const samples = {};
function loadSamples() {
  for (const k in SAMPLE_FILES) fetch(SAMPLE_FILES[k]).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => { samples[k] = buf; }).catch((e) => console.warn('sfx', k, e));
}
function playSample(k, { rate = 1, level = 1, delay = 0 } = {}) {
  if (!ok() || !samples[k]) return false;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = samples[k]; src.playbackRate.value = rate; g.gain.value = level;
  src.connect(g).connect(master);
  const w = ctx.createGain(); w.gain.value = 0.12; g.connect(w).connect(verb);
  src.start(ctx.currentTime + delay); return true;
}
// 翻页：open 翻开封面（低一点、重一点），close 合上，turn 翻一页（每次音高略有不同，连翻不机械）
export function pageTurn(kind = 'turn') {
  const r = 0.94 + Math.random() * 0.12;
  if (kind === 'open' && playSample('page', { rate: 0.86 * r, level: 0.95 })) { thumpSoft(0.55); return; }
  if (kind === 'close' && playSample('page', { rate: 0.9 * r, level: 0.85 })) { thumpSoft(0.75); return; }
  if (kind === 'turn' && playSample('page', { rate: r, level: 0.8 })) return;
  pageTurnSynth();
}
function thumpSoft(at) { if (!ok()) return; setTimeout(() => thump(0.12), at * 1000); }
function pageTurnSynth() {
  if (!ok()) return;
  const t = ctx.currentTime, n = noise(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(2200, t + 0.6); lp.frequency.exponentialRampToValueAtTime(500, t + 1.4);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 1.5);
  n.connect(lp).connect(g); out(g, 1, 0.2); n.start(t); n.stop(t + 1.6);
  setTimeout(() => rustle(0.5, 0.35), 250);
  setTimeout(() => thump(0.25), 1500);
}

// 低沉的“咚”：纸落、狐足落地
export function thump(level = 0.4) {
  if (!ok()) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
  g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  o.connect(g); out(g, 1, 0.2); o.start(t); o.stop(t + 0.4);
}

// 出册：纸面鼓起的“呼”一声，音高上扬
// 入册：角色折回书页（真实录音）
export function ret() { playSample('ret', { rate: 0.97 + Math.random() * 0.06, level: 0.75 }); }
// 金粉闪光：许愿流星雨、新书落下
export function sparkle(level = 0.7) { playSample('sparkle', { rate: 0.95 + Math.random() * 0.1, level }); }
// 出册：角色从书页立起（真实录音；没载到时退回合成音）
export function rise() {
  if (playSample('rise', { rate: 0.98 + Math.random() * 0.04, level: 0.8 })) return;
  if (!ok()) return;
  const t = ctx.currentTime, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 1.3);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t + 0.9); g.gain.linearRampToValueAtTime(0, t + 1.6);
  n.connect(bp).connect(g); out(g, 0.8, 0.5); n.start(t); n.stop(t + 1.7);
  // 底下垫一个缓慢升起的低音
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(98, t); o.frequency.exponentialRampToValueAtTime(147, t + 1.4);
  og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.12, t + 0.8); og.gain.linearRampToValueAtTime(0, t + 1.8);
  o.connect(og); out(og, 1, 0.6); o.start(t); o.stop(t + 1.9);
}

// “其音如婴儿”：带共振峰的颤音，远远地，有回声
export function cry(level = 0.16) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  const f0 = 430 + Math.random() * 40;
  o.frequency.setValueAtTime(f0 * 0.9, t);
  o.frequency.linearRampToValueAtTime(f0 * 1.18, t + 0.22);
  o.frequency.linearRampToValueAtTime(f0 * 1.05, t + 0.55);
  o.frequency.linearRampToValueAtTime(f0 * 0.78, t + 0.95);
  const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 6.5; vg.gain.value = f0 * 0.025;
  vib.connect(vg).connect(o.frequency);
  const sum = ctx.createGain(); sum.gain.value = 1;
  for (const [f, q, gn] of [[950, 8, 1], [1750, 10, 0.55], [3000, 12, 0.2]]) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gn; o.connect(bp).connect(g).connect(sum);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(level, t + 0.12);
  env.gain.setValueAtTime(level, t + 0.6); env.gain.exponentialRampToValueAtTime(0.0008, t + 1.05);
  sum.connect(env); out(env, 0.55, 0.9);
  o.start(t); vib.start(t); o.stop(t + 1.1); vib.stop(t + 1.1);
}

// 题记浮现：一声琴音（拨弦合成）
export function pluck(freq = 293.66, level = 0.22) {
  if (!ok()) return;
  const t = ctx.currentTime;
  for (const [mult, g0, dec] of [[1, 1, 2.2], [2, 0.35, 1.2], [3, 0.12, 0.7], [4.02, 0.06, 0.4]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * g0, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
    o.connect(g); out(g, 1, 0.45); o.start(t); o.stop(t + dec + 0.05);
  }
}

// 狰：“其音如击石”——两三声清脆的石击，带石腔的共鸣
export function stone(level = 0.32) {
  if (!ok()) return;
  const hits = [0, 0.16, 0.42];
  hits.forEach((dt, i) => {
    const t = ctx.currentTime + dt, lv = level * (i === 2 ? 0.7 : 1);
    const n = noise(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'bandpass'; hp.frequency.value = 2400 + Math.random() * 600; hp.Q.value = 1.2;
    g.gain.setValueAtTime(lv, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(hp).connect(g); out(g, 1, 0.5); n.start(t, Math.random()); n.stop(t + 0.08);
    for (const [f, d, a] of [[820, 0.28, 0.5], [1370, 0.18, 0.3], [2110, 0.1, 0.18]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.value = f * (0.96 + Math.random() * 0.08);
      og.gain.setValueAtTime(lv * a, t); og.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(og); out(og, 1, 0.6); o.start(t); o.stop(t + d + 0.02);
    }
  });
}

// 应龙：远雷滚过，随后一阵雨声（旱而为应龙之状，乃得大雨）
export function thunder(level = 0.5) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const n = noise(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(140, t + 2.2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.08);
  for (let i = 1; i < 10; i++) g.gain.setValueAtTime(level * (0.35 + Math.random() * 0.65) * (1 - i / 11), t + i * 0.2);
  g.gain.linearRampToValueAtTime(0, t + 2.4);
  n.connect(lp).connect(g); out(g, 1, 0.7); n.start(t); n.stop(t + 2.5);
  const r = noise(), hp = ctx.createBiquadFilter(), rg = ctx.createGain();
  hp.type = 'highpass'; hp.frequency.value = 3500;
  rg.gain.setValueAtTime(0, t + 0.6); rg.gain.linearRampToValueAtTime(level * 0.12, t + 1.6); rg.gain.linearRampToValueAtTime(0, t + 4.2);
  r.connect(hp).connect(rg); out(rg, 1, 0.3); r.start(t + 0.6, Math.random()); r.stop(t + 4.3);
}

// 爱丽丝：怀表滴答，然后一声小钟（白兔：“我要迟到了！”）
export function clock(level = 0.3) {
  if (!ok()) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 6; i++) {
    const t = t0 + i * 0.32, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = i % 2 ? 3200 : 4200; bp.Q.value = 6;
    g.gain.setValueAtTime(level * 0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    n.connect(bp).connect(g); out(g, 1, 0.25); n.start(t, Math.random()); n.stop(t + 0.05);
  }
  const t = t0 + 2.0;
  for (const [f, a, d] of [[1046.5, 1, 2.4], [2093, 0.35, 1.2], [3140, 0.12, 0.6]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * 0.5 * a, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    o.connect(g); out(g, 1, 0.6); o.start(t); o.stop(t + d + 0.05);
  }
}

// 掉进兔子洞：长长的下坠风声 + 八音盒琶音
export function fall(level = 0.35) {
  if (!ok()) return;
  const t = ctx.currentTime, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(1600, t); bp.frequency.exponentialRampToValueAtTime(260, t + 3.2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.6); g.gain.linearRampToValueAtTime(0, t + 3.4);
  n.connect(bp).connect(g); out(g, 0.8, 0.6); n.start(t); n.stop(t + 3.5);
  const notes = [1318.5, 1568, 1975.5, 2637, 1975.5, 1568, 1318.5, 987.8]; // E6 G6 B6 E7 …
  notes.forEach((f, i) => {
    const tt = t + 0.5 + i * 0.22, o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    og.gain.setValueAtTime(0, tt); og.gain.linearRampToValueAtTime(level * 0.28, tt + 0.004); og.gain.exponentialRampToValueAtTime(0.0005, tt + 0.9);
    o.connect(og); out(og, 1, 0.7); o.start(tt); o.stop(tt + 1);
  });
}

// 小王子：“满天的星星都会像五亿个小铃铛一样笑”
export function bells(level = 0.26) {
  if (!ok()) return;
  const t0 = ctx.currentTime, scale = [1568, 1760, 2093, 2349, 2637, 3136, 3520];
  for (let i = 0; i < 9; i++) {
    const t = t0 + i * 0.09 + Math.random() * 0.05, f = scale[Math.floor(Math.random() * scale.length)];
    for (const [m, a, d] of [[1, 1, 1.4], [2.76, 0.25, 0.5], [5.4, 0.08, 0.25]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * m;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * 0.35 * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0004, t + d);
      o.connect(g); out(g, 0.8, 0.8); o.start(t); o.stop(t + d + 0.05);
    }
  }
}
// 狐狸：一声短促的轻叫
export function yip(level = 0.18) {
  if (!ok()) return;
  [0, 0.28].forEach((dt, i) => {
    const t = ctx.currentTime + dt, o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = (i ? 720 : 820) + Math.random() * 40;
    o.frequency.setValueAtTime(f0 * 0.8, t); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.05); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.2);
    const sum = ctx.createGain();
    for (const [f, q, gn] of [[1100, 6, 1], [2300, 8, 0.5]]) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; const g = ctx.createGain(); g.gain.value = gn; o.connect(bp).connect(g).connect(sum); }
    const env = ctx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(level * (i ? 0.7 : 1), t + 0.02); env.gain.exponentialRampToValueAtTime(0.0008, t + 0.24);
    sum.connect(env); out(env, 0.7, 0.5); o.start(t); o.stop(t + 0.26);
  });
}

// 一阵雨：沙沙声，慢慢起、慢慢收
export function rain(dur = 7, level = 0.16) {
  if (!ok()) return;
  const t = ctx.currentTime, n = noise(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  hp.type = 'highpass'; hp.frequency.value = 900; lp.type = 'lowpass'; lp.frequency.value = 7000;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 1.2); g.gain.setValueAtTime(level, t + dur - 1.6); g.gain.linearRampToValueAtTime(0, t + dur);
  n.connect(hp).connect(lp).connect(g); out(g, 1, 0.3); n.start(t); n.stop(t + dur + 0.1);
  for (let i = 0; i < dur * 9; i++) { // 雨点打在纸上
    const tt = t + 0.6 + Math.random() * (dur - 1.4), o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = 1800 + Math.random() * 2400; og.gain.setValueAtTime(level * 0.25, tt); og.gain.exponentialRampToValueAtTime(0.0003, tt + 0.03);
    o.connect(og); out(og, 1, 0.2); o.start(tt); o.stop(tt + 0.04);
  }
}
function gliss(f0, f1, level) {
  const t = ctx.currentTime;
  for (let i = 0; i < 10; i++) {
    const tt = t + i * 0.09, f = f0 * Math.pow(f1 / f0, i / 9), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(level, tt + 0.005); g.gain.exponentialRampToValueAtTime(0.0004, tt + 0.6);
    o.connect(g); out(g, 0.8, 0.7); o.start(tt); o.stop(tt + 0.65);
  }
}
// 喝我：叮叮往下走；吃我：往上走
export function shrink() { if (ok()) gliss(2400, 600, 0.12); }
export function grow() { if (ok()) gliss(500, 2200, 0.12); }

// 风吹麦浪：起伏的风声
export function wind(dur = 7, level = 0.3) {
  if (!ok()) return;
  const t = ctx.currentTime, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(400, t);
  for (let i = 1; i <= 8; i++) bp.frequency.linearRampToValueAtTime(380 + Math.random() * 700, t + dur * i / 8);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 1.0);
  for (let i = 2; i < 7; i++) g.gain.linearRampToValueAtTime(level * (0.6 + Math.random() * 0.4), t + dur * i / 8);
  g.gain.linearRampToValueAtTime(0, t + dur);
  n.connect(bp).connect(g); out(g, 1, 0.4); n.start(t); n.stop(t + dur + 0.1);
}

// 贴贴：软软的“啵”
export function boop(level = 0.22) {
  if (!ok()) return;
  [0, 0.12].forEach((dt, i) => {
    const t = ctx.currentTime + dt, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(i ? 880 : 660, t); o.frequency.exponentialRampToValueAtTime(i ? 1320 : 990, t + 0.08);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    o.connect(g); out(g, 1, 0.4); o.start(t); o.stop(t + 0.32);
  });
}
// 击掌：清脆的一拍
export function clap(level = 0.5) {
  if (!ok()) return;
  const t = ctx.currentTime, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.9;
  g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  n.connect(bp).connect(g); out(g, 1, 0.4); n.start(t, Math.random()); n.stop(t + 0.14);
  bells(0.12);
}
// 快门
export function shutter(level = 0.35) {
  if (!ok()) return;
  [0, 0.07].forEach((dt) => {
    const t = ctx.currentTime + dt, n = noise(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(hp).connect(g); out(g, 1, 0.1); n.start(t, Math.random()); n.stop(t + 0.06);
  });
}

// 按住才下的雨：返回 { stop }，松手时淡出
export function rainStart(level = 0.18) {
  if (!ok()) return { stop() {} };
  const t = ctx.currentTime, n = noise(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  hp.type = 'highpass'; hp.frequency.value = 900; lp.type = 'lowpass'; lp.frequency.value = 7000;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.9);
  n.connect(hp).connect(lp).connect(g); out(g, 1, 0.3); n.start(t);
  let alive = true;
  const drops = setInterval(() => { // 雨点打在纸上
    if (!alive) return;
    for (let i = 0; i < 4; i++) {
      const tt = ctx.currentTime + Math.random() * 0.25, o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.value = 1800 + Math.random() * 2400; og.gain.setValueAtTime(level * 0.25, tt); og.gain.exponentialRampToValueAtTime(0.0003, tt + 0.03);
      o.connect(og); out(og, 1, 0.2); o.start(tt); o.stop(tt + 0.04);
    }
  }, 250);
  return { stop() { alive = false; clearInterval(drops); const t1 = ctx.currentTime; g.gain.cancelScheduledValues(t1); g.gain.setValueAtTime(g.gain.value, t1); g.gain.linearRampToValueAtTime(0, t1 + 1.2); n.stop(t1 + 1.3); } };
}
