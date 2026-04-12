#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const currentDate = new Date().toISOString().slice(0, 10);
const sessionId = "c3835db7-34bc-46a3-93a1-e64f06f0d4a3";
const targetJobIds = [4, 9, 26];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

function getLegacyDbUrl() {
  loadEnvFile(path.resolve(repoRoot, "../recruiting-agent/.env"));
  return process.env.LEGACY_ROUTING_DB_URL
    || process.env.RECRUITER_QUERY_DB_URL
    || process.env.NEON_DATABASE_URL
    || null;
}

function truncate(value, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function normalizeMultiline(value) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join("\n");
}

function parsePipelineGoals(pipelineTemplate) {
  const text = normalizeMultiline(pipelineTemplate);
  const parts = text.split(/^## /m).map((part) => part.trim()).filter(Boolean);
  return parts.map((part) => {
    const [header, ...rest] = part.split("\n");
    const bullets = rest
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^-+\s*/, "").trim());
    return { header, bullets };
  });
}

function buildHomeworkAugmentedGoals(job, goals) {
  if (job.closing_type !== "homework") return goals;

  const examples = getHomeworkStepExamples(job.id);
  if (!examples) return goals;

  return [...goals, {
    header: "Goal X: Homework Submission Detection [projected V2 completion]",
    bullets: examples.map((step) => `[pending] ${step.step}: ${step.prompt_or_script} ${step.detection_rule ? `Detection: ${step.detection_rule}` : ""}`.trim())
  }];
}

function getHomeworkStepExamples(jobId) {
  if (jobId === 4) {
    return [
      {
        step: "homework_offer",
        purpose: "Предложить тестовое мягко и с выбором.",
        prompt_or_script: "Следующий шаг у нас — короткое тестовое задание на план A/B теста и два варианта главного слайда. Если вам ок такой формат, я пришлю детали.",
        detection_rule: "Кандидат отвечает согласием или задает вопрос по формату/сроку."
      },
      {
        step: "homework_send",
        purpose: "Отправить ссылку, объем и дедлайн.",
        prompt_or_script: "Тогда отправляю. Вот ссылка на тестовое задание и материалы: <google-doc-link>. Обычно это занимает 2-4 часа, дедлайн 1-3 дня. Если нужен другой срок, просто напишите.",
        detection_rule: "В сообщении есть ссылка, ожидаемый deliverable и дедлайн."
      },
      {
        step: "homework_submission_detection",
        purpose: "Понять, что кандидат уже прислал решение.",
        prompt_or_script: "Internal step: если в сообщении кандидата есть Google Docs / Drive / Figma / любой URL и/или текст вида «готово», «отправляю решение», «выполнил тестовое», не задаем повторно вопрос про готовность.",
        detection_rule: "Считать homework submitted по ссылке, файлу или явному completion-text."
      },
      {
        step: "homework_ack",
        purpose: "Подтвердить получение и закрыть этап.",
        prompt_or_script: "Получил, спасибо. Передам коллегам на просмотр и вернусь с обратной связью.",
        detection_rule: "Отправлять сразу после submission detection."
      },
      {
        step: "notify_manager",
        purpose: "Внутренне поднять событие о сдаче домашки.",
        prompt_or_script: "ACTION: notify_manager",
        detection_rule: "Только после candidate-facing acknowledgement."
      }
    ];
  }

  if (jobId === 9) {
    return [
      {
        step: "homework_offer",
        purpose: "Подвести к практическому кейсу после screening / AI interview.",
        prompt_or_script: "Следующим шагом у нас небольшое практическое задание по фабрике, 1688 и сообщению поставщику. Если вам ок, я сразу пришлю ссылку.",
        detection_rule: "Кандидат соглашается или задает вопрос по сроку/формату."
      },
      {
        step: "homework_send",
        purpose: "Дать тестовое с понятным scope.",
        prompt_or_script: "Тогда отправляю практическое задание: <google-doc-link>. Нужно выбрать товар, найти фабрику на 1688, прикинуть экономику и написать сообщение фабрике на китайском. Обычно это занимает 1-1.5 часа, дедлайн 3 рабочих дня.",
        detection_rule: "В сообщении есть ссылка, scope задания и дедлайн."
      },
      {
        step: "homework_submission_detection",
        purpose: "Определить сдачу по сообщению кандидата.",
        prompt_or_script: "Internal step: если кандидат прислал ссылку, файл или пишет «сделал(а) / отправляю решение / прикрепляю ответ», считаем homework submitted.",
        detection_rule: "Ссылка на документ или явный completion-text."
      },
      {
        step: "homework_ack",
        purpose: "Нормально закрыть этап после сдачи.",
        prompt_or_script: "Получил, спасибо. Передам команде и вернусь с обратной связью.",
        detection_rule: "Отправлять сразу после submission detection."
      },
      {
        step: "notify_manager",
        purpose: "Сигнализировать внутрь команды о новой сдаче.",
        prompt_or_script: "ACTION: notify_manager",
        detection_rule: "Только после candidate-facing acknowledgement."
      }
    ];
  }

  return null;
}

function renderHomeworkExamplesTable(jobId) {
  const rows = getHomeworkStepExamples(jobId) ?? [];
  return [
    "| step | purpose | prompt / script | detection_rule |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.step} | ${row.purpose} | ${row.prompt_or_script.replace(/\|/g, "\\|")} | ${row.detection_rule.replace(/\|/g, "\\|")} |`)
  ].join("\n");
}

function classifyCandidate(candidate) {
  const status = String(candidate.status ?? "");
  const summary = String(candidate.candidate_summary ?? "");
  const resumeScore = Number(candidate.must_haves_from_resume ?? 0);
  const hasPositiveSummarySignal = /confirmed|подтвержден|✅|\+\s*да|\+\s*native|\+\s*business/i.test(summary);
  const hasNegativeSummarySignal = /❌|не подходит|no match/i.test(summary);
  const advancedStatuses = new Set([
    "SCREENING_DONE",
    "INTERVIEW_OFFERED",
    "AI_INTERVIEW_SENT",
    "INTERVIEW_PASSED",
    "HOMEWORK_SENT",
    "HOMEWORK_SUBMITTED",
    "PRESENTING_TO_CLIENT"
  ]);

  if (resumeScore <= 0 && hasPositiveSummarySignal) return "hidden_from_resume";
  if (/NO_RESPONSE|went_dark/i.test(status)) return "weak_or_risky";
  if (hasNegativeSummarySignal) return "weak_or_risky";
  if (resumeScore >= 1 && advancedStatuses.has(status)) return "strong";
  if (resumeScore >= 1) return "strong";
  return "medium";
}

function chooseEvaluationCandidates(candidates) {
  const byBucket = new Map();
  for (const candidate of candidates) {
    const bucket = classifyCandidate(candidate);
    candidate.bucket = bucket;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(candidate);
  }

  const plan = [
    ["strong", 2],
    ["medium", 2],
    ["hidden_from_resume", 1],
    ["weak_or_risky", 1]
  ];

  const chosen = [];
  const chosenIds = new Set();

  for (const [bucket, count] of plan) {
    const pool = byBucket.get(bucket) ?? [];
    for (const candidate of pool.slice(0, count)) {
      chosen.push(candidate);
      chosenIds.add(candidate.id);
    }
  }

  for (const candidate of candidates) {
    if (chosen.length >= 6) break;
    if (chosenIds.has(candidate.id)) continue;
    chosen.push(candidate);
    chosenIds.add(candidate.id);
  }

  return chosen.slice(0, 6);
}

async function fetchSessionCompare() {
  try {
    const res = await fetch(`http://localhost:3000/api/sessions/${sessionId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function extractLegacyDialog(messages, candidateId) {
  return messages
    .filter((row) => row.candidate_id === candidateId)
    .slice(0, 6)
    .map((row) => ({
      speaker: row.direction === "incoming" ? "candidate" : row.direction === "outgoing" ? "recruiter" : "system",
      body: row.body
    }));
}

function generateProjectedDialogue(job, candidate) {
  const name = candidate.name.split(" ")[0];
  const bucket = candidate.bucket;

  if (job.id === 26) {
    if (bucket === "weak_or_risky") {
      return [
        ["recruiter", `${name}, добрый день. Подскажите, был ли у вас реальный опыт B2B-продаж с корпоративными клиентами и холодными звонками?`],
        ["candidate", "Скорее нет, у меня больше общий клиентский сервис и немного лидогенерации. Хотелось бы попробовать продажи полноценно."],
        ["recruiter", "Понял. Для этой роли нужен уже подтвержденный опыт B2B и уверенная работа с холодным выходом на ЛПР. По этой вакансии дальше не пойдем, но профиль могу сохранить на более мягкие роли."]
      ];
    }
    if (bucket === "hidden_from_resume") {
      return [
        ["recruiter", `${name}, по резюме вижу продажи, но не все детали очевидны. Подскажите одним сообщением: был ли B2B, были ли холодные звонки и комфортен ли удаленный формат с KPI + небольшим фиксированным стартом?`],
        ["candidate", "Да, B2B был. Я продавал IT-продукты корпоративным клиентам, сам выходил на ЛПР через холодные звонки и переписку. Удаленка ок, если экономика прозрачная."],
        ["recruiter", "Тогда коротко про условия: на неделю даем около 300 контактов Сколково, задача найти ЛПР и передать заинтересованных Михаилу. KPI: Zoom/офлайн-встреча 4000 ₽, Telegram ЛПР с диалогом 5000 ₽, без диалога 1000 ₽. Стартовая неделя с фиксированными 10 000 ₽ в любом случае."],
        ["candidate", "Такой формат понятен. Если будет скрипт и телефония, мне интересно."],
        ["recruiter", "Да, телефония и таблицы даем. Тогда следующий шаг такой: напишите руководителю в Telegram @kobzevvv, он расскажет детали запуска."]
      ];
    }
    if (bucket === "strong") {
      return [
        ["recruiter", `${name}, резюме выглядит релевантно. Чтобы не дублировать очевидное, уточню только два момента: какой у вас типичный цикл B2B-сделки и как вы обычно выходите на ЛПР?`],
        ["candidate", "Цикл от первой коммуникации до оплаты обычно 2-6 недель. Выхожу через холодные звонки, LinkedIn, Telegram и рекомендации, потом перевожу в Zoom."],
        ["recruiter", "Ок, это совпадает с задачей. У нас проект Сколково: плотный outbound по базе, поиск ЛПР и передача прогретых лидов. Если KPI-модель подходит, дальше имеет смысл быстро созвониться с руководителем."],
        ["candidate", "Да, подходит. Готов обсудить подробнее."],
        ["recruiter", "Тогда сразу пишите @kobzevvv в Telegram — так будет быстрее всего."]
      ];
    }
    return [
      ["recruiter", `${name}, вижу общий sales background. Уточните, пожалуйста: были ли именно B2B-продажи, холодные звонки и работа с корпоративными клиентами?`],
      ["candidate", "B2B был частично, холодные звонки тоже, но не на 100% рабочего времени. С корпоративными клиентами работал."],
      ["recruiter", "Понял. Тогда кратко расскажу формат и попрошу оценить, насколько это вам подходит по нагрузке и KPI."],
      ["recruiter", "На старте это активный outbound по базе Сколково, около 300 контактов в неделю, основной фокус на вывод в Zoom и Telegram-диалог с ЛПР."],
      ["candidate", "Если будет понятная система и адекватный объем, звучит рабоче."],
      ["recruiter", "Тогда можно двигаться дальше и передавать вас на прямой контакт с руководителем."]
    ];
  }

  if (job.id === 9) {
    if (bucket === "weak_or_risky") {
      return [
        ["recruiter", `${name}, уточню ключевые вещи: есть ли ваш WeChat, опыт работы с 1688 и деловая переписка с китайскими фабриками?`],
        ["candidate", "С фабриками общалась, но китайский не знаю и WeChat не веду постоянно. 1688 открывала, но не работала системно."],
        ["recruiter", "Понял. Для этой роли это критично уже на входе, поэтому здесь будет слишком большой разрыв. Остановлю процесс на этом этапе."]
      ];
    }
    if (bucket === "hidden_from_resume") {
      return [
        ["recruiter", `${name}, по резюме не все видно, поэтому коротко соберу missing pieces: уровень китайского, WeChat, 1688, товарные категории и был ли опыт переговоров по браку/срокам.`],
        ["candidate", "Китайский intermediate, WeChat есть, 1688 использовала. Работала по одежде и спортивным товарам, обсуждала сроки и претензии по качеству с фабриками."],
        ["recruiter", "Отлично. Тогда по сути роль такая: удаленно берем на себя весь контур коммуникации с китайскими фабриками для бренда детской одежды на WB, собственники хотят снять это с себя."],
        ["candidate", "Мне это близко. Если дальше будет практическое, я готова."],
        ["recruiter", "Да, после короткого Q&A дадим небольшой практический кейс по поиску фабрики и сообщению поставщику. Если вам ок, я сразу пришлю ссылку."],
        ["candidate", "Да, присылайте."],
        ["recruiter", "Тогда отправляю практическое задание: https://docs.google.com/document/d/example-china-test/edit. На выполнение обычно нужно 1-1.5 часа, дедлайн 3 рабочих дня. Если понадобится запас по времени, просто напишите."],
        ["candidate", "Сделала и отправляю решение: https://docs.google.com/document/d/example-china-solution/edit. Внутри расчет и текст сообщения фабрике на китайском."],
        ["recruiter", "Получил, спасибо. Передам команде и вернусь с обратной связью."]
      ];
    }
    if (bucket === "strong") {
      return [
        ["recruiter", `${name}, резюме уже дает сильный сигнал. Чтобы не повторяться, уточню только детали: какие категории вели, были ли отсрочки/условия оплаты и как решали спор по качеству или срокам?`],
        ["candidate", "Категории были электроника и оборудование. По оплате вела переговоры, отсрочки обсуждали. При проблемах по качеству фиксировали фото/видео, договаривались о переработке или компенсации."],
        ["recruiter", "Хорошо. Тогда следующий шаг у нас либо короткое AI-интервью на китайском, либо сразу практическое, если вам так удобнее."],
        ["candidate", "Могу пройти AI-интервью, потом практическое."],
        ["recruiter", "Отлично. Если вам удобно, я сейчас пришлю ссылку на AI-интервью, а после него сразу перейдем к практическому."],
        ["candidate", "Да, давайте."],
        ["recruiter", "Отправляю ссылку на AI-интервью. Когда закончите, напишите, и я пришлю практическое задание."],
        ["candidate", "Интервью прошел, можно тестовое."],
        ["recruiter", "Тогда отправляю практическое задание: https://docs.google.com/document/d/example-china-test/edit. На выполнение обычно нужно 1-1.5 часа, дедлайн 3 рабочих дня. Если нужен другой срок, просто скажите."],
        ["candidate", "Готово, отправляю решение и черновик сообщения фабрике: https://docs.google.com/document/d/example-china-solution/edit."],
        ["recruiter", "Получил. Спасибо, передам команде и вернусь с обратной связью."]
      ];
    }
    return [
      ["recruiter", `${name}, уточните, пожалуйста: WeChat, 1688, реальные фабрики Китая и уровень китайского языка.`],
      ["candidate", "WeChat есть, с 1688 знаком, китайский скорее разговорный. Работал с фабриками, но часть переговоров вели через переводчика."],
      ["recruiter", "Ок, значит есть база, но важно понять глубину самостоятельности. Расскажите один кейс выбора поставщика и одну проблемную ситуацию по качеству."],
      ["candidate", "Могу рассказать кейс по поиску фабрики под текстиль и ситуацию с задержкой отгрузки."],
      ["recruiter", "Этого уже достаточно, чтобы не обнулять вас на входе. Дальше можем вести в практический этап."]
    ];
  }

  if (bucket === "weak_or_risky") {
    return [
      ["recruiter", `${name}, подскажите, есть ли у вас реальный опыт карточек для WB/Ozon, портфолио и работа с фото/ретушью?`],
      ["candidate", "Я скорее рядом с этой темой, что-то делал точечно, но сильного портфолио пока нет."],
      ["recruiter", "Понял. Для этой вакансии нужен уже уверенный самостоятельный уровень по карточкам и метрикам, поэтому дальше здесь не идем."]
    ];
  }
    if (bucket === "hidden_from_resume") {
      return [
        ["recruiter", `${name}, по резюме вижу дизайн, но маркетплейсный контекст не до конца проявлен. Подскажите: были ли WB/Ozon карточки, что с портфолио и насколько уверенно чувствуете себя в Photoshop/Figma и обработке фото?`],
        ["candidate", "Да, карточки делала, просто в резюме это не акцентировала. Портфолио могу прислать, Photoshop/Figma рабочие, фото тоже обрабатываю."],
        ["recruiter", "Тогда идем дальше. Еще важно понять опыт A/B гипотез и то, как вы смотрите на CTR/конверсию карточки, а не только на красоту дизайна."],
        ["candidate", "A/B именно формально делала не всегда, но гипотезы по главным слайдам и упаковке оффера проверяла по метрикам кабинета."],
        ["recruiter", "Этого уже достаточно для следующего шага. У нас дальше короткое тестовое на план A/B теста и два варианта главного слайда. Если вам это подходит, я могу сразу прислать детали."],
        ["candidate", "Да, подходит. Можете отправить."],
        ["recruiter", "Тогда отправляю. Вот ссылка на тестовое задание и материалы: https://docs.google.com/document/d/example-wb-test/edit. Обычно это занимает 2-4 часа, дедлайн 1-3 дня. Если нужен другой срок, просто напишите."],
        ["candidate", "Готово, отправляю решение: https://docs.google.com/document/d/example-wb-solution/edit и макет в Figma https://figma.com/file/example."],
        ["recruiter", "Получил, спасибо. Передам коллегам на просмотр и вернусь с обратной связью."]
      ];
    }
    if (bucket === "strong") {
      return [
        ["recruiter", `${name}, по резюме уже видно релевантный опыт. Уточню только: какой кейс по карточке вы считаете самым сильным и по каким метрикам вы поняли, что решение сработало?`],
        ["candidate", "Лучший кейс был по украшениям: переработали главный слайд и инфографику, CTR вырос, дальше подтянулась и конверсия в корзину."],
        ["recruiter", "Хорошо. Для нас важно, чтобы дизайнер понимал не только композицию, но и механику гипотез. По опыту вы на нужном уровне. Если хотите, следующим сообщением пришлю тестовое и формат работы."],
        ["candidate", "Тогда интересно посмотреть тестовое и формат работы."],
        ["recruiter", "Отлично. Следующий шаг у нас — короткое тестовое задание на план A/B теста и два варианта главного слайда. Если вам ок такой формат, я пришлю его сразу."],
        ["candidate", "Да, присылайте."],
        ["recruiter", "Отправляю. Вот ссылка на тестовое и исходники: https://docs.google.com/document/d/example-wb-test/edit. Обычно на это уходит 2-4 часа, дедлайн 1-3 дня. Если нужен другой срок, просто скажите."],
        ["candidate", "Готово, отправляю выполненное задание: https://docs.google.com/document/d/example-wb-solution/edit. Отдельно положила визуалы сюда: https://drive.google.com/file/d/example/view."],
        ["recruiter", "Спасибо, получил. Передам коллегам на оценку и вернусь к вам с обратной связью."]
      ];
    }
  return [
    ["recruiter", `${name}, подскажите, пожалуйста: сколько у вас практики именно по карточкам маркетплейсов, есть ли портфолио и был ли опыт смотреть на CTR/конверсию?`],
    ["candidate", "Карточки делал(а), но не на потоке. Портфолио есть, по метрикам смотрел(а) базово."],
    ["recruiter", "Ок, значит это не пустой старт, но нужно проверить глубину. Тогда следующий вопрос про структуру карточки и одну гипотезу, которую вы бы тестировали первой."],
    ["candidate", "Сначала проверил(а) бы главный слайд и оффер, потом вторичные слайды и инфографику."],
    ["recruiter", "Нормальный ход мысли. Это выглядит как пограничный, но рабочий кандидат для тестового этапа."]
  ];
}

function renderDialogue(dialogue) {
  return dialogue.map(([speaker, body]) => `- **${speaker}**: ${body}`).join("\n");
}

function getCandidateExitAppendix() {
  return {
    rationale: [
      "Legacy anchor: старая система уже умела завершать ветку по reject_when и не пушить кандидата дальше, если он сам явно отказывается от вакансии или процесса.",
      "Это не часть job-specific goals steps. Это cross-cutting branch поверх любого flow: screening, AI interview, homework, final handoff."
    ],
    decisionRows: [
      {
        case: "hard_refusal",
        confidence_band: "> 0.90",
        detect_signal: "Явный отказ от вакансии или дальнейшего общения: «неинтересно», «неактуально», «не рассматриваю», «не нужно писать», «не готов продолжать», «снимите с процесса».",
        assistant_action: "Прекратить активный flow, не слать follow-up, ответить коротким acknowledgement.",
        candidate_message_script: "Понял, спасибо, что уделили время. Удачи вам."
      },
      {
        case: "likely_refusal_needs_confirmation",
        confidence_band: "0.75 - 0.90",
        detect_signal: "Сильный негативный сигнал, но возможна двусмысленность: «мне, наверное, не подойдет», «скорее не готов», «китайский слабый, думаю смысла нет», «вряд ли потяну».",
        assistant_action: "Не продавливать следующий этап. Один раз мягко уточнить, верно ли понят отказ, и при подтверждении закрыть ветку.",
        candidate_message_script: "Верно ли я понял, что по этой вакансии вы не хотите двигаться дальше? Если да, тогда просто закрою процесс. Если речь только о конкретном этапе, могу учесть это и не пушить лишнее."
      },
      {
        case: "contextual_exit_without_weird_reopen",
        confidence_band: "context-sensitive",
        detect_signal: "Причина отказа сама исключает welcome-back CTA: например, кандидат не знает китайский для роли, где китайский обязателен.",
        assistant_action: "Не писать шаблонное «если передумаете — возвращайтесь», если это звучит странно или противоречит причине отказа.",
        candidate_message_script: "Понял, спасибо за честный ответ. Для этой роли это действительно критично, поэтому на этом остановимся."
      }
    ],
    testDialogs: [
      {
        title: "Hard refusal, stop messaging",
        dialogue: [
          ["candidate", "Спасибо, но вакансия уже неактуальна. Пожалуйста, дальше по ней мне не пишите."],
          ["recruiter", "Понял, спасибо, что написали. Удачи вам."]
        ]
      },
      {
        title: "Likely refusal, clarify once",
        dialogue: [
          ["candidate", "Если честно, с китайским у меня слабовато. Думаю, я не подойду и, наверное, не стоит продолжать."],
          ["recruiter", "Верно ли я понял, что по этой вакансии вы не хотите двигаться дальше? Если да, тогда просто закрою процесс без лишних сообщений."],
          ["candidate", "Да, лучше остановиться на этом этапе."],
          ["recruiter", "Понял, спасибо за честный ответ. Для этой роли китайский действительно критичен, поэтому на этом остановимся."]
        ]
      }
    ]
  };
}

async function main() {
  const connectionString = getLegacyDbUrl();
  if (!connectionString) throw new Error("Legacy routing DB URL not found.");

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    const jobsRes = await pool.query(`
      SELECT
        j.id,
        j.slug,
        j.title,
        js.interviewer_name,
        js.interview_language,
        js.practical_q,
        js.theory_q1,
        js.theory_q2,
        js.closing_type,
        js.screening_enabled,
        js.hh_sync_enabled,
        js.follow_up_persistence,
        js.must_have_prompt,
        js.pipeline_template
      FROM routing.jobs j
      LEFT JOIN routing.job_settings js ON js.job_id = j.id
      WHERE j.id = ANY($1::int[])
      ORDER BY j.id
    `, [targetJobIds]);

    const candidatesRes = await pool.query(`
      SELECT
        c.job_id,
        c.id,
        c.name,
        c.status,
        c.source,
        c.must_haves_from_resume,
        c.candidate_summary,
        c.resume_text,
        c.updated_at
      FROM routing.candidates c
      WHERE c.job_id = ANY($1::int[])
        AND c.status NOT IN ('ARCHIVED', 'REJECTED', 'DUPLICATE')
      ORDER BY c.job_id, COALESCE(c.must_haves_from_resume, 0) DESC, c.updated_at DESC, c.id DESC
    `, [targetJobIds]);

    const selectedCandidates = [];
    for (const jobId of targetJobIds) {
      selectedCandidates.push(...chooseEvaluationCandidates(candidatesRes.rows.filter((row) => row.job_id === jobId)));
    }

    const messagesRes = await pool.query(`
      WITH ranked AS (
        SELECT
          c.job_id,
          c.id AS candidate_id,
          c.name,
          m.direction,
          m.body,
          m.created_at,
          ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY m.created_at ASC) AS rn
        FROM routing.candidates c
        JOIN routing.messages m ON m.candidate_id = c.id
        WHERE c.id = ANY($1::int[])
          AND COALESCE(m.hidden, 0) = 0
      )
      SELECT * FROM ranked WHERE rn <= 6 ORDER BY job_id, candidate_id, rn
    `, [selectedCandidates.map((row) => row.id)]);

    const sessionCompare = await fetchSessionCompare();
    const jobById = new Map(jobsRes.rows.map((row) => [row.id, row]));

    const lines = [];
    lines.push(`# V2 Evaluation Report`);
    lines.push("");
    lines.push(`Date: ${currentDate}`);
    lines.push("");
    lines.push(`This report compares three real legacy vacancies against projected V2 dialogs.`);
    lines.push("");
    lines.push(`Important note: projected V2 dialogs below are **heuristic projections**, not live model generations.`);
    lines.push(`Reason: no \`GEMINI_API_KEY\` or \`OPENAI_API_KEY\` is configured in the current environment.`);
    lines.push("");
    lines.push(`## Compared Session`);
    lines.push("");
    lines.push(`- session: [${sessionId}](http://localhost:3000/claude-sessions/${sessionId})`);
    if (sessionCompare) {
      lines.push(`- project_path: \`${sessionCompare.project_path}\``);
      lines.push(`- messages_total: ${sessionCompare.messages_total}`);
      const firstUser = sessionCompare.messages?.find((m) => m.type === "user");
      if (firstUser?.content) lines.push(`- first user prompt: ${truncate(firstUser.content, 320)}`);
    }
    lines.push("");

    for (const jobId of targetJobIds) {
      const job = jobById.get(jobId);
      if (!job) continue;
      const goals = buildHomeworkAugmentedGoals(job, parsePipelineGoals(job.pipeline_template));
      const candidates = selectedCandidates.filter((candidate) => candidate.job_id === jobId);

      lines.push(`## Job ${job.id}: ${job.title}`);
      lines.push("");
      lines.push(`- slug: \`${job.slug}\``);
      lines.push(`- interview_language: ${job.interview_language ?? "n/a"}`);
      lines.push(`- closing_type: ${job.closing_type ?? "n/a"}`);
      lines.push(`- screening_enabled: ${job.screening_enabled ?? "n/a"}`);
      lines.push(`- hh_sync_enabled: ${job.hh_sync_enabled ?? "n/a"}`);
      lines.push(`- follow_up_persistence: ${job.follow_up_persistence ?? "n/a"}`);
      lines.push("");
      lines.push(`### Current Legacy Intent`);
      lines.push("");
      lines.push(`- practical_q: ${truncate(job.practical_q, 260)}`);
      if (job.theory_q1) lines.push(`- theory_q1: ${truncate(job.theory_q1, 240)}`);
      if (job.theory_q2) lines.push(`- theory_q2: ${truncate(job.theory_q2, 240)}`);
      lines.push(`- must_have_prompt: ${truncate(job.must_have_prompt, 300)}`);
      lines.push("");
      lines.push(`### Parsed Goals`);
      lines.push("");
      for (const goal of goals.slice(0, job.closing_type === "homework" ? 9 : 5)) {
        lines.push(`- ${goal.header}`);
        for (const bullet of goal.bullets.slice(0, 4)) {
          lines.push(`  - ${truncate(bullet, 220)}`);
        }
      }
      lines.push("");
      if (job.closing_type === "homework") {
        lines.push(`### Concrete Homework Step Examples`);
        lines.push("");
        lines.push(renderHomeworkExamplesTable(job.id));
        lines.push("");
      }
      lines.push(`### Evaluation Set`);
      lines.push("");
      for (const candidate of candidates) {
        lines.push(`#### ${candidate.name}`);
        lines.push("");
        lines.push(`- status: ${candidate.status}`);
        lines.push(`- bucket: ${candidate.bucket}`);
        lines.push(`- must_haves_from_resume: ${candidate.must_haves_from_resume ?? "n/a"}`);
        lines.push(`- summary: ${truncate(candidate.candidate_summary, 260)}`);
        lines.push(`- resume signal: ${truncate(candidate.resume_text, 300)}`);
        lines.push("");
        lines.push(`Legacy dialog snippet:`);
        lines.push("");
        const legacyDialog = extractLegacyDialog(messagesRes.rows, candidate.id).map((row) => [row.speaker, truncate(row.body, 220)]);
        lines.push(legacyDialog.length > 0 ? renderDialogue(legacyDialog) : "- *(no visible legacy messages captured in sample)*");
        lines.push("");
        lines.push(`Projected V2 dialog:`);
        lines.push("");
        lines.push(renderDialogue(generateProjectedDialogue(job, candidate)));
        lines.push("");
        lines.push(`Readout:`);
        lines.push("");
        lines.push(`- Why included: ${candidate.bucket === "hidden_from_resume" ? "resume under-signals fit, relevance appears after follow-up" : candidate.bucket === "weak_or_risky" ? "stress case for rejection, ambiguity or went-dark behavior" : candidate.bucket === "medium" ? "borderline but viable candidate who needs probing" : "clear fit that should move fast"}`);
        lines.push(`- What to inspect in V2: ${job.id === 26 ? "whether the bot skips obvious resume facts, explains compensation clearly and hands off to Telegram without over-screening" : job.id === 9 ? "whether the bot separates hard must-haves from exploratory follow-ups, then actually sends the practical assignment and detects the returned solution without losing context" : "whether the bot balances craft questions, portfolio proof and analytics thinking, then actually sends homework and recognizes submission from links/text instead of stopping at the CTA"}`);
        lines.push("");
      }
    }

    lines.push(`## What To Review First`);
    lines.push("");
    lines.push(`- job 26 hidden-from-resume cases: Артем Тяпкин, Михаил Иванкевич, Зинаида Лукьяненко`);
    lines.push(`- job 9 false-negative risk: Marlen Derdarov and Валентина Воробьева`);
    lines.push(`- job 4 borderline craft cases: Юлия Юринская and Екатерина Камышникова`);
    lines.push("");
    const candidateExitAppendix = getCandidateExitAppendix();
    lines.push(`## Appendix: Candidate-Initiated Exit`);
    lines.push("");
    for (const rationaleLine of candidateExitAppendix.rationale) {
      lines.push(`- ${rationaleLine}`);
    }
    lines.push("");
    lines.push(`| case | confidence band | detect signal | assistant action | candidate-facing script |`);
    lines.push(`|---|---|---|---|---|`);
    for (const row of candidateExitAppendix.decisionRows) {
      lines.push(`| ${row.case} | ${row.confidence_band} | ${row.detect_signal} | ${row.assistant_action} | ${row.candidate_message_script} |`);
    }
    lines.push("");
    lines.push(`### Test Dialogs`);
    lines.push("");
    for (const dialog of candidateExitAppendix.testDialogs) {
      lines.push(`- ${dialog.title}`);
      lines.push(renderDialogue(dialog.dialogue));
      lines.push("");
    }
    lines.push(`## Next Step`);
    lines.push("");
    lines.push(`- connect a real model key and rerun this evaluation with actual generated V2 dialogs instead of projections`);

    const reportPath = path.join(repoRoot, "docs", "reports", `${currentDate}-v2-evaluation-report.md`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
    console.log(reportPath);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
