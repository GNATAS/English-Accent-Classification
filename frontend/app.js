import { ACCENTS, LESSONS, STORAGE_KEY, XP_PER_LESSON, newSession, restoreSession, evaluateAttempt, advance } from './game.mjs';

const $ = id => document.getElementById(id);
const SR = 16000;
let session = newSession();
let phase = 'idle';
let recorder, stream, stopTimer, clockTimer, requestController;
let playbackUrl;
let storageAvailable = true;
try { session = restoreSession(localStorage.getItem(STORAGE_KEY)); } catch { storageAvailable = false; }

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
  catch { storageAvailable = false; }
  $('storageNote').textContent = storageAvailable ? '' : 'เบราว์เซอร์ไม่อนุญาตให้บันทึก เล่นต่อได้แต่ความคืบหน้าอาจหายเมื่อปิดหน้า';
}
function status(message = '', error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function busy() { return ['requesting', 'recording', 'analysing'].includes(phase); }
function controls() {
  const locked = busy();
  $('rec').disabled = phase === 'requesting' || phase === 'analysing';
  $('file').disabled = locked;
  $('uploadLabel').classList.toggle('disabled', locked);
  document.querySelectorAll('.accent').forEach(button => { button.disabled = locked; });
  $('next').disabled = locked || session.completed <= session.current;
  $('rec').classList.toggle('recording', phase === 'recording');
  $('recLabel').textContent = ({ requesting: 'กำลังเปิดไมค์…', recording: 'หยุดและดูผล', analysing: 'กำลังประมวลผล…', result: 'ลองอัดอีกครั้ง' })[phase] || 'เริ่มอัดเสียง';
}
function clearAudio() {
  $('audio').pause();
  $('audio').removeAttribute('src');
  $('audio').load();
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = null;
  $('playback').hidden = true;
}
function clearResult() {
  $('feedback').hidden = true;
  $('probabilities').replaceChildren();
  clearAudio();
  status();
}
function renderProgress() {
  $('xp').textContent = `${session.completed * XP_PER_LESSON} XP`;
  $('route').replaceChildren(...LESSONS.map((lesson, i) => {
    const stop = document.createElement('li');
    const done = i < session.completed;
    const current = i === session.current && !session.finished;
    stop.className = `stop${done ? ' done' : ''}${current ? ' current' : ''}`;
    if (current) stop.setAttribute('aria-current', 'step');
    stop.setAttribute('aria-label', `ด่าน ${i + 1} ${lesson.title}: ${done ? 'ผ่านแล้ว' : current ? 'ด่านปัจจุบัน' : 'ยังไม่เปิด'}`);
    const icon = document.createElement('span');
    icon.className = 'stop-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = done ? '✓' : String(i + 1);
    const label = document.createElement('span');
    label.textContent = lesson.title;
    stop.append(icon, label);
    return stop;
  }));
  $('routeCaption').textContent = session.completed ? `ผ่านแล้ว ${session.completed} จาก 5 ด่าน` : 'ทายตรงเป้าหมาย จึงจะผ่านด่าน';
  $('nextHint').textContent = session.completed > session.current ? 'ผ่านด่านนี้แล้ว ไปต่อได้เมื่อพร้อม' : 'ให้โมเดลทายอันดับ 1 ตรงเป้าหมายเพื่อไปต่อ';
  $('next').firstChild.textContent = session.current === LESSONS.length - 1 ? 'จบรอบนี้ ' : 'ด่านถัดไป ';
  controls();
}
function render() {
  const target = ACCENTS.find(a => a.id === session.target);
  document.querySelectorAll('.accent').forEach(button => {
    const selected = button.dataset.accent === session.target;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  requestAnimationFrame(() => {
    const list = $('accents');
    const selected = list.querySelector('.selected');
    if (selected && list.scrollWidth > list.clientWidth) {
      const buttonRect = selected.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      if (buttonRect.left < listRect.left || buttonRect.right > listRect.right) {
        list.scrollLeft += buttonRect.left - listRect.left;
      }
    }
  });
  const lesson = LESSONS[session.current];
  $('targetName').textContent = target.name;
  $('lessonNumber').textContent = `ด่าน ${session.current + 1} / ${LESSONS.length}`;
  for (const [id, key] of [['lessonTitle', 'title'], ['scene', 'scene'], ['sentence', 'text'], ['focus', 'focus'], ['tip', 'tip']]) $(id).textContent = lesson[key];
  $('exercise').hidden = session.finished;
  $('summary').hidden = !session.finished;
  $('summaryTarget').textContent = `เป้าหมายรอบนี้: ${target.name}`;
  renderProgress();
}
function changeTarget(target) {
  if (busy() || target === session.target) return;
  if ((session.completed || playbackUrl) && !window.confirm('เปลี่ยนสำเนียงจะเริ่มรอบใหม่ และรีเซ็ต XP ของรอบนี้ ต้องการเปลี่ยนไหม?')) return;
  clearResult();
  phase = 'idle';
  session = newSession(target);
  save(); render();
}
for (const accent of ACCENTS) {
  const button = document.createElement('button');
  button.className = 'accent';
  button.dataset.accent = accent.id;
  button.setAttribute('aria-label', `${accent.name} — ${accent.place}`);
  const code = document.createElement('span');
  code.className = 'country-code'; code.textContent = accent.code; code.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'accent-name'; name.lang = 'en'; name.textContent = accent.name;
  const check = document.createElement('span');
  check.className = 'check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
  button.append(code, name, check);
  button.addEventListener('click', () => changeTarget(accent.id));
  $('accents').append(button);
}

// Convert browser audio to mono, 16 kHz WAV for the existing local classifier.
function toWav(samples) {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const write = (offset, text) => [...text].forEach((c, i) => b.setUint8(offset + i, c.charCodeAt(0)));
  write(0, 'RIFF'); b.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVEfmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, SR, true); b.setUint32(28, SR * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
  write(36, 'data'); b.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true));
  return new Blob([b], { type: 'audio/wav' });
}
async function decode(data) {
  if (!window.AudioContext || !window.OfflineAudioContext) throw new Error('เบราว์เซอร์นี้ยังอ่านเสียงไม่ได้ ลอง Chrome, Edge หรือ Firefox รุ่นปัจจุบัน');
  const context = new AudioContext();
  try {
    let audio;
    try { audio = await context.decodeAudioData(data); }
    catch { throw new Error('อ่านไฟล์เสียงไม่ได้ ลองไฟล์ WAV, MP3 หรือ M4A ที่เล่นได้'); }
    if (audio.duration < .5) throw new Error('คลิปสั้นเกินไป ลองพูดอย่างน้อยครึ่งวินาที');
    // Centre-crop long uploads before resampling, rather than rendering the whole file.
    const duration = Math.min(6, audio.duration);
    const offline = new OfflineAudioContext(1, Math.round(duration * SR), SR);
    const source = offline.createBufferSource();
    source.buffer = audio; source.connect(offline.destination);
    source.start(0, Math.max(0, (audio.duration - duration) / 2), duration);
    const samples = (await offline.startRendering()).getChannelData(0);
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    if (Math.sqrt(energy / samples.length) < .002) throw new Error('เสียงเงียบหรือเบาเกินไป ลองขยับเข้าใกล้ไมค์แล้วอัดใหม่');
    return samples;
  } finally { await context.close(); }
}
async function analyse(blob) {
  phase = 'analysing'; controls(); status('กำลังอ่านเสียงและส่งให้โมเดล…');
  let timer;
  try {
    const samples = await decode(await blob.arrayBuffer());
    const wav = toWav(samples);
    playbackUrl = URL.createObjectURL(wav);
    $('audio').src = playbackUrl;
    $('playback').hidden = false;
    requestController = new AbortController();
    timer = setTimeout(() => requestController?.abort(), 60000);
    let response;
    try {
      response = await fetch('/api/predict', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal: requestController.signal });
    } catch (error) {
      throw new Error(error.name === 'AbortError' ? 'โมเดลใช้เวลานานเกินไป ลองใหม่อีกครั้ง' : 'เชื่อมต่อโมเดลไม่ได้ ตรวจว่าเซิร์ฟเวอร์ demo เปิดอยู่ แล้วลองใหม่');
    }
    if (!response.ok) throw new Error(response.status === 422 ? 'โมเดลอ่านเสียงนี้ไม่ได้ ลองพูดให้ชัดขึ้นแล้วอัดใหม่' : `โมเดลตอบกลับผิดพลาด (${response.status}) ลองใหม่อีกครั้ง`);
    let body;
    try { body = await response.json(); } catch { throw new Error('อ่านผลจากโมเดลไม่ได้ ลองใหม่อีกครั้ง'); }
    const attempt = evaluateAttempt(session, body?.probs);
    const { rows, passed, earned } = attempt;
    const target = rows.find(a => a.id === session.target);
    session = attempt.session;
    save();
    $('feedbackTitle').textContent = passed ? 'ผ่านด่าน! โมเดลทายตรงเป้าหมาย' : 'ครั้งนี้ยังไม่ผ่าน ลองอีกครั้ง';
    $('reward').textContent = earned ? '+20 XP จากการผ่านด่าน' : passed ? 'ผ่านแล้ว ไม่เพิ่ม XP ซ้ำ' : 'ครั้งนี้ +0 XP';
    $('predictedName').textContent = rows[0].name;
    $('predictedProbability').textContent = `${(rows[0].p * 100).toFixed(1)}%`;
    const tied = rows[0].p === rows[1].p;
    const explanation = passed ? 'โมเดลทายตรงกับเป้าหมายที่เลือก' : tied ? 'ผลอันดับ 1 เสมอกัน จึงยังไม่นับว่าทายตรงเป้าหมาย' : 'ครั้งนี้โมเดลทายเป็นคนละกลุ่มกับเป้าหมาย';
    $('matchText').textContent = `${explanation} เป้าหมาย ${target.name} มีความน่าจะเป็น ${(target.p * 100).toFixed(1)}% (อันดับ ${rows.indexOf(target) + 1} จาก 9 กลุ่ม)${passed ? '' : ' ลองฟังเสียงตัวเองแล้วอัดใหม่'}`;
    $('probabilities').replaceChildren(...rows.map((row, index) => {
      const tr = document.createElement('tr');
      if (index === 0) tr.classList.add('top-prediction');
      const name = document.createElement('th'); name.scope = 'row';
      const label = document.createElement('span'); label.lang = 'en'; label.textContent = row.name;
      name.append(label);
      if (row.id === target.id) {
        const badge = document.createElement('span'); badge.className = 'target-badge'; badge.textContent = 'เป้าหมาย';
        name.append(badge);
      }
      const value = document.createElement('td'); value.textContent = `${(row.p * 100).toFixed(1)}%`;
      tr.append(name, value);
      return tr;
    }));
    $('feedback').hidden = false;
    phase = 'result';
    status(`โมเดลทาย ${rows[0].name} ที่ ${(rows[0].p * 100).toFixed(1)}% ${earned ? 'ผ่านด่าน รับ 20 XP แล้ว' : passed ? 'ทายตรงเป้าหมาย ด่านนี้รับ XP ไปแล้ว' : 'ยังไม่ผ่าน ครั้งนี้ไม่ได้ XP ลองอัดใหม่'}`);
    renderProgress();
    $('feedbackTitle').focus({ preventScroll: true });
    $('feedback').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  } catch (error) {
    phase = 'error'; status(error.message || 'ประมวลผลเสียงไม่ได้ ลองใหม่อีกครั้ง', true);
  } finally {
    clearTimeout(timer); requestController = null; controls();
  }
}
function stopTracks() {
  clearTimeout(stopTimer); clearInterval(clockTimer);
  stream?.getTracks().forEach(track => track.stop()); stream = null;
}
$('rec').addEventListener('click', async () => {
  if (phase === 'recording') { if (recorder?.state === 'recording') recorder.stop(); return; }
  if (busy()) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    status('อัดเสียงไม่ได้ในเบราว์เซอร์นี้ เปิดผ่าน localhost หรือ HTTPS หรือลองอัปโหลดไฟล์', true); return;
  }
  clearResult(); phase = 'requesting'; controls(); status('อนุญาตไมโครโฟนในเบราว์เซอร์เพื่อเริ่มอัด');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      stopTracks();
      if (phase !== 'recording') return;
      $('recordHint').textContent = 'อ่านให้สบาย ๆ ภายใน 6 วินาที';
      await analyse(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.onerror = () => {
      phase = 'error'; stopTracks(); controls(); status('ไมค์หยุดทำงาน ลองอัดใหม่หรืออัปโหลดไฟล์เสียง', true);
    };
    recorder.start(); phase = 'recording'; controls();
    const started = performance.now();
    status('กำลังอัดเสียง กดหยุดเมื่อพูดจบ หรือระบบจะหยุดใน 6 วินาที');
    clockTimer = setInterval(() => { $('recordHint').textContent = `กำลังอัด ${Math.min(6, (performance.now() - started) / 1000).toFixed(1)} / 6 วินาที`; }, 100);
    stopTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 6000);
  } catch (error) {
    stopTracks(); phase = 'error'; controls();
    status(error.name === 'NotAllowedError' ? 'ไมค์ยังไม่ได้รับอนุญาต เปิดสิทธิ์ในแถบที่อยู่ หรืออัปโหลดไฟล์เสียงแทน' : 'เปิดไมค์ไม่ได้ ตรวจว่าไมค์เชื่อมต่ออยู่ หรืออัปโหลดไฟล์เสียงแทน', true);
  }
});
$('file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || busy()) return;
  clearResult();
  if (file.size > 10 * 1024 * 1024) { status('ไฟล์ใหญ่เกิน 10 MB เลือกคลิปสั้นลงแล้วลองใหม่', true); return; }
  await analyse(file);
});
$('next').addEventListener('click', () => {
  if (busy() || session.completed <= session.current) return;
  session = advance(session); clearResult(); phase = 'idle'; save(); render();
  (session.finished ? $('summaryTitle') : $('mission')).focus();
});
$('restart').addEventListener('click', () => {
  clearResult(); session = newSession(session.target); phase = 'idle'; save(); render(); $('mission').focus();
});
$('helpButton').addEventListener('click', () => {
  $('help').hidden = !$('help').hidden;
  $('helpButton').setAttribute('aria-expanded', String(!$('help').hidden));
});
window.addEventListener('pagehide', () => {
  phase = 'idle';
  if (recorder?.state === 'recording') recorder.stop();
  stopTracks(); requestController?.abort(); clearAudio();
});
save(); render();
if (session.completed && !session.finished) status('กลับมาฝึกต่อได้เลย ความคืบหน้ายังอยู่ แต่เสียงและผลครั้งก่อนไม่ได้ถูกเก็บ');
