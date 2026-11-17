import assert from 'node:assert/strict';
import test from 'node:test';
import { clientLogProblems, consoleProblems, stdoutProblems, subscriberProblems, tracingProblems } from './check-logging.mjs';

const messages = (source) => tracingProblems(source).map((problem) => problem.message);

test('accepts a conforming event', () => {
  assert.deepEqual(
    tracingProblems('tracing::info!(vehicle_id = %id, retry_seconds = 5, "worker started");'),
    [],
  );
});

test('flags punctuation, capitalisation, and interpolation in messages', () => {
  assert.equal(messages('warn!("Worker stopped.");').length, 2);
  assert.match(messages('info!("started {id}");')[0], /interpolates/);
});

test('allows literal braces and acronyms', () => {
  assert.deepEqual(tracingProblems('debug!("SSO login redirect {{ok}}");'), []);
});

test('flags err/e aliases and sensitive fields, including multi-line calls', () => {
  const source = `tracing::error!(
    vehicle_id = %id,
    err = %e,
    email = %user.email,
    "refresh failed"
  );`;
  const found = messages(source);
  assert.ok(found.some((message) => message.includes('`error`')));
  assert.ok(found.some((message) => message.includes('sensitive')));
});

test('ignores values that merely contain a field-like substring', () => {
  assert.deepEqual(tracingProblems('info!(error = %err, "refresh failed");'), []);
  assert.deepEqual(tracingProblems('info!(token_present = true, "login checked");'), []);
});

test('reports stdout in library code but not after cfg(test)', () => {
  assert.equal(stdoutProblems('fn f() { println!("hi"); }').length, 1);
  assert.equal(stdoutProblems('fn f() {}\n#[cfg(test)]\nmod t { fn g() { println!("hi"); } }').length, 0);
});

test('reports console calls', () => {
  assert.equal(consoleProblems('console.log("x"); console.error("y");').length, 2);
  assert.equal(consoleProblems('reportClientError(error);').length, 0);
});

test('reports a private tracing subscriber', () => {
  assert.equal(subscriberProblems('tracing_subscriber::fmt::init();').length, 1);
  assert.equal(subscriberProblems('riviamigo_api::logging::init();').length, 0);
});

test('flags dotted event codes used as messages', () => {
  assert.match(messages('debug!(error = %e, "places.cache_write_failed");')[0], /event code/);
  assert.deepEqual(tracingProblems('debug!(error = %e, "places cache write failed");'), []);
});

test('checks clientLog message style', () => {
  assert.deepEqual(clientLogProblems("clientLog.info('auth', 'signed in', { user_id });"), []);
  assert.equal(clientLogProblems("clientLog.warn('auth', 'Signed in.');").length, 2);
  assert.equal(clientLogProblems("clientLog.debug('Live Socket', 'open');").length, 1);
  assert.equal(clientLogProblems("clientLog.info('auth', 'user ${id}');").length, 1);
});
