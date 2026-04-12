import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { InMemoryHiringStore } from '../../services/candidate-chatbot/src/store.js';
import { FakeTelegramClient } from '../../services/candidate-chatbot/src/fake-telegram-client.js';
import { NotificationDispatcher } from '../../services/candidate-chatbot/src/notification-dispatcher.js';
import { createCandidateChatbot } from '../../services/candidate-chatbot/src/handlers.js';
import { FakeLlmAdapter } from '../../services/candidate-chatbot/src/fake-llm-adapter.js';

const seed6 = JSON.parse(readFileSync(
  new URL('../fixtures/iteration-6-seed.json', import.meta.url), 'utf8'
));

test('tg: step_completed fires notification to subscribed recruiter with tg_chat_id', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chatId, 123456789);
});

test('tg: step_completed does NOT fire notification when no subscriptions exist', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  // No subscriptions added
  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 0);
});

test('tg: step_completed does NOT fire for wrong step_index subscription', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  // Subscribed to step_index 2 but event is step_index 1
  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   2,
    event_type:   'step_completed'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',   // step_index = 1
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 0);
});

test('tg: multiple subscribers all receive notifications', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({ recruiter_id: 'rec-tg-001', job_id: 'job-tg-dev', step_index: 1, event_type: 'step_completed' });
  store.addSubscription({ recruiter_id: 'rec-tg-002', job_id: 'job-tg-dev', step_index: 1, event_type: 'step_completed' });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 2);
  const chatIds = tg.sent.map(s => s.chatId);
  assert.ok(chatIds.includes(123456789));
  assert.ok(chatIds.includes(987654321));
});

test('tg: recruiter with null tg_chat_id is skipped gracefully', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  // Recruiter without tg_chat_id is subscribed
  store.addSubscription({
    recruiter_id: 'rec-tg-no-chat',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  // Should not throw
  await assert.doesNotReject(() => dispatcher.dispatch([event]));
  assert.equal(tg.sent.length, 0);
});

test('tg: run_rejected fires notification for run_rejected subscription', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'run_rejected'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'run_rejected',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 1);
});

test('tg: step_completed subscription does NOT fire on run_rejected event', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'   // subscribed only to completions
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'run_rejected',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 0);
});

test('tg: removing subscription prevents future notifications', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'
  });

  // First fire → notification arrives
  const event1 = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });
  await dispatcher.dispatch([event1]);
  assert.equal(tg.sent.length, 1);

  // Remove subscription
  store.removeSubscription('rec-tg-001', 'job-tg-dev', 1, 'step_completed');
  tg.clear();

  // Second fire → no notification
  const event2 = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });
  await dispatcher.dispatch([event2]);
  assert.equal(tg.sent.length, 0);
});

test('tg: notification message contains job title and candidate name', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 1);
  assert.ok(tg.sent[0].message.includes('TG Test Developer'), 'message should include job title');
  assert.ok(tg.sent[0].message.includes('Tg Candidate'),     'message should include candidate name');
});

test('tg: existing postWebhookMessage works without notificationDispatcher (no crash)', async () => {
  const store = new InMemoryHiringStore(seed6);
  // notificationDispatcher not passed
  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });

  const res = await app.postWebhookMessage({
    conversation_id:    'conv-tg-001',
    text:               'Я разработчик с 5 годами опыта',
    channel:            'test',
    channel_message_id: 'msg-001',
    occurred_at:        new Date().toISOString()
  });

  // Completes normally
  assert.ok([200, 202].includes(res.status));
});
