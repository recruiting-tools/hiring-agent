#!/usr/bin/env node
/**
 * Pushes playbook seed data to the Google Sheet as two new tabs:
 *   - "playbook_definitions"
 *   - "playbook_steps"
 *
 * Uses OAuth2 credentials stored in macOS Keychain by gated-knowledge.
 * Requires: googleapis (borrowed from gated-knowledge node_modules)
 *
 * Usage: node scripts/push-playbooks-to-gsheets.mjs
 */

import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(
  "/Users/vova/Documents/GitHub/gated-knowledge/node_modules/"
);
const { google } = require("googleapis");

const SPREADSHEET_ID = "1vpx6Z-LnngQhDg80sGQlC7VEtwvAkhHBhwIB8mZBUxg";

// ── Auth ────────────────────────────────────────────────────────────────────

function getOAuthClient() {
  // Use ADC (gcloud application-default credentials) — has write scopes
  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// ── Seed data ───────────────────────────────────────────────────────────────

const DEFINITIONS_HEADERS = [
  "playbook_key",
  "name",
  "trigger_description",
  "keywords",
  "status",
  "sort_order",
];

const DEFINITIONS_ROWS = [
  [
    "setup_communication",
    "Настрой общение с кандидатами по вакансии",
    "Рекрутер хочет запустить или настроить переписку с кандидатами по вакансии",
    "план коммуникации, скрининг, настроить общение, communication plan",
    "available",
    1,
  ],
  [
    "create_vacancy",
    "Создать новую вакансию",
    "Рекрутер загружает материалы по новой вакансии для структурирования данных",
    "новая вакансия, создать вакансию, загрузить вакансию",
    "available",
    2,
  ],
  [
    "view_vacancy",
    "Посмотреть информацию по вакансии",
    "Рекрутер хочет увидеть структурированные данные по существующей вакансии",
    "посмотреть вакансию, информация по вакансии, данные вакансии",
    "available",
    3,
  ],
  [
    "mass_broadcast",
    "Массовая рассылка сообщения",
    "Рекрутер хочет отправить одинаковое сообщение группе кандидатов",
    "рассылка, массовое сообщение, бродкаст, broadcast",
    "available",
    4,
  ],
  [
    "candidate_funnel",
    "Воронка по кандидатам",
    "Рекрутер хочет видеть статистику прохождения кандидатов по этапам",
    "воронка, статистика, funnel, кандидаты",
    "available",
    5,
  ],
];

const STEPS_HEADERS = [
  "step_key",
  "playbook_key",
  "step_order",
  "name",
  "step_type",
  "user_message",
  "prompt_template",
  "context_key",
  "db_save_column",
  "next_step_order",
  "options",
  "notes",
];

// prettier-ignore
const STEPS_ROWS = [
  // ── setup_communication ──────────────────────────────────────────────────
  ["setup_communication.1", "setup_communication", 1, "Выбор вакансии", "vacancy_select",
    "(встроенный UI: список вакансий + кнопка «Создать новую»)", "",
    "vacancy_id", "", 2, "", ""],

  ["setup_communication.2", "setup_communication", 2, "Загрузить данные вакансии", "data_fetch",
    "", "SELECT must_haves, nice_haves, work_conditions, application_steps, company_info FROM management.vacancies WHERE vacancy_id = {{vacancy_id}}",
    "vacancy_data", "", 3, "", ""],

  ["setup_communication.3", "setup_communication", 3, "Составить варианты плана коммуникации", "llm_generate",
    "", "TBD — нужны примеры реальных вакансий",
    "communication_plan_options", "", 4, "", "Генерирует 3–4 варианта последовательности шагов коммуникации"],

  ["setup_communication.4", "setup_communication", 4, "Показать варианты плана, предложить утвердить", "display",
    "На основании данных вакансии я подготовил несколько вариантов плана коммуникации. Выберите подходящий или уточните.", "",
    "approved_plan", "", 5, "Утвердить;Уточнить", ""],

  ["setup_communication.5", "setup_communication", 5, "Сгенерировать примеры сообщений кандидату", "llm_generate",
    "", "TBD",
    "generated_messages", "", 6, "", "3 реалистичных примера первых сообщений, HTML"],

  ["setup_communication.6", "setup_communication", 6, "Показать примеры сообщений", "display",
    "Вот три примера первых сообщений кандидатам. Выберите один или уточните формулировки.", "",
    "", "", 7, "Использовать этот;Уточнить;Следующий пример", ""],

  ["setup_communication.7", "setup_communication", 7, "Выбор режима подключения", "buttons",
    "Выберите режим работы агента с кандидатами по этой вакансии:", "",
    "automation_mode", "", "", "Полная автоматизация;Пре-модерация с таймаутом;Только уведомления", ""],

  // ── create_vacancy ───────────────────────────────────────────────────────
  ["create_vacancy.1", "create_vacancy", 1, "Загрузить материалы по вакансии", "user_input",
    "Загрузите материалы по вакансии: текст описания, профиль идеального кандидата, ссылку на HH или другие документы.", "",
    "raw_vacancy_text", "", 2, "", "INSERT в vacancies с status=draft сразу на этом шаге"],

  ["create_vacancy.2", "create_vacancy", 2, "Извлечь must haves", "llm_extract",
    "", "TBD",
    "must_haves", "must_haves", 3, "", "Обязательные требования: конкретные знания, локация, сертификаты и т.д."],

  ["create_vacancy.3", "create_vacancy", 3, "Проверить количество must haves", "decision",
    "", "",
    "", "", "", "", "<2 → попросить уточнить; ≥5 → спросить всё ли верно; 2–4 → продолжить"],

  ["create_vacancy.4", "create_vacancy", 4, "Извлечь nice haves", "llm_extract",
    "", "TBD",
    "nice_haves", "nice_haves", 5, "", "Желательные, но не обязательные критерии"],

  ["create_vacancy.5", "create_vacancy", 5, "Показать nice haves", "display",
    "Нашли следующие желательные критерии. Можете уточнить или продолжить.", "",
    "", "", 6, "Уточнить;Продолжить", ""],

  ["create_vacancy.6", "create_vacancy", 6, "Извлечь условия работы", "llm_extract",
    "", "TBD",
    "work_conditions", "work_conditions", 7, "", "Зарплата, тип контракта, удалёнка, бенефиты, локация"],

  ["create_vacancy.7", "create_vacancy", 7, "Показать условия работы", "display",
    "Нашли следующие условия работы. Проверьте и уточните если нужно.", "",
    "", "", 8, "Уточнить;Продолжить", ""],

  ["create_vacancy.8", "create_vacancy", 8, "Извлечь шаги найма", "llm_extract",
    "", "TBD",
    "application_steps", "application_steps", 9, "", "Фокус на шагах в нашей зоне компетенций (скрининг, согласование, напоминания)"],

  ["create_vacancy.9", "create_vacancy", 9, "Показать шаги найма", "display",
    "Нашли следующие этапы найма, которые мы можем вести. Скорректируйте если что-то не так.", "",
    "", "", 10, "Скорректировать;Всё верно", ""],

  ["create_vacancy.10", "create_vacancy", 10, "Извлечь информацию о компании", "llm_extract",
    "", "TBD",
    "company_info", "company_info", 11, "", "Название, описание, культура, особенности"],

  ["create_vacancy.11", "create_vacancy", 11, "Показать информацию о компании", "display",
    "Нашли следующую информацию о компании.", "",
    "", "", 12, "Уточнить;Продолжить", ""],

  ["create_vacancy.12", "create_vacancy", 12, "Что делаем дальше?", "buttons",
    "Вакансия создана. Что хотите сделать?", "",
    "next_action", "", "", "Распланировать коммуникацию;Посмотреть вакансии", ""],

  // ── view_vacancy ─────────────────────────────────────────────────────────
  ["view_vacancy.1", "view_vacancy", 1, "Выбрать вакансию", "vacancy_select",
    "(встроенный UI: список вакансий)", "",
    "vacancy_id", "", 2, "", ""],

  ["view_vacancy.2", "view_vacancy", 2, "Показать данные вакансии", "display",
    "Информация по вакансии {{vacancy_data.title}}", "",
    "", "", "", "", "Рендерит все поля структурировано"],

  // ── mass_broadcast ───────────────────────────────────────────────────────
  ["mass_broadcast.1", "mass_broadcast", 1, "Выбрать вакансию", "vacancy_select",
    "(встроенный UI: список вакансий)", "",
    "vacancy_id", "", 2, "", ""],

  ["mass_broadcast.2", "mass_broadcast", 2, "Запросить критерий выборки кандидатов", "user_input",
    "По каким критериям выбрать кандидатов для рассылки? Например: «все кто не ответил больше суток» или «кандидаты на шаге интервью».", "",
    "selection_criteria", "", 3, "", ""],

  ["mass_broadcast.3", "mass_broadcast", 3, "Обработать критерий выборки", "llm_extract",
    "", "TBD",
    "selection_query", "", 4, "", "Определяет: точный SQL-фильтр или нечёткий LLM-поиск с порогом"],

  ["mass_broadcast.4", "mass_broadcast", 4, "Уточнить логику выборки у пользователя", "decision",
    "Вот как я планирую выбрать кандидатов: {{selection_query.description}}. Порог совпадения: {{selection_query.threshold}}%. Подтвердите или скорректируйте.", "",
    "", "", 5, "Подтвердить;Изменить порог;Изменить критерий", ""],

  ["mass_broadcast.5", "mass_broadcast", 5, "Сгенерировать сообщения и репорт", "llm_generate",
    "", "TBD",
    "broadcast_report", "", "", "", "Выводит список кандидатов с сообщениями в формат репорта"],

  // ── candidate_funnel ─────────────────────────────────────────────────────
  ["candidate_funnel.1", "candidate_funnel", 1, "Выбрать вакансию", "vacancy_select",
    "(встроенный UI: список вакансий)", "",
    "vacancy_id", "", 2, "", ""],

  ["candidate_funnel.2", "candidate_funnel", 2, "Получить данные воронки", "data_fetch",
    "", "CTE-запрос: pipeline_runs + pipeline_step_state по tenant_id + vacancy_id",
    "funnel_data", "", 3, "", ""],

  ["candidate_funnel.3", "candidate_funnel", 3, "Отрисовать таблицу воронки", "display",
    "Воронка по вакансии {{vacancy_data.title}}", "",
    "", "", "", "", "Таблица: шаг × статус (дошло / висит >1ч / >24ч / >48ч)"],
];

// ── Sheets API helpers ───────────────────────────────────────────────────────

async function ensureSheet(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(
    (s) => s.properties.title === title
  );
  if (existing) {
    console.log(`  Sheet "${title}" already exists (sheetId=${existing.properties.sheetId})`);
    return existing.properties.sheetId;
  }

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
  const sheetId = res.data.replies[0].addSheet.properties.sheetId;
  console.log(`  Created sheet "${title}" (sheetId=${sheetId})`);
  return sheetId;
}

async function writeRows(sheets, spreadsheetId, sheetTitle, rows) {
  // Clear first
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${sheetTitle}'`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
  console.log(`  Wrote ${rows.length - 1} rows to "${sheetTitle}"`);
}

async function formatHeaderRow(sheets, spreadsheetId, sheetId) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.267, green: 0.267, blue: 0.267 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ],
    },
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

const auth = getOAuthClient();
const sheets = google.sheets({ version: "v4", auth });

console.log("Pushing playbook seed data to Google Sheets...\n");

// playbook_definitions tab
console.log("→ playbook_definitions");
const defSheetId = await ensureSheet(sheets, SPREADSHEET_ID, "playbook_definitions");
await writeRows(sheets, SPREADSHEET_ID, "playbook_definitions", [
  DEFINITIONS_HEADERS,
  ...DEFINITIONS_ROWS,
]);
await formatHeaderRow(sheets, SPREADSHEET_ID, defSheetId);

// playbook_steps tab
console.log("\n→ playbook_steps");
const stepsSheetId = await ensureSheet(sheets, SPREADSHEET_ID, "playbook_steps");
await writeRows(sheets, SPREADSHEET_ID, "playbook_steps", [
  STEPS_HEADERS,
  ...STEPS_ROWS,
]);
await formatHeaderRow(sheets, SPREADSHEET_ID, stepsSheetId);

console.log("\nDone ✓");
console.log(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
