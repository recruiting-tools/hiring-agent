import postgres from "postgres";

const JOB_ID = "job-prod-004";
const TEMPLATE_ID = "tpl-sales-skolkovo-2026";
const TEMPLATE_VERSION = 2;

const VACANCY_TEXT = `На входе: база компаний которым точно нужна наша услуга (определенный тип отчетности который у них есть)

На выходе:
- найденный Telegram ЛПР — передаёте нашему эксперту
- назначенная встреча (Zoom или офлайн в Москве) — ставите в календарь руководителя

Что нужно делать:
- ресёрч ЛПР по открытым источникам
- холодные звонки (Mango Telecom, все звонки записываются автоматически)
- холодные письма и сообщения
- назначение встреч с экспертом
- ведение базы контактов в Google Sheets

Плановый темп: 600-1000 компаний в месяц на проработку, минимум 3 целевых результата в неделю.

Что ищем:
- опыт в B2B-коммуникации: продажи, аккаунтинг, project management, переговорная юридическая практика
- умение находить нужного человека в компании по открытым источникам
- опыт холодных звонков
- вежливый и культурный стиль коммуникации

Будет плюсом:
- продажи юридических или консалтинговых услуг
- знакомство с экосистемой Сколково
- умение писать живые холодные письма

Условия:
- полностью удалённо
- оформление: ИП / ГПХ / самозанятый
- испытательный срок: 1 неделя
- возможна частичная занятость
- фикс 60 000 - 80 000 ₽
- бонус за встречу: +4 000 ₽
- бонус за найденный Telegram ЛПР: +1 000 ₽
- бонус за Telegram ЛПР с диалогом: +5 000 ₽

Процесс найма:
- сначала общение в чате
- потом два этапа собеседования
- решение принимается быстро`;

const PIPELINE_STEPS = [
  {
    id: "step-b2b-context",
    step_index: 0,
    goal: "Проверить релевантный B2B-бэкграунд",
    done_when: "Кандидат явно описал релевантный опыт в B2B-коммуникации: продажи, аккаунтинг, проектная роль или переговорная юридическая практика.",
    reject_when: "Кандидат не имеет опыта B2B-коммуникации и не может привести примеры переговоров с компаниями.",
    message_template: "Расскажите, пожалуйста, в каком B2B-контексте вы работали и за что именно отвечали в коммуникации с клиентами?"
  },
  {
    id: "step-outbound-fit",
    step_index: 1,
    goal: "Проверить опыт холодного аутрича",
    done_when: "Кандидат подтвердил опыт холодных звонков, писем или сообщений и может описать свой рабочий темп.",
    reject_when: "Кандидат прямо пишет, что холодных звонков не делал или не готов ими заниматься.",
    message_template: "Был ли у вас опыт холодных звонков или аутрича первым касанием? Какой примерно объём контактов в неделю/день вы держали?"
  },
  {
    id: "step-lpr-research",
    step_index: 2,
    goal: "Проверить навык поиска ЛПР",
    done_when: "Кандидат объяснил, как ищет ЛПР через открытые источники, и назвал рабочие каналы или подход.",
    reject_when: "Кандидат не умеет искать ЛПР и не может описать даже базовый процесс ресёрча.",
    message_template: "Как вы обычно ищете нужного ЛПР в компании, если на входе есть только название компании и её профиль?"
  },
  {
    id: "step-role-understanding",
    step_index: 3,
    goal: "Проверить понимание результата роли",
    done_when: "Кандидат понимает, что целевой результат роли — найденный Telegram ЛПР или назначенная встреча с экспертом, и готов работать в таком формате.",
    reject_when: "Кандидат ожидает только входящий поток или не готов к KPI на результаты и темпу outbound-проработки.",
    message_template: "У нас результат роли — это либо найденный Telegram ЛПР, либо назначенная встреча с экспертом. Насколько вам комфортен такой формат и KPI?"
  },
  {
    id: "step-telegram-handoff",
    step_index: 4,
    goal: "Перевести кандидата в Telegram",
    done_when: "Кандидат согласился перейти в Telegram для быстрого созвона или следующего шага.",
    reject_when: null,
    message_template: "По профилю вы выглядите релевантно. Если удобно двигаться быстро, напишите мне в Telegram @kobzevvv, там договоримся о следующем шаге."
  }
];

async function main() {
  const connectionString = process.env.CHATBOT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set CHATBOT_DATABASE_URL or DATABASE_URL");
  }

  const sql = postgres(connectionString, { max: 1 });

  try {
    const result = await sql.begin(async (tx) => {
      const jobRows = await tx`
        UPDATE chatbot.jobs
        SET
          title = ${"Менеджер по продажам (B2B, Сколково)"},
          description = ${VACANCY_TEXT}
        WHERE job_id = ${JOB_ID}
        RETURNING job_id, title
      `;

      if (!jobRows[0]) {
        throw new Error(`Job not found: ${JOB_ID}`);
      }

      const templateRows = await tx`
        INSERT INTO chatbot.pipeline_templates (template_id, template_version, job_id, name, steps_json)
        VALUES (
          ${TEMPLATE_ID},
          ${TEMPLATE_VERSION},
          ${JOB_ID},
          ${"Sales Skolkovo 2026"},
          ${JSON.stringify(PIPELINE_STEPS)}::jsonb
        )
        ON CONFLICT (template_id) DO UPDATE SET
          template_version = EXCLUDED.template_version,
          name = EXCLUDED.name,
          steps_json = EXCLUDED.steps_json
        RETURNING template_id, template_version
      `;

      await tx`
        UPDATE chatbot.pipeline_runs
        SET
          template_id = ${TEMPLATE_ID},
          template_version = ${TEMPLATE_VERSION},
          active_step_id = CASE
            WHEN status = 'active' THEN ${PIPELINE_STEPS[0].id}
            ELSE active_step_id
          END,
          updated_at = now()
        WHERE job_id = ${JOB_ID}
      `;

      await tx`
        DELETE FROM chatbot.pipeline_step_state
        WHERE pipeline_run_id IN (
          SELECT pipeline_run_id
          FROM chatbot.pipeline_runs
          WHERE job_id = ${JOB_ID}
        )
      `;

      const runs = await tx`
        SELECT pipeline_run_id, status
        FROM chatbot.pipeline_runs
        WHERE job_id = ${JOB_ID}
      `;

      for (const run of runs) {
        for (const step of PIPELINE_STEPS) {
          const state = run.status === "active" && step.step_index === 0 ? "active" : "pending";
          const awaitingReply = run.status === "active" && step.step_index === 0;
          await tx`
            INSERT INTO chatbot.pipeline_step_state
              (pipeline_run_id, step_id, step_index, state, awaiting_reply, extracted_facts, last_reason, updated_at, follow_up_count)
            VALUES (
              ${run.pipeline_run_id},
              ${step.id},
              ${step.step_index},
              ${state},
              ${awaitingReply},
              ${JSON.stringify({})}::jsonb,
              ${null},
              now(),
              0
            )
          `;
        }
      }

      return {
        job: jobRows[0],
        template: templateRows[0],
        updated_runs: runs.length
      };
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
