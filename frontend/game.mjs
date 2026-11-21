export const ACCENTS = [
  { id: 'us', name: 'United States', code: 'US', place: 'สหรัฐอเมริกา' },
  { id: 'england', name: 'England', code: 'EN', place: 'อังกฤษ' },
  { id: 'indian', name: 'India', code: 'IN', place: 'อินเดีย' },
  { id: 'australia', name: 'Australia', code: 'AU', place: 'ออสเตรเลีย' },
  { id: 'canada', name: 'Canada', code: 'CA', place: 'แคนาดา' },
  { id: 'scotland', name: 'Scotland', code: 'SC', place: 'สกอตแลนด์' },
  { id: 'ireland', name: 'Ireland', code: 'IE', place: 'ไอร์แลนด์' },
  { id: 'newzealand', name: 'New Zealand', code: 'NZ', place: 'นิวซีแลนด์' },
  { id: 'african', name: 'Africa', code: 'AF', place: 'กลุ่ม Africa ในชุดข้อมูล' },
];

export const LESSONS = [
  { title: 'แวะทักทาย', scene: 'เริ่มต้นบทสนทนา', text: 'Hello! It’s lovely to see you again.', focus: 'พูดเป็นวลี', tip: 'แบ่งเป็น “Hello!” แล้วพูดส่วนที่เหลือต่อเนื่อง ลองฟังจังหวะของตัวเองหลังอัด' },
  { title: 'สั่งแก้วโปรด', scene: 'ที่ร้านกาแฟ', text: 'Could I have a cup of coffee, please?', focus: 'เน้นคำสำคัญ', tip: 'ลองเน้น “cup” และ “coffee” ให้ชัด แล้วปล่อยคำเชื่อมให้เบาลงโดยไม่ต้องรีบ' },
  { title: 'ถามทางสักนิด', scene: 'ระหว่างเดินเล่น', text: 'Is the train station near the park?', focus: 'จังหวะคำถาม', tip: 'ลองพูดคำถามด้วยจังหวะที่เป็นธรรมชาติ แล้วฟังว่าคำว่า “train station” และ “park” ชัดหรือยัง' },
  { title: 'เล่าเรื่องวันนี้', scene: 'คุยกับเพื่อน', text: 'I thought the weather was wonderful today.', focus: 'เชื่อมคำเป็นประโยค', tip: 'อ่านช้า ๆ ก่อนหนึ่งรอบ แล้วลองเชื่อมคำโดยไม่เว้นทุกคำ รักษาเสียงให้สบาย' },
  { title: 'นัดครั้งต่อไป', scene: 'ก่อนแยกย้าย', text: 'Let’s meet here again tomorrow morning.', focus: 'พูดให้ลื่นไหล', tip: 'นึกว่ากำลังนัดเพื่อนจริง ๆ แล้วฟังเสียงตัวเองอีกครั้ง เลือกหนึ่งจุดที่อยากลองใหม่' },
];

export const STORAGE_KEY = 'accent-quest-v2';
export const XP_PER_LESSON = 20;
export function newSession(target = 'us') {
  return { version: 2, target, completed: 0, current: 0, finished: false };
}
export function restoreSession(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || s.version !== 2 || !ACCENTS.some(a => a.id === s.target)
      || !Number.isInteger(s.completed) || s.completed < 0 || s.completed > LESSONS.length
      || !Number.isInteger(s.current) || s.current < 0 || s.current >= LESSONS.length
      || s.current > s.completed || s.completed > s.current + 1
      || typeof s.finished !== 'boolean' || (s.finished && s.completed !== LESSONS.length)) return newSession();
    return { version: 2, target: s.target, completed: s.completed, current: s.current, finished: s.finished };
  } catch { return newSession(); }
}
export function evaluateAttempt(s, probs) {
  const rows = validateProbabilities(probs);
  // A tie is not a unique top prediction, even if sorting puts the target first.
  const passed = rows[0].id === s.target && rows[0].p > rows[1].p;
  const earned = passed && s.completed <= s.current;
  return {
    rows, passed, earned,
    session: earned ? { ...s, completed: s.current + 1 } : s,
  };
}
export function advance(s) {
  if (s.completed <= s.current) return s;
  return s.current === LESSONS.length - 1 ? { ...s, finished: true } : { ...s, current: s.current + 1 };
}
export function validateProbabilities(probs) {
  if (!probs || typeof probs !== 'object') throw new Error('ผลจากโมเดลไม่ครบ ลองอัดใหม่อีกครั้ง');
  const rows = ACCENTS.map(a => {
    const p = probs[a.id];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) throw new Error('ผลจากโมเดลไม่ถูกต้อง ลองใหม่อีกครั้ง');
    return { ...a, p };
  });
  if (Math.abs(rows.reduce((sum, a) => sum + a.p, 0) - 1) > .02) throw new Error('ผลจากโมเดลไม่ถูกต้อง ลองใหม่อีกครั้ง');
  return rows.sort((a, b) => b.p - a.p);
}
