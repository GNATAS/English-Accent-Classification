import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCENTS, LESSONS, XP_PER_LESSON, newSession, restoreSession, evaluateAttempt, advance, validateProbabilities } from './game.mjs';

const prediction = target => Object.fromEntries(ACCENTS.map(a => [a.id, a.id === target ? .6 : .05]));

test('all nine targets pass only when the target is the unique top prediction', () => {
  for (const { id } of ACCENTS) {
    const s = newSession(id);
    assert.deepEqual(restoreSession(JSON.stringify(s)), s);
    const result = evaluateAttempt(s, prediction(id));
    assert.equal(result.passed, true);
    assert.equal(result.earned, true);
    assert.equal(result.session.completed * XP_PER_LESSON, 20);
    for (const other of ACCENTS.filter(a => a.id !== id)) {
      const failed = evaluateAttempt(s, prediction(other.id));
      assert.equal(failed.passed, false);
      assert.equal(failed.earned, false);
      assert.deepEqual(failed.session, s);
      assert.deepEqual(advance(failed.session), s);
    }
  }
});
test('retrying after a failure can pass; repeated passes award no extra XP', () => {
  const failed = evaluateAttempt(newSession(), prediction('england'));
  const first = evaluateAttempt(failed.session, prediction('us'));
  assert.equal(first.session.completed * XP_PER_LESSON, 20);
  const retry = evaluateAttempt(first.session, prediction('us'));
  assert.equal(retry.passed, true);
  assert.equal(retry.earned, false);
  assert.deepEqual(retry.session, first.session);
  // A failed optional retry does not erase an already earned pass.
  assert.deepEqual(evaluateAttempt(first.session, prediction('england')).session, first.session);
});
test('tied top predictions do not pass even when the target sorts first', () => {
  const tied = { ...prediction('us'), us: .325, england: .325 };
  for (const target of ['us', 'england']) {
    const s = newSession(target);
    const result = evaluateAttempt(s, tied);
    assert.equal(result.passed, false);
    assert.equal(result.earned, false);
    assert.deepEqual(result.session, s);
  }
});
test('cannot advance without a match; all five matches finish at 100 XP', () => {
  let s = newSession();
  assert.deepEqual(advance(s), s);
  for (let i = 0; i < LESSONS.length; i++) {
    assert.equal(s.current, i);
    assert.equal(s.finished, false);
    const failed = evaluateAttempt(s, prediction('canada'));
    assert.equal(failed.earned, false);
    assert.deepEqual(advance(failed.session), s);
    s = evaluateAttempt(s, prediction('us')).session;
    assert.deepEqual(restoreSession(JSON.stringify(s)), s);
    s = advance(s);
    assert.deepEqual(restoreSession(JSON.stringify(s)), s);
  }
  assert.equal(s.finished, true);
  assert.equal(s.completed * XP_PER_LESSON, 100);
});
test('invalid and old participation-only storage is reset', () => {
  const cases = [null, '', '{', 'null', '{}', JSON.stringify({ ...newSession(), target: 'unknown' }),
    JSON.stringify({ ...newSession(), completed: 99 }), JSON.stringify({ ...newSession(), current: -1 }),
    JSON.stringify({ ...newSession(), current: .5 }), JSON.stringify({ ...newSession(), current: 3 }),
    JSON.stringify({ ...newSession(), completed: 3 }), JSON.stringify({ ...newSession(), finished: true }),
    JSON.stringify({ ...newSession(), version: 1, current: 4, completed: 5, finished: true })];
  for (const raw of cases) assert.deepEqual(restoreSession(raw), newSession());
});
test('malformed predictions cannot award XP', () => {
  const probs = prediction('australia');
  assert.equal(validateProbabilities(probs)[0].id, 'australia');
  for (const p of [null, {}, { ...probs, us: '0.05' }, { ...probs, us: NaN },
    { ...probs, us: -1 }, { ...probs, us: 2 }, { ...probs, australia: 0 }]) {
    assert.throws(() => validateProbabilities(p));
    assert.throws(() => evaluateAttempt(newSession(), p));
  }
});
