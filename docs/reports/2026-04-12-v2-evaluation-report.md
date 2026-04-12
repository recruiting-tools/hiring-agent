# V2 Evaluation Report

Date: 2026-04-12

This report compares three real legacy vacancies against projected V2 dialogs.

Important note: projected V2 dialogs below are **heuristic projections**, not live model generations.
Reason: no `GEMINI_API_KEY` or `OPENAI_API_KEY` is configured in the current environment.

## Compared Session

- session: [c3835db7-34bc-46a3-93a1-e64f06f0d4a3](http://localhost:3000/claude-sessions/c3835db7-34bc-46a3-93a1-e64f06f0d4a3)
- project_path: `/Users/vova/Documents/GitHub/recruiting-agent`
- messages_total: 73
- first user prompt: по вакансии: job_id 26, slug sales-skolkovo-2026, HH вакансия 132032392 мы очень плохо сработали. -- задача. давай отберем максимально релеватных кандидатов и напишем им. «Сорри, подключал тут сервис авторазбора, чето он не очень сработал, напишите пожалуйста мне в телеграм @kobzevvv» и давайте сегодня / завтра свяжем…

## Job 4: Дизайнер карточек для маркетплейсов (Wildberries)

- slug: `wb-card-designer-1`
- interview_language: ru
- closing_type: homework
- screening_enabled: 1
- hh_sync_enabled: 0
- follow_up_persistence: 1

### Current Legacy Intent

- practical_q: Расскажите про карточку товара на маркетплейсе, которой вы особенно гордитесь. Что именно вы в ней сделали и какой результат получили по метрикам?
- theory_q1: Вам дали карточку бижутерии с низким показателем кликабельности. Какие элементы главного слайда вы бы проверили в первую очередь и почему?
- theory_q2: Как вы подходите к созданию продающего визуала украшений — какие приёмы обработки фото и композиции считаете ключевыми?
- must_have_prompt: Подтвердите, пожалуйста, несколько моментов: 1. Есть ли у вас опыт создания карточек для маркетплейсов (Wildberries, Ozon)? (да/нет) 2. Можете ли вы поделиться портфолио с карточками для маркетплейсов? (да/нет) 3. Есть ли опыт профессиональной обработки фото — ретушь, цветокоррекция, работа с блика…

### Parsed Goals

- Goal 1: Intro [pending]
  - [pending] Tell: Привет! Спасибо за отклик. У меня несколько вопросов про ваш опыт — можно ответить на все сразу одним сообщением, а можно по одному. Как удобнее?
- Goal 2: Screening [pending]
  - [pending] Опыт с маркетплейсами: делали ли карточки для WB/Ozon? Сколько примерно? Ссылка на портфолио (Telegram, Behance, Google Drive — любой формат)
  - [pending] Обработка фото и ИИ: есть ли опыт ретуши, цветокоррекции, работы с бликами металла/камней? Работали ли с ИИ-инструментами для генерации фонов?
  - [pending] Тестирование гипотез: есть ли опыт A/B тестирования карточек? Как измеряли результат?
  - [pending] Метрики и аналитика: какие метрики эффективности карточки отслеживаете? (CTR, конверсия в корзину, конверсия в заказ) Знаете ли где в кабинете WB их смотреть?
- Goal 3: A/B Guide [pending]
  - [pending] Tell: Спасибо за ответы! Кстати, мы подготовили вводный гайд по A/B тестированию карточек на WB — https://chillai.space/p/ab-testing-guide-wb-designer?password=oIbwkgOt
  - [pending] Ask: насколько тема A/B аналитики вам откликается — хотите фокусироваться на аналитике карточек или строго на дизайне без аналитики?
- Goal 4: Commitment [pending]
  - [pending] Tell: Подробнее о вакансии — компания входит в топ продавцов бижутерии на WB, два бренда («Ваша прелесть» и «Сияриум»), 200–300 SKU. Рекламный бюджет больше миллиона в месяц — каждый слайд напрямую влияет на п…
  - [pending] Интересно ли вам?
- Goal 5: Candidate Q&A [faq] [pending]
  - [pending] Tell: Если что-то интересует по вакансии, условиям или процессу — с удовольствием отвечу. А если всё понятно — расскажу про следующий шаг
  - [pending] Ответить на вопросы кандидата из FAQ
  - [pending] Если вопросов нет — переходим дальше (НЕ настаивать)
- Goal 6: Trial Work [pending]
  - [pending] Tell: Следующий шаг — небольшое тестовое задание. Нужно подготовить план A/B теста карточки: записка с гипотезой (1–2 страницы) и два варианта главного слайда. Занимает 2–4 часа, срок сдачи 1–3 дня
  - [pending] Готовы взяться? Если сейчас неудобно — обсудим сроки
  - [pending] Send: Вот ссылка на тестовое задание с исходными материалами и примерами: https://docs.google.com/document/d/1IVy9RUoGgG6a0COPvdyCbtfsSGiyr7byb34PBFKsHs4/edit — удачи!
- Goal 7: Homework Follow-up [pending]
  - [pending] Tell: Спасибо большое за выполненное задание! Я сам не эксперт в оценке дизайн-работ, передам коллегам — они посмотрят и вернусь с обратной связью
  - [pending] ACTION: notify_manager — уведомить менеджера о сдаче тестового задания
- Goal 8: Personal Touch [pending]
  - [pending] Tell: Кстати, если будут вопросы по заданию или просто хотите обсудить что-то лично — пишите мне в Телеграм: @kobzevvv. Там обычно быстрее отвечаю 🙂
- Goal X: Homework Submission Detection [projected V2 completion]
  - [pending] homework_offer: Следующий шаг у нас — короткое тестовое задание на план A/B теста и два варианта главного слайда. Если вам ок такой формат, я пришлю детали. Detection: Кандидат отвечает согласием или задает во…
  - [pending] homework_send: Тогда отправляю. Вот ссылка на тестовое задание и материалы: <google-doc-link>. Обычно это занимает 2-4 часа, дедлайн 1-3 дня. Если нужен другой срок, просто напишите. Detection: В сообщении ест…
  - [pending] homework_submission_detection: Internal step: если в сообщении кандидата есть Google Docs / Drive / Figma / любой URL и/или текст вида «готово», «отправляю решение», «выполнил тестовое», не задаем повторно воп…
  - [pending] homework_ack: Получил, спасибо. Передам коллегам на просмотр и вернусь с обратной связью. Detection: Отправлять сразу после submission detection.

### Concrete Homework Step Examples

| step | purpose | prompt / script | detection_rule |
|---|---|---|---|
| homework_offer | Предложить тестовое мягко и с выбором. | Следующий шаг у нас — короткое тестовое задание на план A/B теста и два варианта главного слайда. Если вам ок такой формат, я пришлю детали. | Кандидат отвечает согласием или задает вопрос по формату/сроку. |
| homework_send | Отправить ссылку, объем и дедлайн. | Тогда отправляю. Вот ссылка на тестовое задание и материалы: <google-doc-link>. Обычно это занимает 2-4 часа, дедлайн 1-3 дня. Если нужен другой срок, просто напишите. | В сообщении есть ссылка, ожидаемый deliverable и дедлайн. |
| homework_submission_detection | Понять, что кандидат уже прислал решение. | Internal step: если в сообщении кандидата есть Google Docs / Drive / Figma / любой URL и/или текст вида «готово», «отправляю решение», «выполнил тестовое», не задаем повторно вопрос про готовность. | Считать homework submitted по ссылке, файлу или явному completion-text. |
| homework_ack | Подтвердить получение и закрыть этап. | Получил, спасибо. Передам коллегам на просмотр и вернусь с обратной связью. | Отправлять сразу после submission detection. |
| notify_manager | Внутренне поднять событие о сдаче домашки. | ACTION: notify_manager | Только после candidate-facing acknowledgement. |

### Evaluation Set

#### Анна Патык

- status: INTERVIEW_OFFERED
- bucket: strong
- must_haves_from_resume: 1
- summary: 
- resume signal: Name: Патык Анна Вячеславовна Title: Графический дизайнер (SMM, рекламные кампании, иллюстрация) Location: Красноярск Age: 33 Total experience: 8y 9m --- Experience --- Дизайнер SMM, Художник-иллюстратор @ Ценалом, Дискаунтер техники и товаров для дома (2019-06-01 – 2025-08-01) Работала с визуально…

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 72/100 (yes) — The candidate possesses solid graphics design experience and skills that align with the job requirements for designing marketplace cards. They have extensive experience in commer…
- **system**: [HH.ru] Must-haves auto-confirmed from resume: The candidate meets all the must-have requirements for the position.
- **recruiter**: [HH.ru] Анна Патык, Я рассмотрел ваше резюме, и у меня нет дополнительных вопросов — всё выглядит отлично! Есть ли у вас вопросы по роли, компании или условиям? С нетерпением жду вашего ответа! Владимир
- **candidate**: Вопросов нет.
- **candidate**: Здравствуйте! Меня зовут Анна Патык, я графический дизайнер с 8+ годами опыта в digital и коммерческих проектах. Работаю с визуальной коммуникацией брендов, key visual и адаптацией дизайна под разные каналы и форматы, о…
- **recruiter**: [HH.ru] Анна Патык, привет! На следующем этапе у нас будет короткое видео-интервью с AI-ассистентом — всего 5-7 минут, где обсудим ваши проекты и рабочий процесс. Если хотите, можно сразу перейти к тестовому заданию. Ка…

Projected V2 dialog:

- **recruiter**: Анна, по резюме уже видно релевантный опыт. Уточню только: какой кейс по карточке вы считаете самым сильным и по каким метрикам вы поняли, что решение сработало?
- **candidate**: Лучший кейс был по украшениям: переработали главный слайд и инфографику, CTR вырос, дальше подтянулась и конверсия в корзину.
- **recruiter**: Хорошо. Для нас важно, чтобы дизайнер понимал не только композицию, но и механику гипотез. По опыту вы на нужном уровне. Если хотите, следующим сообщением пришлю тестовое и формат работы.
- **candidate**: Тогда интересно посмотреть тестовое и формат работы.
- **recruiter**: Отлично. Следующий шаг у нас — короткое тестовое задание на план A/B теста и два варианта главного слайда. Если вам ок такой формат, я пришлю его сразу.
- **candidate**: Да, присылайте.
- **recruiter**: Отправляю. Вот ссылка на тестовое и исходники: https://docs.google.com/document/d/example-wb-test/edit. Обычно на это уходит 2-4 часа, дедлайн 1-3 дня. Если нужен другой срок, просто скажите.
- **candidate**: Готово, отправляю выполненное задание: https://docs.google.com/document/d/example-wb-solution/edit. Отдельно положила визуалы сюда: https://drive.google.com/file/d/example/view.
- **recruiter**: Спасибо, получил. Передам коллегам на оценку и вернусь к вам с обратной связью.

Readout:

- Why included: clear fit that should move fast
- What to inspect in V2: whether the bot balances craft questions, portfolio proof and analytics thinking, then actually sends homework and recognizes submission from links/text instead of stopping at the CTA

#### Елизавета Полозова

- status: SCREENING_DONE
- bucket: strong
- must_haves_from_resume: 1
- summary: 
- resume signal: Name: Полозова Елизавета Дмитриевна Title: Графический дизайнер Location: Екатеринбург Age: 20 Desired salary: 50000 RUR --- Languages --- Русский: Родной --- Skills --- Исполнительность --- Additional skills --- Здравствуйте! Имею практический опыт работы с карточками товаров для маркетплейсов (Wi…

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 72/100 (yes) — The candidate has practical experience with marketplaces such as Wildberries and Ozon and has skills relevant to the job description, such as photo preparation and SEO text writi…
- **system**: [HH.ru] Must-haves auto-confirmed from resume: The candidate meets all must-have requirements with experience in marketplaces and skills in Adobe Photoshop.
- **recruiter**: [HH.ru] Елизавета Полозова, Я ознакомился с вашим резюме, и у меня нет дополнительных вопросов — все выглядит отлично. Есть ли у вас вопросы о должности, компании или условиях работы? С уважением, Владимир

Projected V2 dialog:

- **recruiter**: Елизавета, по резюме уже видно релевантный опыт. Уточню только: какой кейс по карточке вы считаете самым сильным и по каким метрикам вы поняли, что решение сработало?
- **candidate**: Лучший кейс был по украшениям: переработали главный слайд и инфографику, CTR вырос, дальше подтянулась и конверсия в корзину.
- **recruiter**: Хорошо. Для нас важно, чтобы дизайнер понимал не только композицию, но и механику гипотез. По опыту вы на нужном уровне. Если хотите, следующим сообщением пришлю тестовое и формат работы.
- **candidate**: Тогда интересно посмотреть тестовое и формат работы.
- **recruiter**: Отлично. Следующий шаг у нас — короткое тестовое задание на план A/B теста и два варианта главного слайда. Если вам ок такой формат, я пришлю его сразу.
- **candidate**: Да, присылайте.
- **recruiter**: Отправляю. Вот ссылка на тестовое и исходники: https://docs.google.com/document/d/example-wb-test/edit. Обычно на это уходит 2-4 часа, дедлайн 1-3 дня. Если нужен другой срок, просто скажите.
- **candidate**: Готово, отправляю выполненное задание: https://docs.google.com/document/d/example-wb-solution/edit. Отдельно положила визуалы сюда: https://drive.google.com/file/d/example/view.
- **recruiter**: Спасибо, получил. Передам коллегам на оценку и вернусь к вам с обратной связью.

Readout:

- Why included: clear fit that should move fast
- What to inspect in V2: whether the bot balances craft questions, portfolio proof and analytics thinking, then actually sends homework and recognizes submission from links/text instead of stopping at the CTA

#### Федор Катавилов

- status: SCREENING
- bucket: medium
- must_haves_from_resume: 0
- summary: ## Федор Катавилов ### Must-haves - Опыт маркетплейсов: + Я создал свои объявления на авито на услугу по созданию инфографики для маркетплейсов. Мне писали люди, я помогал с созданием ТЗ, если у человека его не было, анализировал конкурентов, составлял страте…
- resume signal: Name: Катавилов Федор Сергеевич Title: Дизайнер инфографики для маркетплейсов Location: Москва Age: 20 Total experience: 1y 1m Desired salary: 45000 RUR --- Experience --- Дизайнер инфографики @ Авито (2024-11-01 – 2025-11-01) Я создал свои объявления на авито на услугу по созданию инфографики для …

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 68/100 (maybe) — The candidate has relevant experience in creating infographics for marketplaces and demonstrates adaptability to different design tasks. However, with only 1 year of experience…
- **recruiter**: [HH.ru] Федор Катавилов, спасибо за ваши разъяснения. Теперь ваша очередь — есть ли у вас вопросы о роли, компании или условиях? Буду рад ответить! Владимир
- **system**: [HH.ru] Resume evaluated: 75/100 (yes) — The candidate demonstrates strong relevant skills and practical experience in marketplace infographic design, directly aligning with the job description. While their experience i…
- **recruiter**: [HH.ru] Привет, Федор Катавилов! Спасибо за отклик. У меня есть несколько вопросов по вашему опыту — можно ответить на все сразу одним сообщением, а можно по одному. Как вам удобнее? Владимир
- **candidate**: Здравствуйте, одним сообщением
- **recruiter**: [HH.ru] Здравствуйте, Федор Катавилов! Отлично, тогда задам сразу все вопросы. Пожалуйста, расскажите: * **Опыт с маркетплейсами:** делали ли карточки для WB/Ozon? Сколько примерно? Поделитесь ссылкой на портфолио (Tele…

Projected V2 dialog:

- **recruiter**: Федор, подскажите, пожалуйста: сколько у вас практики именно по карточкам маркетплейсов, есть ли портфолио и был ли опыт смотреть на CTR/конверсию?
- **candidate**: Карточки делал(а), но не на потоке. Портфолио есть, по метрикам смотрел(а) базово.
- **recruiter**: Ок, значит это не пустой старт, но нужно проверить глубину. Тогда следующий вопрос про структуру карточки и одну гипотезу, которую вы бы тестировали первой.
- **candidate**: Сначала проверил(а) бы главный слайд и оффер, потом вторичные слайды и инфографику.
- **recruiter**: Нормальный ход мысли. Это выглядит как пограничный, но рабочий кандидат для тестового этапа.

Readout:

- Why included: borderline but viable candidate who needs probing
- What to inspect in V2: whether the bot balances craft questions, portfolio proof and analytics thinking, then actually sends homework and recognizes submission from links/text instead of stopping at the CTA

#### Владислава Таланова

- status: SCREENING
- bucket: medium
- must_haves_from_resume: 0
- summary: ## Владислава Таланова ### Must-haves - Опыт маркетплейсов: + Не знаю где посмотреть WB (не знаю где можно посмотреть их в кабинете WB) - Photoshop: + confident (Adobe Photoshop) - Портфолио: + https://t.me/vladaArt1 (Художественные работы: https://t.me/vlada…
- resume signal: Name: Таланова Владислава Олеговна Title: Графический дизайнер Location: Пушкино (Московская область) Age: 22 Total experience: 4y 4m Desired salary: 50000 RUR --- Experience --- Полиграфический дизайнер @ Каждому свое (2024-06-01 – present) - Отрисовка художественных иллюстраций от руки - Генераци…

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 75/100 (yes) — The candidate has direct experience with marketplace card design and strong graphic design skills relevant to the role. While specific Wildberries experience isn't explicitly det…
- **recruiter**: [HH.ru] Привет, Владислава Таланова! Спасибо за отклик. У меня несколько вопросов про ваш опыт — можно ответить на все сразу одним сообщением, а можно по одному. Как удобнее? Владимир
- **candidate**: Все сразу
- **candidate**: Здравствуйте!
- **candidate**: Здравствуйте! Я увидела вашу вакансию и заинтересовалась ею. У меня есть опыт работы на фрилансе, а также успешный опыт сотрудничества с компаниями «BeadsArt», «Каждому своё» Мои основные навыки — рисование и работа с р…
- **system**: [HH.ru] Resume evaluated: 75/100 (yes) — The candidate has direct experience with marketplace card design and a relevant skill set. While formal education isn't extensive, practical experience and a strong portfolio are…

Projected V2 dialog:

- **recruiter**: Владислава, подскажите, пожалуйста: сколько у вас практики именно по карточкам маркетплейсов, есть ли портфолио и был ли опыт смотреть на CTR/конверсию?
- **candidate**: Карточки делал(а), но не на потоке. Портфолио есть, по метрикам смотрел(а) базово.
- **recruiter**: Ок, значит это не пустой старт, но нужно проверить глубину. Тогда следующий вопрос про структуру карточки и одну гипотезу, которую вы бы тестировали первой.
- **candidate**: Сначала проверил(а) бы главный слайд и оффер, потом вторичные слайды и инфографику.
- **recruiter**: Нормальный ход мысли. Это выглядит как пограничный, но рабочий кандидат для тестового этапа.

Readout:

- Why included: borderline but viable candidate who needs probing
- What to inspect in V2: whether the bot balances craft questions, portfolio proof and analytics thinking, then actually sends homework and recognizes submission from links/text instead of stopping at the CTA

#### Екатерина Камышникова

- status: SCREENING
- bucket: hidden_from_resume
- must_haves_from_resume: 0
- summary: ## Candidate Summary: Екатерина Камышникова ### Must-haves - Опыт работы с маркетплейсами (Wildberries, Ozon, Amazon) — ❓ unknown - Владение Adobe Photoshop и/или Figma — ✅ confirmed (работа в Adobe Photoshop и Figma) - Ссылка на портфолио работ для маркетпле…
- resume signal: Name: Камышникова Екатерина Title: Веб-дизайнер/графический дизайнер Location: Москва Age: 28 Total experience: 3y 4m --- Experience --- Дизайнер-художник @ С-Маркет (2024-01-01 – present) Создание графики и визуальных материалов: баннеры, постеры, карточки товаров, оформление соцсетей. Работа в Ad…

Legacy dialog snippet:

- **candidate**: Добрый день. Меня зовут Екатерина. Опыт в дизайне 3+ года. Портфолио: https://www.behance.net/katya_or Активно использую в работе ИИ сервисы , чаще всего : нано банана , чат gpt, фрипик

Projected V2 dialog:

- **recruiter**: Екатерина, по резюме вижу дизайн, но маркетплейсный контекст не до конца проявлен. Подскажите: были ли WB/Ozon карточки, что с портфолио и насколько уверенно чувствуете себя в Photoshop/Figma и обработке фото?
- **candidate**: Да, карточки делала, просто в резюме это не акцентировала. Портфолио могу прислать, Photoshop/Figma рабочие, фото тоже обрабатываю.
- **recruiter**: Тогда идем дальше. Еще важно понять опыт A/B гипотез и то, как вы смотрите на CTR/конверсию карточки, а не только на красоту дизайна.
- **candidate**: A/B именно формально делала не всегда, но гипотезы по главным слайдам и упаковке оффера проверяла по метрикам кабинета.
- **recruiter**: Этого уже достаточно для следующего шага. У нас дальше короткое тестовое на план A/B теста и два варианта главного слайда. Если вам это подходит, я могу сразу прислать детали.
- **candidate**: Да, подходит. Можете отправить.
- **recruiter**: Тогда отправляю. Вот ссылка на тестовое задание и материалы: https://docs.google.com/document/d/example-wb-test/edit. Обычно это занимает 2-4 часа, дедлайн 1-3 дня. Если нужен другой срок, просто напишите.
- **candidate**: Готово, отправляю решение: https://docs.google.com/document/d/example-wb-solution/edit и макет в Figma https://figma.com/file/example.
- **recruiter**: Получил, спасибо. Передам коллегам на просмотр и вернусь с обратной связью.

Readout:

- Why included: resume under-signals fit, relevance appears after follow-up
- What to inspect in V2: whether the bot balances craft questions, portfolio proof and analytics thinking, then actually sends homework and recognizes submission from links/text instead of stopping at the CTA

#### Rafik Musaev

- status: SCREENING_went_dark_2_time
- bucket: weak_or_risky
- must_haves_from_resume: 0
- summary: ## Candidate Summary: Rafik Musaev ### Must-haves - : ❓ unknown ### Key Info - Salary expectations: 500 USD - Location/relocation: Самарканд - Notice period: нет инфы - Languages: Русский (родной), Английский (B2) - Motivation: нет инфы
- resume signal: Name: Musaev Rafik Title: Средний специалист Location: Самарканд Desired salary: 500 USD --- Languages --- Русский: Родной Английский: B2 — Средне-продвинутый --- Skills --- Деловое общение, Активные продажи, Обучение и развитие, Электронная почта --- Additional skills --- ⚠️ ⚠️ ⚠️ Мусаев Рафик @RA…

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 85/100 (strong_yes) — Musaev Rafik demonstrates strong relevant skills and experience in video editing, particularly in creating product cards for marketplaces like Wildberries, which aligns we…
- **recruiter**: [HH.ru] Привет, Рафик Мусаев! Спасибо за отклик. У меня есть несколько вопросов по вашему опыту — можете ответить на все сразу одним сообщением, а можно по одному. Как вам удобнее? Владимир
- **recruiter**: [HH.ru] Привет, Рафик Мусаев! Спасибо за отклик. У меня есть несколько вопросов по вашему опыту — можете ответить на все сразу одним сообщением, а можно по одному. Как вам удобнее? Владимир
- **recruiter**: Rafik, на всякий пожарный — напоминаю о вакансии «Дизайнер карточек для маркетплейсов (Wildberries)», вдруг потерялась в потоке. Если интерес есть, напишите! Владимир
- **recruiter**: Rafik, добрый день! Ещё раз о вакансии «Дизайнер карточек для маркетплейсов (Wildberries)» — если есть вопросы или сомнения, готов ответить 🙂 Владимир
- **candidate**: Здравствуйте! Спасибо за приглашение на вакансию «Дизайнер карточек Wildberries». Однако сейчас предложение для меня неактуально.

Projected V2 dialog:

- **recruiter**: Rafik, подскажите, есть ли у вас реальный опыт карточек для WB/Ozon, портфолио и работа с фото/ретушью?
- **candidate**: Я скорее рядом с этой темой, что-то делал точечно, но сильного портфолио пока нет.
- **recruiter**: Понял. Для этой вакансии нужен уже уверенный самостоятельный уровень по карточкам и метрикам, поэтому дальше здесь не идем.

Readout:

- Why included: stress case for rejection, ambiguity or went-dark behavior
- What to inspect in V2: whether the bot balances craft questions, portfolio proof and analytics thinking, then actually sends homework and recognizes submission from links/text instead of stopping at the CTA

## Job 9: Менеджер по закупкам Китай

- slug: `galyamina-zakupki-china-2026-03`
- interview_language: zh
- closing_type: homework
- screening_enabled: 1
- hh_sync_enabled: 0
- follow_up_persistence: 1

### Current Legacy Intent

- practical_q: 请举一个你选择供应商的例子。是什么产品，遇到了哪些困难，最终找到了什么？做了哪些妥协？
- theory_q1: 当你第一次联系新工厂时，在下第一个订单前你具体检查什么？
- theory_q2: 你在与中国工厂合作中犯过的最大错误是什么？
- must_have_prompt: Пожалуйста, подтвердите несколько моментов, прежде чем мы продолжим: 1. Есть ли у вас свой аккаунт WeChat? (да/нет) 2. Есть ли опыт работы с 1688.com? (да/нет) 3. Есть ли реальный опыт переписки/переговоров с китайскими фабриками? (да/нет) 4. Устроит ли оформление как самозанятость или ГПХ? (да/нет…

### Parsed Goals

- Goal 1: Intro [pending]
  - [pending] Tell: привет! Меня зовут Владимир, я рекрутер. Спасибо за отклик на позицию менеджера по закупкам — работа с китайскими фабриками, удалённо
  - [pending] Tell: сначала я задам несколько вопросов о вашем опыте, потом расскажу подробнее о компании и роли, и вы сможете задать свои вопросы
- Goal 2: Screening [pending]
  - [pending] Владеете ли вы китайским языком? Если да — на каком уровне? (базовый/разговорный/деловая переписка/свободный)
  - [pending] Есть ли у вас свой аккаунт WeChat? Активно ли пользуетесь?
  - [pending] Есть ли опыт работы с 1688.com?
  - [pending] Расскажите коротко: с какими фабриками работали, какие товарные категории, какие объёмы?
- Goal 3: Commitment [pending]
  - [pending] Tell: компания — бренд детской одежды Home Style For You на Wildberries. 46 позиций, рейтинги 4.7-4.9, оборот 20-30 млн/мес
  - [pending] Tell: производство на фабриках в Китае. Сейчас собственники сами ведут всю коммуникацию, но с ростом бизнеса хотят передать это отдельному человеку
  - [pending] Tell: задача — полностью взять на себя работу с Китаем: поиск фабрик, переговоры, контроль производства, работа с браком. Маркетплейсом занимаются собственники
  - [pending] Tell: удалёнка, гибкий график
- Goal 4: Candidate Q&A [faq] [pending]
  - [pending] Tell: если у вас есть вопросы о компании, роли или условиях — с удовольствием отвечу
  - [pending] Ответить на вопросы из FAQ
  - [pending] Когда вопросов нет — переход к следующему этапу
- Goal 5: AI Interview Invite [pending]
  - [pending] Tell: следующий шаг — короткое AI-интервью на КИТАЙСКОМ языке (3-5 минут). Это видеозвонок с AI-ассистентом, который задаст несколько вопросов на китайском по вашему опыту работы с фабриками. Понадобятся камер…
  - [pending] Tell: это помогает нам быстрее узнать кандидатов — не нужно подстраиваться под расписание
  - [pending] Спросить: готовы пройти сейчас, или есть вопросы?
  - [pending] Если кандидат согласен — ACTION: Send interview link
- Goal 6: AI Interview Follow-up [pending]
  - [pending] Дождаться завершения AI-интервью (результаты придут системным сообщением вида [AI INTERVIEW RESULT])
  - [pending] Пока ждём — если кандидат пишет, ответить: ссылка выше, пройдите когда удобно, камера и микрофон понадобятся
  - [pending] Когда результаты получены — оценка максимально мягкая: если кандидат хоть как-то рассказал о своём опыте (закупки, Китай, фабрики, переговоры) — считаем пройденным
  - [pending] Tell: спасибо за интервью! Всё отлично, переходим к следующему этапу
- Goal 7: Take Home Work [pending]
  - [pending] ВАЖНО: если кандидат ранее подтвердил знание китайского языка (любой уровень) — Tell: задание скорее информационное, чтобы вы понимали какие темы будут на финальном интервью. Если для вас это всё база — можно …
  - [pending] Если кандидат НЕ знает китайский — задание обязательное
  - [pending] Tell: у нас есть небольшое практическое задание — выбрать товар из витрины бренда на WB, найти фабрику на 1688, прикинуть экономику и написать сообщение фабрике на китайском. 1-1.5 часа
  - [pending] Если кандидат готов — ACTION: Отправить ссылку на тестовое задание
- Goal 8: Schedule Interview with Vladimir [pending]
  - [pending] Tell: финальный шаг — короткое интервью со мной (Владимир), примерно 15 минут. Я запишу звонок и передам нанимающему менеджеру. Запишитесь на удобное время: https://calendly.com/vladimir-skillset/30min
  - [pending] Спросить: есть ли вопросы перед интервью?
  - [pending] Подтверждение от кандидата что записался или планирует записаться
- Goal X: Homework Submission Detection [projected V2 completion]
  - [pending] homework_offer: Следующим шагом у нас небольшое практическое задание по фабрике, 1688 и сообщению поставщику. Если вам ок, я сразу пришлю ссылку. Detection: Кандидат соглашается или задает вопрос по сроку/форм…
  - [pending] homework_send: Тогда отправляю практическое задание: <google-doc-link>. Нужно выбрать товар, найти фабрику на 1688, прикинуть экономику и написать сообщение фабрике на китайском. Обычно это занимает 1-1.5 часа…
  - [pending] homework_submission_detection: Internal step: если кандидат прислал ссылку, файл или пишет «сделал(а) / отправляю решение / прикрепляю ответ», считаем homework submitted. Detection: Ссылка на документ или явны…
  - [pending] homework_ack: Получил, спасибо. Передам команде и вернусь с обратной связью. Detection: Отправлять сразу после submission detection.

### Concrete Homework Step Examples

| step | purpose | prompt / script | detection_rule |
|---|---|---|---|
| homework_offer | Подвести к практическому кейсу после screening / AI interview. | Следующим шагом у нас небольшое практическое задание по фабрике, 1688 и сообщению поставщику. Если вам ок, я сразу пришлю ссылку. | Кандидат соглашается или задает вопрос по сроку/формату. |
| homework_send | Дать тестовое с понятным scope. | Тогда отправляю практическое задание: <google-doc-link>. Нужно выбрать товар, найти фабрику на 1688, прикинуть экономику и написать сообщение фабрике на китайском. Обычно это занимает 1-1.5 часа, дедлайн 3 рабочих дня. | В сообщении есть ссылка, scope задания и дедлайн. |
| homework_submission_detection | Определить сдачу по сообщению кандидата. | Internal step: если кандидат прислал ссылку, файл или пишет «сделал(а) / отправляю решение / прикрепляю ответ», считаем homework submitted. | Ссылка на документ или явный completion-text. |
| homework_ack | Нормально закрыть этап после сдачи. | Получил, спасибо. Передам команде и вернусь с обратной связью. | Отправлять сразу после submission detection. |
| notify_manager | Сигнализировать внутрь команды о новой сдаче. | ACTION: notify_manager | Только после candidate-facing acknowledgement. |

### Evaluation Set

#### Marlen Derdarov

- status: AI_INTERVIEW_SENT
- bucket: strong
- must_haves_from_resume: 1
- summary: ## Marlen Derdarov ### Must-haves - Китайский язык: + business (китайский язык HSK5) - WeChat: ? не выяснено - Опыт 1688.com: ? не выяснено ### Key Info - Товарные категории: ? не выяснено - Объёмы закупок: ? не выяснено - Опыт отсрочек/условий оплаты: ? не в…
- resume signal: Name: Derdarov Marlen Title: Менеджер по ВЭД, переводчик Location: Бахчисарай Age: 37 Total experience: 11y 0m --- Experience --- менеджер ВЭД @ Джанкт систем (2025-05-01 – present) импорт микроэлектроники и оборудования из Китая для промышленных предприятий и научных лабораторий. Обязанности: поис…

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 50/100 (maybe) — The candidate demonstrates substantial experience in international procurement, particularly in engaging with Chinese suppliers. However, they lack a demonstrated active WeChat…
- **recruiter**: [HH.ru] Уважаемый Марлен Дердаров, Спасибо за подачу заявки на должность Менеджера по закупкам в Китай. Я внимательно изучил ваше резюме и заметил, что вам не хватает опыта работы с B2B китайскими площадками. Учитывая э…
- **candidate**: Опыт работы в ВЭД более 13 лет: Прекрасное владение английским и арабским языком, китайский язык HSK5 . Опыт в заграничных поездок ( Гуанчжоу, Шэньчжэнь, Фошань, Каир, Дубай) 1)Поиск поставщиков под ключ 2)Сюрвейерские …
- **candidate**: У меня не хватает опыта))))) я суммарно 5 лет отработал в китайских компаниях
- **system**: [HH.ru] Re-evaluated after clarification: 70/100 (yes) — The candidate has significant relevant experience in foreign economic activity and has previously worked with suppliers in China. However, the resume lacks direct…
- **system**: [HH.ru] Must-haves confirmed from resume+clarification: The candidate meets all the must-have requirements.

Projected V2 dialog:

- **recruiter**: Marlen, резюме уже дает сильный сигнал. Чтобы не повторяться, уточню только детали: какие категории вели, были ли отсрочки/условия оплаты и как решали спор по качеству или срокам?
- **candidate**: Категории были электроника и оборудование. По оплате вела переговоры, отсрочки обсуждали. При проблемах по качеству фиксировали фото/видео, договаривались о переработке или компенсации.
- **recruiter**: Хорошо. Тогда следующий шаг у нас либо короткое AI-интервью на китайском, либо сразу практическое, если вам так удобнее.
- **candidate**: Могу пройти AI-интервью, потом практическое.
- **recruiter**: Отлично. Если вам удобно, я сейчас пришлю ссылку на AI-интервью, а после него сразу перейдем к практическому.
- **candidate**: Да, давайте.
- **recruiter**: Отправляю ссылку на AI-интервью. Когда закончите, напишите, и я пришлю практическое задание.
- **candidate**: Интервью прошел, можно тестовое.
- **recruiter**: Тогда отправляю практическое задание: https://docs.google.com/document/d/example-china-test/edit. На выполнение обычно нужно 1-1.5 часа, дедлайн 3 рабочих дня. Если нужен другой срок, просто скажите.
- **candidate**: Готово, отправляю решение и черновик сообщения фабрике: https://docs.google.com/document/d/example-china-solution/edit.
- **recruiter**: Получил. Спасибо, передам команде и вернусь с обратной связью.

Readout:

- Why included: clear fit that should move fast
- What to inspect in V2: whether the bot separates hard must-haves from exploratory follow-ups, then actually sends the practical assignment and detects the returned solution without losing context

#### Денис Шорохов

- status: SCREENING_DONE
- bucket: strong
- must_haves_from_resume: 1
- summary: ## Денис Шорохов ### Must-haves - Китайский язык: ✅ fluent (уровне HSK-6) - WeChat: ❓ не выяснено - Опыт 1688.com: ❓ не выяснено ### Key Info - Товарные категории: нет инфы - Объёмы закупок: нет инфы - Опыт отсрочек/условий оплаты: нет инфы - Работа с браком:…
- resume signal: Name: Шорохов Денис Вадимович Title: Менеджер по работе с партнерами Location: Москва Age: 23 Total experience: 1y 3m --- Experience --- Ассистент в отделе по международному сотрудничеству 国际学术交流合作部助理 @ Университет МГУ-ППИ в Шэньчжэне (2023-09-01 – 2024-04-01) Китайско-русский перевод документов, д…

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 25/100 (strong_no) — The candidate lacks critical experience and qualifications for the position of Менеджер по закупкам. They do not have an active WeChat account, experience with 1688.com or …
- **recruiter**: [HH.ru] Денис Шорохов, Спасибо за вашу заявку на позицию "Менеджер по закупкам Китай". Я внимательно изучил ваше резюме и заметил некоторые моменты, которые не соответствуют требованиям вакансии. Некоторые ключевые проб…
- **candidate**: Здравствуйте, опыт работы с B2B, 1688 и другими китайскими платформами есть, не было возможности указать это в анкете из-за ограничений сайта.
- **system**: [HH.ru] Re-evaluated after clarification: 70/100 (yes) — The candidate has a strong background in Chinese language and experience in translation and document management, but lacks direct purchasing experience with B2B p…
- **system**: [HH.ru] Must-haves confirmed from resume+clarification: The candidate has confirmed experience with 1688.com and related skills, while also addressing all other requirements.
- **recruiter**: [HH.ru] Денис Шорохов, спасибо за отправленное резюме. У меня нет дополнительных вопросов, все выглядит хорошо. Есть ли у вас вопросы о роли, компании или условиях? Буду рад пообщаться! Владимир

Projected V2 dialog:

- **recruiter**: Денис, резюме уже дает сильный сигнал. Чтобы не повторяться, уточню только детали: какие категории вели, были ли отсрочки/условия оплаты и как решали спор по качеству или срокам?
- **candidate**: Категории были электроника и оборудование. По оплате вела переговоры, отсрочки обсуждали. При проблемах по качеству фиксировали фото/видео, договаривались о переработке или компенсации.
- **recruiter**: Хорошо. Тогда следующий шаг у нас либо короткое AI-интервью на китайском, либо сразу практическое, если вам так удобнее.
- **candidate**: Могу пройти AI-интервью, потом практическое.
- **recruiter**: Отлично. Если вам удобно, я сейчас пришлю ссылку на AI-интервью, а после него сразу перейдем к практическому.
- **candidate**: Да, давайте.
- **recruiter**: Отправляю ссылку на AI-интервью. Когда закончите, напишите, и я пришлю практическое задание.
- **candidate**: Интервью прошел, можно тестовое.
- **recruiter**: Тогда отправляю практическое задание: https://docs.google.com/document/d/example-china-test/edit. На выполнение обычно нужно 1-1.5 часа, дедлайн 3 рабочих дня. Если нужен другой срок, просто скажите.
- **candidate**: Готово, отправляю решение и черновик сообщения фабрике: https://docs.google.com/document/d/example-china-solution/edit.
- **recruiter**: Получил. Спасибо, передам команде и вернусь с обратной связью.

Readout:

- Why included: clear fit that should move fast
- What to inspect in V2: whether the bot separates hard must-haves from exploratory follow-ups, then actually sends the practical assignment and detects the returned solution without losing context

#### Александр Беляев

- status: NEW
- bucket: medium
- must_haves_from_resume: 0
- summary: 
- resume signal: Name: Беляев Александр Title: Менеджер по ВЭД Location: Санкт-Петербург Age: 24 Total experience: 3y 5m Desired salary: 100000 RUR --- Experience --- Менеджер по закупкам @ ООО «ОРИЕНТИС ТЕХНОЛОДЖИ» (2025-09-01 – 2026-04-01) Поиск новых поставщиков, изучение новых предложений Проведение переговоров…

Legacy dialog snippet:

- *(no visible legacy messages captured in sample)*

Projected V2 dialog:

- **recruiter**: Александр, уточните, пожалуйста: WeChat, 1688, реальные фабрики Китая и уровень китайского языка.
- **candidate**: WeChat есть, с 1688 знаком, китайский скорее разговорный. Работал с фабриками, но часть переговоров вели через переводчика.
- **recruiter**: Ок, значит есть база, но важно понять глубину самостоятельности. Расскажите один кейс выбора поставщика и одну проблемную ситуацию по качеству.
- **candidate**: Могу рассказать кейс по поиску фабрики под текстиль и ситуацию с задержкой отгрузки.
- **recruiter**: Этого уже достаточно, чтобы не обнулять вас на входе. Дальше можем вести в практический этап.

Readout:

- Why included: borderline but viable candidate who needs probing
- What to inspect in V2: whether the bot separates hard must-haves from exploratory follow-ups, then actually sends the practical assignment and detects the returned solution without losing context

#### Илья Гегелия

- status: NEW
- bucket: medium
- must_haves_from_resume: 0
- summary: 
- resume signal: Name: Гегелия Илья Владимирович Title: Менеджер по ВЭД Location: Вологда Age: 36 Total experience: 2y 4m Desired salary: 130000 RUR --- Experience --- Менеджер по ВЭД @ HOLDY Москва (2025-02-01 – 2026-04-01) Заключение договоров по белому импорту из Китая в Россию . Поиск поставщиков в Китае - кома…

Legacy dialog snippet:

- *(no visible legacy messages captured in sample)*

Projected V2 dialog:

- **recruiter**: Илья, уточните, пожалуйста: WeChat, 1688, реальные фабрики Китая и уровень китайского языка.
- **candidate**: WeChat есть, с 1688 знаком, китайский скорее разговорный. Работал с фабриками, но часть переговоров вели через переводчика.
- **recruiter**: Ок, значит есть база, но важно понять глубину самостоятельности. Расскажите один кейс выбора поставщика и одну проблемную ситуацию по качеству.
- **candidate**: Могу рассказать кейс по поиску фабрики под текстиль и ситуацию с задержкой отгрузки.
- **recruiter**: Этого уже достаточно, чтобы не обнулять вас на входе. Дальше можем вести в практический этап.

Readout:

- Why included: borderline but viable candidate who needs probing
- What to inspect in V2: whether the bot separates hard must-haves from exploratory follow-ups, then actually sends the practical assignment and detects the returned solution without losing context

#### Георгий Андронов

- status: SCREENING
- bucket: hidden_from_resume
- must_haves_from_resume: 0
- summary: ## Георгий Андронов ### Must-haves - Китайский язык: + native (владею китайским) - WeChat: ? не выяснено - Опыт 1688.com: ? не выяснено ### Key Info - Товарные категории: ? не выяснено - Объёмы закупок: ? не выяснено - Опыт отсрочек/условий оплаты: ? не выясн…
- resume signal: Name: Андронов Георгий Викторович Title: Менеджер по закупкам Location: Китай Age: 22 Total experience: 6y 3m --- Experience --- • Переводчик и консультант российского направления @ Юридическая компания “Shanghai Nodi Law Firm” , Шанхай (2023-04-01 – present) - Перевод юридических документов (контр…

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 70/100 (yes) — The candidate has a solid background in procurement and logistics with relevant experience managing international supplies and negotiations with Chinese suppliers. They possess a…
- **recruiter**: [HH.ru] Привет, Георгий! Рад, что вы откликнулись на позицию менеджера по закупкам. Давайте обсудим, как у вас сложился опыт работы с китайскими фабриками.
- **candidate**: Здравствуйте, мне сейчас в чате рассказать или мы наметим собеседование и на нем все обсудим?
- **recruiter**: [HH.ru] Привет, Георгий! Рад, что вы с нами. Владеете ли вы китайским языком? Если да, есть ли у вас свой аккаунт WeChat? Активно ли пользуетесь? Расскажите, пожалуйста, о своем опыте работы с 1688.com и с какими фабрик…
- **candidate**: Хорошо, я вам сегодня напиши о своем опыте, я владею китайским, вичат есть, живу в Китае с детства уже 16 лет
- **recruiter**: [HH.ru] Привет, Георгий! Замечательно, что вы так долго прожили в Китае и владеете языком. Расскажите, пожалуйста, о своем опыте работы с 1688.com: с какими фабриками работали, какие товарные категории вас интересовали,…

Projected V2 dialog:

- **recruiter**: Георгий, по резюме не все видно, поэтому коротко соберу missing pieces: уровень китайского, WeChat, 1688, товарные категории и был ли опыт переговоров по браку/срокам.
- **candidate**: Китайский intermediate, WeChat есть, 1688 использовала. Работала по одежде и спортивным товарам, обсуждала сроки и претензии по качеству с фабриками.
- **recruiter**: Отлично. Тогда по сути роль такая: удаленно берем на себя весь контур коммуникации с китайскими фабриками для бренда детской одежды на WB, собственники хотят снять это с себя.
- **candidate**: Мне это близко. Если дальше будет практическое, я готова.
- **recruiter**: Да, после короткого Q&A дадим небольшой практический кейс по поиску фабрики и сообщению поставщику. Если вам ок, я сразу пришлю ссылку.
- **candidate**: Да, присылайте.
- **recruiter**: Тогда отправляю практическое задание: https://docs.google.com/document/d/example-china-test/edit. На выполнение обычно нужно 1-1.5 часа, дедлайн 3 рабочих дня. Если понадобится запас по времени, просто напишите.
- **candidate**: Сделала и отправляю решение: https://docs.google.com/document/d/example-china-solution/edit. Внутри расчет и текст сообщения фабрике на китайском.
- **recruiter**: Получил, спасибо. Передам команде и вернусь с обратной связью.

Readout:

- Why included: resume under-signals fit, relevance appears after follow-up
- What to inspect in V2: whether the bot separates hard must-haves from exploratory follow-ups, then actually sends the practical assignment and detects the returned solution without losing context

#### Валентина Воробьева

- status: SCREENING_NO_RESPONSE
- bucket: weak_or_risky
- must_haves_from_resume: 1
- summary: ## Валентина Воробьева ### Must-haves - Китайский язык: ❌ none (не знаю,нет) - WeChat: ❓ не выяснено - Опыт 1688.com: ✅ true (у меня есть опыт ведения с китайскими фабриками) ### Key Info - Товарные категории: Food, Non food, текстиль, спорттовары, одежда - О…
- resume signal: Name: Воробьева Валентина Евгеньевна Title: Руководитель закупки,e-commerce ,снабжение ,ВЭД, импорт , продакт ,логистика , маркетплейсы, туризм. Location: Москва Age: 38 Total experience: 21y 1m Desired salary: 150000 RUR --- Experience --- Руководитель по развитию и закупкам интернет-магазинов зар…

Legacy dialog snippet:

- **system**: [HH.ru] Resume evaluated: 45/100 (no) — The candidate lacks critical must-haves such as an active WeChat account, experience with 1688.com or similar B2B platforms, and business-level Chinese language skills. Additional…
- **recruiter**: [HH.ru] Валентина Воробьева, Спасибо, что подали заявку на позицию "Менеджер по закупкам Китай". Я внимательно изучил ваше резюме и заметил некоторые моменты, которые не совпадают с требованиями должности. У вас отсутст…
- **candidate**: Добрый день , прошу рассмотреть мое резюме . Готова предложить сотрудничество с вашей компанией , возможно мой опыт будет вам полезен и интересен ? Знаю итальянский, Английский и др.языки. Работала с разными категориями…
- **candidate**: Добрый день , у меня есть опыт ведения с китайскими фабриками , это прописано в том числе в сопроводительном. И с этим сайтом есть опыт , все написать в сопроводительном письме невозможно.
- **candidate**: С Китайцами я прекрасно общаюсь и на Английском.
- **system**: [HH.ru] Re-evaluated after clarification: 75/100 (yes) — The candidate has extensive experience in procurement and has worked with international suppliers, which is a strong fit for the role. However, there is not enoug…

Projected V2 dialog:

- **recruiter**: Валентина, уточню ключевые вещи: есть ли ваш WeChat, опыт работы с 1688 и деловая переписка с китайскими фабриками?
- **candidate**: С фабриками общалась, но китайский не знаю и WeChat не веду постоянно. 1688 открывала, но не работала системно.
- **recruiter**: Понял. Для этой роли это критично уже на входе, поэтому здесь будет слишком большой разрыв. Остановлю процесс на этом этапе.

Readout:

- Why included: stress case for rejection, ambiguity or went-dark behavior
- What to inspect in V2: whether the bot separates hard must-haves from exploratory follow-ups, then actually sends the practical assignment and detects the returned solution without losing context

## Job 26: Менеджер по продажам (B2B, Сколково)

- slug: `sales-skolkovo-2026`
- interview_language: ru
- closing_type: wait
- screening_enabled: 1
- hh_sync_enabled: 1
- follow_up_persistence: 1

### Current Legacy Intent

- practical_q: Расскажите пример успешной сделки, где вы начинали коммуникацию с самого начала
- theory_q1: Какие навыки, на ваш взгляд, нужны менеджеру по продажам?
- must_have_prompt: 

### Parsed Goals

- Goal 1: Скрининг
  - Проверь резюме и отметь что уже видно (B2B опыт, холодные звонки, удалёнка). Не спрашивай повторно то что ясно из резюме. Задай только недостающее одним сообщением из списка: опыт B2B-продаж / работы с корпоративными кл…
  - Если кандидат явно не подходит (хочет только оклад, только офис, нет релевантного опыта) — вежливо завершить диалог
- Goal 2: Условия работы
  - Расскажи условия: задача — прозвон и переписка с участниками Сколково (~300 контактов в неделю), поиск ЛПР и передача эксперту Михаилу
  - KPI: встреча Zoom/офлайн — 4 000 ₽, Telegram ЛПР с диалогом — 5 000 ₽, Telegram ЛПР без диалога — 1 000 ₽
  - Испытательный срок: 1 неделя, фиксированные 10 000 ₽ в любом случае независимо от результата
  - Инструменты предоставляем: телефония Манго Телеком, Google Sheets, ИИ-инструменты
- Goal 3: Передача контакта
  - Кандидат готов → отправь: "Напишите руководителю в Telegram: @kobzevvv — он расскажет следующие шаги"
  - Отправить @kobzevvv в любом случае если кандидат дошёл до этого шага

### Evaluation Set

#### Ирина Мишустина

- status: SCREENING
- bucket: medium
- must_haves_from_resume: 0
- summary: ## Candidate Summary: Ирина Мишустина ### Must-haves - нет инфы: ❓ unknown ### Key Info - Salary expectations: 80000 RUR - Location/relocation: Белгород - Notice period: нет инфы - Languages: Русский: Родной - Motivation: нет инфы - B2B sales experience: 6+ y…
- resume signal: Name: Мишустина Ирина Михайловна Title: Персональный менеджер/Менеджер по продажам Location: Белгород Age: 35 Total experience: 9y 0m Desired salary: 80000 RUR --- Experience --- Менеджер по продажам @ ООО "ЯНДЕКС" (Яндекс.Бизнес/Яндекс.Директ) (2023-08-01 – 2025-01-01) Холодные звонки клиентам с п…

Legacy dialog snippet:

- **recruiter**: [HH.ru] Ирина Мишустина, Отлично, что у Вас есть такое четкое понимание важности аналитики и метрик. Расскажу о задаче: на неделю даём 300 контактов участников Сколково для проработки (можем дать больше, если закончатся…
- **candidate**: Добрый день! У меня есть опыт работы в B2B продажах (более 6 лет работы) в разных сферах деятельности (холодные продажи, полный цикл сделки). Также есть желание получить новый опыт и прокачать свои навыки Продажника!) Б…
- **recruiter**: [HH.ru] Ирина Мишустина, Замечательно, что у Вас уже есть такой солидный опыт в B2B продажах и желание развиваться дальше! Это очень ценно. Расскажу подробнее о задаче: мы предоставляем 300 контактов участников Сколково…
- **candidate**: Я поняла,как можно на собеседование попасть?)
- **recruiter**: [HH.ru] Ирина Мишустина, здравствуйте! Чтобы попасть на собеседование, мы сначала проходим этап тестирования. Вы готовы начать с него? Vladimir
- **candidate**: Да, какое именно?

Projected V2 dialog:

- **recruiter**: Ирина, вижу общий sales background. Уточните, пожалуйста: были ли именно B2B-продажи, холодные звонки и работа с корпоративными клиентами?
- **candidate**: B2B был частично, холодные звонки тоже, но не на 100% рабочего времени. С корпоративными клиентами работал.
- **recruiter**: Понял. Тогда кратко расскажу формат и попрошу оценить, насколько это вам подходит по нагрузке и KPI.
- **recruiter**: На старте это активный outbound по базе Сколково, около 300 контактов в неделю, основной фокус на вывод в Zoom и Telegram-диалог с ЛПР.
- **candidate**: Если будет понятная система и адекватный объем, звучит рабоче.
- **recruiter**: Тогда можно двигаться дальше и передавать вас на прямой контакт с руководителем.

Readout:

- Why included: borderline but viable candidate who needs probing
- What to inspect in V2: whether the bot skips obvious resume facts, explains compensation clearly and hands off to Telegram without over-screening

#### Светлана Пироженко

- status: SCREENING
- bucket: medium
- must_haves_from_resume: 0
- summary: ## Candidate Summary: Светлана Пироженко ### Must-haves - : ❓ unknown ### Key Info - Salary expectations: 2000000 RUR - Location/relocation: Тамбов - Notice period: нет инфы - Languages: нет инфы - Motivation: нет инфы - Telegram: @SvetlanaSVETBU - WhatsApp: …
- resume signal: Name: Пироженко Светлана Анатольевна Title: Директор по Маркетингу, PR, Амбассадор Location: Тамбов Age: 37 Total experience: 10y 7m Desired salary: 2000000 RUR --- Experience --- Аналитик, PR @ https://svetbusiness.ru/ (2020-11-07 – present) Виды деятельности: 82.99 Деятельность по предоставлению …

Legacy dialog snippet:

- **recruiter**: [HH.ru] Светлана Пироженко, добрый день! Спасибо за ваш интерес к нашей вакансии. Чтобы я мог лучше понять ваш опыт, подскажите, пожалуйста, есть ли у Вас опыт B2B-продаж или продаж в сфере юридических услуг/консалтинга…
- **candidate**: +79050857140 ватсап @SvetlanaSVETBU телеграм
- **recruiter**: [HH.ru] Светлана Пироженко, спасибо за информацию. Я вижу, что вы указали контакты для связи. Теперь давайте перейдем к следующему этапу. Расскажите, пожалуйста, как бы вы подошли к задаче: на неделю вам дается 300 конт…

Projected V2 dialog:

- **recruiter**: Светлана, вижу общий sales background. Уточните, пожалуйста: были ли именно B2B-продажи, холодные звонки и работа с корпоративными клиентами?
- **candidate**: B2B был частично, холодные звонки тоже, но не на 100% рабочего времени. С корпоративными клиентами работал.
- **recruiter**: Понял. Тогда кратко расскажу формат и попрошу оценить, насколько это вам подходит по нагрузке и KPI.
- **recruiter**: На старте это активный outbound по базе Сколково, около 300 контактов в неделю, основной фокус на вывод в Zoom и Telegram-диалог с ЛПР.
- **candidate**: Если будет понятная система и адекватный объем, звучит рабоче.
- **recruiter**: Тогда можно двигаться дальше и передавать вас на прямой контакт с руководителем.

Readout:

- Why included: borderline but viable candidate who needs probing
- What to inspect in V2: whether the bot skips obvious resume facts, explains compensation clearly and hands off to Telegram without over-screening

#### Артем Тяпкин

- status: SCREENING
- bucket: hidden_from_resume
- must_haves_from_resume: 0
- summary: ## Краткая информация о кандидате: Артем Тяпкин ### Обязательные требования - Опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга: ✅ подтверждено (Опыт более 3 лет в B2B продажах IT-продуктов и юридических услуг) ### Ключевая информация - Ожида…
- resume signal: Name: Тяпкин Артем Игоревич Title: Менеджер по продажам Location: Краснодар Age: 26 Total experience: 3y 7m Desired salary: 160000 RUR --- Experience --- Менеджер по продажам IT - продуктов @ Медиагруппа «Актион-МЦФЭР» (2024-01-01 – 2025-11-01) Основные обязанности: Поиск и привлечение новых клиент…

Legacy dialog snippet:

- **recruiter**: [HH.ru] Здравствуйте, Артем Тяпкин! Хотел бы перейти к следующему этапу. Мы даем кандидатам на неделю 300 контактов участников Сколково для проработки. Скажите, как бы Вы подошли к этой задаче, и сколько примерно контак…
- **candidate**: Добрый день, буду рад сотрудничать
- **recruiter**: [HH.ru] Здравствуйте, Артем Тяпкин! Вы уже выразили готовность к сотрудничеству, это отлично. Теперь хотелось бы узнать подробнее о Вашем подходе к задаче проработки контактов. Как Вы видите этот процесс, и какой объем …
- **recruiter**: [HH.ru] Сорри, подключал тут сервис авторазбора, чего-то он не очень сработал. Глянул ваш профиль — в целом кажется очень релевантно. Напишите мне в телеграм @kobzevvv, давайте сегодня/завтра свяжемся. Владимир
- **candidate**: Давайте завтра
- **recruiter**: [HH.ru] Артем Тяпкин, здравствуйте! Отлично, договорились на завтра. Пока мы ждем, хотел бы уточнить пару моментов по вашему опыту. Было бы интересно узнать, как вы обычно подходите к оценке эффективности проработки кон…

Projected V2 dialog:

- **recruiter**: Артем, по резюме вижу продажи, но не все детали очевидны. Подскажите одним сообщением: был ли B2B, были ли холодные звонки и комфортен ли удаленный формат с KPI + небольшим фиксированным стартом?
- **candidate**: Да, B2B был. Я продавал IT-продукты корпоративным клиентам, сам выходил на ЛПР через холодные звонки и переписку. Удаленка ок, если экономика прозрачная.
- **recruiter**: Тогда коротко про условия: на неделю даем около 300 контактов Сколково, задача найти ЛПР и передать заинтересованных Михаилу. KPI: Zoom/офлайн-встреча 4000 ₽, Telegram ЛПР с диалогом 5000 ₽, без диалога 1000 ₽. Стартовая неделя с фиксированными 10 000 ₽ в любом случае.
- **candidate**: Такой формат понятен. Если будет скрипт и телефония, мне интересно.
- **recruiter**: Да, телефония и таблицы даем. Тогда следующий шаг такой: напишите руководителю в Telegram @kobzevvv, он расскажет детали запуска.

Readout:

- Why included: resume under-signals fit, relevance appears after follow-up
- What to inspect in V2: whether the bot skips obvious resume facts, explains compensation clearly and hands off to Telegram without over-screening

#### Анастасия Маленёва

- status: SCREENING
- bucket: weak_or_risky
- must_haves_from_resume: 0
- summary: ## Candidate Summary: Анастасия Маленёва ### Must-haves - Есть ли у вас опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга?: ❌ нет ### Key Info - Salary expectations: 100000 RUR - Location/relocation: Саратов - Notice period: нет инфы - Langua…
- resume signal: Name: Маленёва Анастасия Title: Оператор call-центра Location: Саратов Age: 41 Total experience: 0y 4m Desired salary: 100000 RUR --- Experience --- Визовый менеджер @ Единый Визовый Центр (2021-06-01 – 2021-09-01) Лидогенерация. Входящие (90%) исходящие (10%) звонки (горячая/ тёплая база). Работа …

Legacy dialog snippet:

- **recruiter**: [HH.ru] Анастасия Маленёва, здравствуйте! У меня следующий вопрос: есть ли у Вас опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга? Vladimir
- **candidate**: Добрый день! Меня зовут Анастасия. У меня есть коммерческое предложение по расширению вашего бизнеса! Вам нужен продуктивный, качественный и высококвалифицированный персонал? Не проблема! У нас имеется готовая горячая б…
- **recruiter**: [HH.ru] Анастасия Маленёва, добрый день! Вижу, Вы предлагаете услуги по подбору персонала. Это интересно. Уточните, пожалуйста, Вы готовы ответить на мои вопросы касательно Вашего опыта? Первый вопрос: есть ли у Вас опы…

Projected V2 dialog:

- **recruiter**: Анастасия, добрый день. Подскажите, был ли у вас реальный опыт B2B-продаж с корпоративными клиентами и холодными звонками?
- **candidate**: Скорее нет, у меня больше общий клиентский сервис и немного лидогенерации. Хотелось бы попробовать продажи полноценно.
- **recruiter**: Понял. Для этой роли нужен уже подтвержденный опыт B2B и уверенная работа с холодным выходом на ЛПР. По этой вакансии дальше не пойдем, но профиль могу сохранить на более мягкие роли.

Readout:

- Why included: stress case for rejection, ambiguity or went-dark behavior
- What to inspect in V2: whether the bot skips obvious resume facts, explains compensation clearly and hands off to Telegram without over-screening

#### Михаил Иванкевич

- status: SCREENING
- bucket: hidden_from_resume
- must_haves_from_resume: 0
- summary: ## Краткая информация о кандидате: Михаил Иванкевич ### Обязательные требования - Требование: ✅ подтверждено (опыт B2B продаж в IT и финтех, работа с SaaS-решениями, привлечение клиентов SMB) ### Ключевая информация - Ожидания по зарплате: 100 000 RUR - Место…
- resume signal: Name: Иванкевич Михаил Николаевич Title: Менеджер по продажам Location: Калининград Age: 43 Total experience: 4y 8m Desired salary: 100000 RUR --- Experience --- Менеджер по продажам @ Портал Где этот дом (2025-06-01 – present) Ключевые обязанности и достижения: Поиск и привлечение корпоративных кл…

Legacy dialog snippet:

- **recruiter**: [HH.ru] Здравствуйте, Михаил Иванкевич! Чтобы лучше понять ваш опыт, подскажите, пожалуйста: есть ли у вас опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга?
- **recruiter**: [HH.ru] Сорри, подключал тут сервис авторазбора, чего-то он не очень сработал. Глянул ваш профиль — в целом кажется очень релевантно. Напишите мне в телеграм @kobzevvv, давайте сегодня/завтра свяжемся. Владимир
- **candidate**: Телеграмм не работает (
- **recruiter**: [HH.ru] Здравствуйте, Михаил Иванкевич! Очень жаль, что телеграм не работает. Надеюсь, скоро получится наладить связь. Great question! Let me check with the team and get back to you on that.

Projected V2 dialog:

- **recruiter**: Михаил, по резюме вижу продажи, но не все детали очевидны. Подскажите одним сообщением: был ли B2B, были ли холодные звонки и комфортен ли удаленный формат с KPI + небольшим фиксированным стартом?
- **candidate**: Да, B2B был. Я продавал IT-продукты корпоративным клиентам, сам выходил на ЛПР через холодные звонки и переписку. Удаленка ок, если экономика прозрачная.
- **recruiter**: Тогда коротко про условия: на неделю даем около 300 контактов Сколково, задача найти ЛПР и передать заинтересованных Михаилу. KPI: Zoom/офлайн-встреча 4000 ₽, Telegram ЛПР с диалогом 5000 ₽, без диалога 1000 ₽. Стартовая неделя с фиксированными 10 000 ₽ в любом случае.
- **candidate**: Такой формат понятен. Если будет скрипт и телефония, мне интересно.
- **recruiter**: Да, телефония и таблицы даем. Тогда следующий шаг такой: напишите руководителю в Telegram @kobzevvv, он расскажет детали запуска.

Readout:

- Why included: resume under-signals fit, relevance appears after follow-up
- What to inspect in V2: whether the bot skips obvious resume facts, explains compensation clearly and hands off to Telegram without over-screening

#### Зинаида  Лукьяненко

- status: SCREENING
- bucket: hidden_from_resume
- must_haves_from_resume: 0
- summary: ## Candidate Summary: Зинаида Лукьяненко ### Must-haves - Есть ли у вас опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга?: ✅ confirmed (Менеджер по оптовым продажам @ ООО "Комплексные решения", Менеджер по продажам @ Обои – опыт B2B продаж) …
- resume signal: Name: Лукьяненко Зинаида Александровна Title: Менеджер по продажам Location: Волгоград Age: 38 Total experience: 11y 2m Desired salary: 100000 RUR --- Experience --- Менеджер по оптовым продажам @ ООО "Комплексные решения" (2023-06-01 – present) - Ведение клиентской базы - Проведение телефонных зво…

Legacy dialog snippet:

- **recruiter**: [HH.ru] Зинаида Лукьяненко, спасибо за подробный ответ. Теперь давайте перейдем к сути задачи. Мы даем 300 контактов участников Сколково на неделю для проработки (можем дать больше, если эти закончатся). Vladimir
- **candidate**: Ок, дальше какие действия
- **recruiter**: [HH.ru] Зинаида Лукьяненко, отлично, давайте двигаться дальше! Мы предоставляем телефонию для вашей работы. Сервис сейчас находится в тестовом режиме, но уже показывает отличные результаты: 4 из 23 контактов продолжили …
- **candidate**: Что по ЗП?
- **candidate**: Что по ЗП?
- **recruiter**: [HH.ru] Зинаида Лукьяненко, отличный вопрос! К сожалению, информация о заработной плате пока не представлена в нашей базе знаний. Я уточню этот момент с командой и обязательно вернусь к Вам с ответом. Есть ли у Вас еще …

Projected V2 dialog:

- **recruiter**: Зинаида, по резюме вижу продажи, но не все детали очевидны. Подскажите одним сообщением: был ли B2B, были ли холодные звонки и комфортен ли удаленный формат с KPI + небольшим фиксированным стартом?
- **candidate**: Да, B2B был. Я продавал IT-продукты корпоративным клиентам, сам выходил на ЛПР через холодные звонки и переписку. Удаленка ок, если экономика прозрачная.
- **recruiter**: Тогда коротко про условия: на неделю даем около 300 контактов Сколково, задача найти ЛПР и передать заинтересованных Михаилу. KPI: Zoom/офлайн-встреча 4000 ₽, Telegram ЛПР с диалогом 5000 ₽, без диалога 1000 ₽. Стартовая неделя с фиксированными 10 000 ₽ в любом случае.
- **candidate**: Такой формат понятен. Если будет скрипт и телефония, мне интересно.
- **recruiter**: Да, телефония и таблицы даем. Тогда следующий шаг такой: напишите руководителю в Telegram @kobzevvv, он расскажет детали запуска.

Readout:

- Why included: resume under-signals fit, relevance appears after follow-up
- What to inspect in V2: whether the bot skips obvious resume facts, explains compensation clearly and hands off to Telegram without over-screening

## What To Review First

- job 26 hidden-from-resume cases: Артем Тяпкин, Михаил Иванкевич, Зинаида Лукьяненко
- job 9 false-negative risk: Marlen Derdarov and Валентина Воробьева
- job 4 borderline craft cases: Юлия Юринская and Екатерина Камышникова

## Appendix: Candidate-Initiated Exit

- Legacy anchor: старая система уже умела завершать ветку по reject_when и не пушить кандидата дальше, если он сам явно отказывается от вакансии или процесса.
- Это не часть job-specific goals steps. Это cross-cutting branch поверх любого flow: screening, AI interview, homework, final handoff.

| case | confidence band | detect signal | assistant action | candidate-facing script |
|---|---|---|---|---|
| hard_refusal | > 0.90 | Явный отказ от вакансии или дальнейшего общения: «неинтересно», «неактуально», «не рассматриваю», «не нужно писать», «не готов продолжать», «снимите с процесса». | Прекратить активный flow, не слать follow-up, ответить коротким acknowledgement. | Понял, спасибо, что уделили время. Удачи вам. |
| likely_refusal_needs_confirmation | 0.75 - 0.90 | Сильный негативный сигнал, но возможна двусмысленность: «мне, наверное, не подойдет», «скорее не готов», «китайский слабый, думаю смысла нет», «вряд ли потяну». | Не продавливать следующий этап. Один раз мягко уточнить, верно ли понят отказ, и при подтверждении закрыть ветку. | Верно ли я понял, что по этой вакансии вы не хотите двигаться дальше? Если да, тогда просто закрою процесс. Если речь только о конкретном этапе, могу учесть это и не пушить лишнее. |
| contextual_exit_without_weird_reopen | context-sensitive | Причина отказа сама исключает welcome-back CTA: например, кандидат не знает китайский для роли, где китайский обязателен. | Не писать шаблонное «если передумаете — возвращайтесь», если это звучит странно или противоречит причине отказа. | Понял, спасибо за честный ответ. Для этой роли это действительно критично, поэтому на этом остановимся. |

### Test Dialogs

- Hard refusal, stop messaging
- **candidate**: Спасибо, но вакансия уже неактуальна. Пожалуйста, дальше по ней мне не пишите.
- **recruiter**: Понял, спасибо, что написали. Удачи вам.

- Likely refusal, clarify once
- **candidate**: Если честно, с китайским у меня слабовато. Думаю, я не подойду и, наверное, не стоит продолжать.
- **recruiter**: Верно ли я понял, что по этой вакансии вы не хотите двигаться дальше? Если да, тогда просто закрою процесс без лишних сообщений.
- **candidate**: Да, лучше остановиться на этом этапе.
- **recruiter**: Понял, спасибо за честный ответ. Для этой роли китайский действительно критичен, поэтому на этом остановимся.

## Next Step

- connect a real model key and rerun this evaluation with actual generated V2 dialogs instead of projections