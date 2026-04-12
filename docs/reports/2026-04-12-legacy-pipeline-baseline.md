# Legacy Pipeline Baseline

Date: 2026-04-12

Source DB: legacy routing schema from sibling `recruiting-agent`
Compared session: `c3835db7-34bc-46a3-93a1-e64f06f0d4a3`

## Scope

Chosen legacy vacancies with real pipeline settings:
- job_id=4, slug=`wb-card-designer-1`, title=Дизайнер карточек для маркетплейсов (Wildberries)
- job_id=9, slug=`galyamina-zakupki-china-2026-03`, title=Менеджер по закупкам Китай
- job_id=26, slug=`sales-skolkovo-2026`, title=Менеджер по продажам (B2B, Сколково)

## Session Compare

- project_path: `/Users/vova/Documents/GitHub/recruiting-agent`
- messages_total: 73
- first user prompt: по вакансии: job_id 26, slug sales-skolkovo-2026, HH вакансия 132032392 мы очень плохо сработали. -- задача. давай отберем максимально релеватных кандидатов и напишем им. «Сорри, подключал тут сервис авторазбора, чето он не очень сработал, напишите пожалуйста мне в телеграм @kob…
- first assistant content: The user wants to: 1. Find the most relevant candidates for job_id=26 (sales-skolkovo-2026, HH vacancy 132032392) 2. Send them a message apologizing for the auto-parsing service not working well 3. Ask them to write in Telegram @kobzevvv 4. Mention that their profile looks relev…

## Job 4: Дизайнер карточек для маркетплейсов (Wildberries)

- slug: `wb-card-designer-1`
- interview_language: ru
- interviewer_name: Владимир
- closing_type: homework
- screening_enabled: 1
- hh_sync_enabled: 0
- follow_up_persistence: 1

### Interview Prompts

- practical_q: Расскажите про карточку товара на маркетплейсе, которой вы особенно гордитесь. Что именно вы в ней сделали и какой результат получили по метрикам?
- practical_f1: Как вы определяли, какой элемент карточки тестировать в первую очередь?
- practical_f2: Был ли случай, когда ваша гипотеза не подтвердилась? Что вы сделали после этого?
- theory_q1: Вам дали карточку бижутерии с низким показателем кликабельности. Какие элементы главного слайда вы бы проверили в первую очередь и почему?
- theory_f1: Как бы вы определили, что тест дал статистически значимый результат, а не случайное колебание?
- theory_q2: Как вы подходите к созданию продающего визуала украшений — какие приёмы обработки фото и композиции считаете ключевыми?
- theory_f2: Как вы используете нейросети в работе с карточками и в каких задачах они дают наибольший эффект?

### Must-Haves

```text
Подтвердите, пожалуйста, несколько моментов: 1. Есть ли у вас опыт создания карточек для маркетплейсов (Wildberries, Ozon)? (да/нет) 2. Можете ли вы поделиться портфолио с карточками для маркетплейсов? (да/нет) 3. Есть ли опыт профессиональной обработки фото — ретушь, цветокоррекция, работа с бликами металла и камней? (да/нет) 4. Работали ли вы с ИИ-инструментами для генерации и замены фонов? (да/нет) 5. Есть ли опыт тестирования визуальных гипотез (A/B тесты карточек)? (да/нет) 6. Какие у вас зарплатные ожидания? (бюджет вакансии 100–125 тыс. ₽)
```

### Parsed Pipeline Goals

- Goal 1: Intro [pending]
  - [pending] Tell: Привет! Спасибо за отклик. У меня несколько вопросов про ваш опыт — можно ответить на все сразу одним сообщением, а можно по одному. Как удобнее?
- Goal 2: Screening [pending]
  - [pending] Опыт с маркетплейсами: делали ли карточки для WB/Ozon? Сколько примерно? Ссылка на портфолио (Telegram, Behance, Google Drive — любой формат)
  - [pending] Обработка фото и ИИ: есть ли опыт ретуши, цветокоррекции, работы с бликами металла/камней? Работали ли с ИИ-инструментами для генерации фонов?
  - [pending] Тестирование гипотез: есть ли опыт A/B тестирования карточек? Как измеряли результат?
  - [pending] Метрики и аналитика: какие метрики эффективности карточки отслеживаете? (CTR, конверсия в корзину, конверсия в заказ) Знаете ли где в кабинете WB их смотреть?
  - [pending] Структура карточки: есть ли у вас понимание о структуре карточки на WB с точки зрения представления продукта и маркетинга? Можете коротко рассказать об основной структуре — какие слайды за что отвечают?
  - [pending] Условия: зарплатные ожидания? (ориентир 100–125 тыс. руб.)
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

### Candidate Sample

- Анна Патык [INTERVIEW_OFFERED] bucket=strong must_haves_from_resume=1 messages=13
  - summary: 
  - resume: Name: Патык Анна Вячеславовна Title: Графический дизайнер (SMM, рекламные кампании, иллюстрация) Location: Красноярск Age: 33 Total experience: 8y 9m --- Experience --- Дизайнер SMM, Художник-иллюстратор @ Ценалом, Дискаунтер техники и товаров для дома (2019-…
- Елизавета Полозова [SCREENING_DONE] bucket=strong must_haves_from_resume=1 messages=3
  - summary: 
  - resume: Name: Полозова Елизавета Дмитриевна Title: Графический дизайнер Location: Екатеринбург Age: 20 Desired salary: 50000 RUR --- Languages --- Русский: Родной --- Skills --- Исполнительность --- Additional skills --- Здравствуйте! Имею практический опыт работы с …
- Федор Катавилов [SCREENING] bucket=medium must_haves_from_resume=0 messages=9
  - summary: ## Федор Катавилов ### Must-haves - Опыт маркетплейсов: + Я создал свои объявления на авито на услугу по созданию инфографики для маркетплейсов. Мне писали люди, я помогал с созданием ТЗ, если у человека его не было, ан…
  - resume: Name: Катавилов Федор Сергеевич Title: Дизайнер инфографики для маркетплейсов Location: Москва Age: 20 Total experience: 1y 1m Desired salary: 45000 RUR --- Experience --- Дизайнер инфографики @ Авито (2024-11-01 – 2025-11-01) Я создал свои объявления на авит…
- Юлия Юринская [SCREENING] bucket=medium must_haves_from_resume=0 messages=14
  - summary: ## Юлия Юринская ### Must-haves - Опыт маркетплейсов: + да (Карточками для озон и вб занимаюсь уже около 2х лет) - Photoshop: + confident (на среднем уровне) - Портфолио: ? не выяснено ### Key Info - Figma: + confident …
  - resume: Name: Юринская Юлия Васильевна Title: Дизайнер инфографики для маркетплейсов Location: Иркутск Age: 29 Total experience: 1y 11m Desired salary: 40000 RUR --- Experience --- Дизайнер инфографики @ Индивидуальное предпринимательство / частная практика / фриланс…
- Екатерина Камышникова [SCREENING] bucket=hidden_from_resume must_haves_from_resume=0 messages=1
  - summary: ## Candidate Summary: Екатерина Камышникова ### Must-haves - Опыт работы с маркетплейсами (Wildberries, Ozon, Amazon) — ❓ unknown - Владение Adobe Photoshop и/или Figma — ✅ confirmed (работа в Adobe Photoshop и Figma) -…
  - resume: Name: Камышникова Екатерина Title: Веб-дизайнер/графический дизайнер Location: Москва Age: 28 Total experience: 3y 4m --- Experience --- Дизайнер-художник @ С-Маркет (2024-01-01 – present) Создание графики и визуальных материалов: баннеры, постеры, карточки т…
- Rafik Musaev [SCREENING_went_dark_2_time] bucket=weak_or_risky must_haves_from_resume=0 messages=7
  - summary: ## Candidate Summary: Rafik Musaev ### Must-haves - : ❓ unknown ### Key Info - Salary expectations: 500 USD - Location/relocation: Самарканд - Notice period: нет инфы - Languages: Русский (родной), Английский (B2) - Mot…
  - resume: Name: Musaev Rafik Title: Средний специалист Location: Самарканд Desired salary: 500 USD --- Languages --- Русский: Родной Английский: B2 — Средне-продвинутый --- Skills --- Деловое общение, Активные продажи, Обучение и развитие, Электронная почта --- Additio…

### Dialog Examples

- [Елизавета Полозова] system: [HH.ru] Resume evaluated: 72/100 (yes) — The candidate has practical experience with marketplaces such as Wildberries and Ozon and has skills relevant to the job description, such as photo preparation and SEO text writi…
- [Елизавета Полозова] system: [HH.ru] Must-haves auto-confirmed from resume: The candidate meets all must-have requirements with experience in marketplaces and skills in Adobe Photoshop.
- [Елизавета Полозова] outgoing: [HH.ru] Елизавета Полозова, Я ознакомился с вашим резюме, и у меня нет дополнительных вопросов — все выглядит отлично. Есть ли у вас вопросы о должности, компании или условиях работы? С уважением, Владимир
- [Федор Катавилов] system: [HH.ru] Resume evaluated: 68/100 (maybe) — The candidate has relevant experience in creating infographics for marketplaces and demonstrates adaptability to different design tasks. However, with only 1 year of experience…
- [Федор Катавилов] outgoing: [HH.ru] Федор Катавилов, спасибо за ваши разъяснения. Теперь ваша очередь — есть ли у вас вопросы о роли, компании или условиях? Буду рад ответить! Владимир
- [Федор Катавилов] system: [HH.ru] Resume evaluated: 75/100 (yes) — The candidate demonstrates strong relevant skills and practical experience in marketplace infographic design, directly aligning with the job description. While their experience i…
- [Федор Катавилов] outgoing: [HH.ru] Привет, Федор Катавилов! Спасибо за отклик. У меня есть несколько вопросов по вашему опыту — можно ответить на все сразу одним сообщением, а можно по одному. Как вам удобнее? Владимир
- [Анна Патык] system: [HH.ru] Resume evaluated: 72/100 (yes) — The candidate possesses solid graphics design experience and skills that align with the job requirements for designing marketplace cards. They have extensive experience in commer…

## Job 9: Менеджер по закупкам Китай

- slug: `galyamina-zakupki-china-2026-03`
- interview_language: zh
- interviewer_name: Владимир
- closing_type: homework
- screening_enabled: 1
- hh_sync_enabled: 0
- follow_up_persistence: 1

### Interview Prompts

- practical_q: 请举一个你选择供应商的例子。是什么产品，遇到了哪些困难，最终找到了什么？做了哪些妥协？
- practical_f1: 请讲一个工厂在交期或质量上出问题的情况。你是怎么处理的？
- theory_q1: 当你第一次联系新工厂时，在下第一个订单前你具体检查什么？
- theory_f1: 有没有遇到过检查了但工厂还是不靠谱的情况？
- theory_q2: 你在与中国工厂合作中犯过的最大错误是什么？
- theory_f2: 这个错误之后你改变了什么做法？

### Must-Haves

```text
Пожалуйста, подтвердите несколько моментов, прежде чем мы продолжим: 1. Есть ли у вас свой аккаунт WeChat? (да/нет) 2. Есть ли опыт работы с 1688.com? (да/нет) 3. Есть ли реальный опыт переписки/переговоров с китайскими фабриками? (да/нет) 4. Устроит ли оформление как самозанятость или ГПХ? (да/нет) 5. Зарплатные ожидания в диапазоне 125 000 – 150 000 ₽/мес (фикс + %) — подходит? (да/нет)
```

### Parsed Pipeline Goals

- Goal 1: Intro [pending]
  - [pending] Tell: привет! Меня зовут Владимир, я рекрутер. Спасибо за отклик на позицию менеджера по закупкам — работа с китайскими фабриками, удалённо
  - [pending] Tell: сначала я задам несколько вопросов о вашем опыте, потом расскажу подробнее о компании и роли, и вы сможете задать свои вопросы
- Goal 2: Screening [pending]
  - [pending] Владеете ли вы китайским языком? Если да — на каком уровне? (базовый/разговорный/деловая переписка/свободный)
  - [pending] Есть ли у вас свой аккаунт WeChat? Активно ли пользуетесь?
  - [pending] Есть ли опыт работы с 1688.com?
  - [pending] Расскажите коротко: с какими фабриками работали, какие товарные категории, какие объёмы?
  - [pending] Есть ли опыт обсуждения отсрочек и условий оплаты с фабриками?
  - [pending] Как решали ситуации с браком — был ли такой опыт?
- Goal 3: Commitment [pending]
  - [pending] Tell: компания — бренд детской одежды Home Style For You на Wildberries. 46 позиций, рейтинги 4.7-4.9, оборот 20-30 млн/мес
  - [pending] Tell: производство на фабриках в Китае. Сейчас собственники сами ведут всю коммуникацию, но с ростом бизнеса хотят передать это отдельному человеку
  - [pending] Tell: задача — полностью взять на себя работу с Китаем: поиск фабрик, переговоры, контроль производства, работа с браком. Маркетплейсом занимаются собственники
  - [pending] Tell: удалёнка, гибкий график
  - [pending] Интересно ли вам такое направление? Есть ли вопросы на этом этапе?
- Goal 4: Candidate Q&A [faq] [pending]
  - [pending] Tell: если у вас есть вопросы о компании, роли или условиях — с удовольствием отвечу
  - [pending] Ответить на вопросы из FAQ
  - [pending] Когда вопросов нет — переход к следующему этапу
- Goal 5: AI Interview Invite [pending]
  - [pending] Tell: следующий шаг — короткое AI-интервью на КИТАЙСКОМ языке (3-5 минут). Это видеозвонок с AI-ассистентом, который задаст несколько вопросов на китайском по вашему опыту работы с фабриками. Понадобятся камер…
  - [pending] Tell: это помогает нам быстрее узнать кандидатов — не нужно подстраиваться под расписание
  - [pending] Спросить: готовы пройти сейчас, или есть вопросы?
  - [pending] Если кандидат согласен — ACTION: Send interview link
  - [pending] Если кандидат сомневается или отказывается — Tell: совершенно без проблем! Это необязательный этап. Перейдём сразу к практическому заданию
  - [pending] Если кандидат отказался от AI-интервью — пропустить Goal 6 и перейти к Goal 7
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
  - [pending] Tell: дедлайн — 3 рабочих дня. Если нужно больше времени — напишите
  - [pending] Confirm: кандидат подтвердил что будет выполнять тестовое задание (ответил что приступит, или задал уточняющие вопросы по заданию)
- Goal 8: Schedule Interview with Vladimir [pending]
  - [pending] Tell: финальный шаг — короткое интервью со мной (Владимир), примерно 15 минут. Я запишу звонок и передам нанимающему менеджеру. Запишитесь на удобное время: https://calendly.com/vladimir-skillset/30min
  - [pending] Спросить: есть ли вопросы перед интервью?
  - [pending] Подтверждение от кандидата что записался или планирует записаться

### Candidate Sample

- Marlen Derdarov [AI_INTERVIEW_SENT] bucket=strong must_haves_from_resume=1 messages=23
  - summary: ## Marlen Derdarov ### Must-haves - Китайский язык: + business (китайский язык HSK5) - WeChat: ? не выяснено - Опыт 1688.com: ? не выяснено ### Key Info - Товарные категории: ? не выяснено - Объёмы закупок: ? не выяснен…
  - resume: Name: Derdarov Marlen Title: Менеджер по ВЭД, переводчик Location: Бахчисарай Age: 37 Total experience: 11y 0m --- Experience --- менеджер ВЭД @ Джанкт систем (2025-05-01 – present) импорт микроэлектроники и оборудования из Китая для промышленных предприятий …
- Денис Шорохов [SCREENING_DONE] bucket=strong must_haves_from_resume=1 messages=7
  - summary: ## Денис Шорохов ### Must-haves - Китайский язык: ✅ fluent (уровне HSK-6) - WeChat: ❓ не выяснено - Опыт 1688.com: ❓ не выяснено ### Key Info - Товарные категории: нет инфы - Объёмы закупок: нет инфы - Опыт отсрочек/усл…
  - resume: Name: Шорохов Денис Вадимович Title: Менеджер по работе с партнерами Location: Москва Age: 23 Total experience: 1y 3m --- Experience --- Ассистент в отделе по международному сотрудничеству 国际学术交流合作部助理 @ Университет МГУ-ППИ в Шэньчжэне (2023-09-01 – 2024-04-01…
- Георгий Андронов [SCREENING] bucket=medium must_haves_from_resume=0 messages=52
  - summary: ## Георгий Андронов ### Must-haves - Китайский язык: + native (владею китайским) - WeChat: ? не выяснено - Опыт 1688.com: ? не выяснено ### Key Info - Товарные категории: ? не выяснено - Объёмы закупок: ? не выяснено - …
  - resume: Name: Андронов Георгий Викторович Title: Менеджер по закупкам Location: Китай Age: 22 Total experience: 6y 3m --- Experience --- • Переводчик и консультант российского направления @ Юридическая компания “Shanghai Nodi Law Firm” , Шанхай (2023-04-01 – present)…
- Вячеслав Фурсенко [SCREENING] bucket=medium must_haves_from_resume=0 messages=16
  - summary: ## Вячеслав Фурсенко ### Must-haves - Китайский язык: ? не выяснено - WeChat: + да (Конечно есть у меня WeChat с самого его начала) - Опыт 1688.com: + да (попробовал ещё с начала её создания) ### Key Info - Товарные кат…
  - resume: Name: Фурсенко Вячеслав Валерьевич Title: Коммерческий директор Location: Москва Age: 50 Total experience: 18y 11m Desired salary: 250000 RUR --- Experience --- Коммерческий директор @ ООО «АмурТрансАгро» (2019-01-01 – present) ООО «АмурТрансАгро». С января 2…
- Мария Несговорова [SCREENING_DONE] bucket=hidden_from_resume must_haves_from_resume=0 messages=17
  - summary: ## Мария Несговорова ### Must-haves - Китайский язык: ✅ conversational (Китайский (Intermediate)) - WeChat: ❓ не выяснено - Опыт 1688.com: ❓ не выяснено ### Key Info - Товарные категории: верхняя одежда, купальники, спо…
  - resume: Name: Несговорова Мария Title: менеджер по закупкам Location: Москва Age: 28 Total experience: 4y 11m --- Experience --- менеджер по закупкам @ Mad Wave, ООО (2024-03-01 – present) -Поиск новых поставщиков:переговоры, заключение договоров, контроль условий со…
- Валентина Воробьева [SCREENING_NO_RESPONSE] bucket=weak_or_risky must_haves_from_resume=1 messages=12
  - summary: ## Валентина Воробьева ### Must-haves - Китайский язык: ❌ none (не знаю,нет) - WeChat: ❓ не выяснено - Опыт 1688.com: ✅ true (у меня есть опыт ведения с китайскими фабриками) ### Key Info - Товарные категории: Food, Non…
  - resume: Name: Воробьева Валентина Евгеньевна Title: Руководитель закупки,e-commerce ,снабжение ,ВЭД, импорт , продакт ,логистика , маркетплейсы, туризм. Location: Москва Age: 38 Total experience: 21y 1m Desired salary: 150000 RUR --- Experience --- Руководитель по ра…

### Dialog Examples

- [Валентина Воробьева] system: [HH.ru] Resume evaluated: 45/100 (no) — The candidate lacks critical must-haves such as an active WeChat account, experience with 1688.com or similar B2B platforms, and business-level Chinese language skills. Additional…
- [Валентина Воробьева] outgoing: [HH.ru] Валентина Воробьева, Спасибо, что подали заявку на позицию "Менеджер по закупкам Китай". Я внимательно изучил ваше резюме и заметил некоторые моменты, которые не совпадают с требованиями должности. У вас отсутст…
- [Валентина Воробьева] incoming: Добрый день , прошу рассмотреть мое резюме . Готова предложить сотрудничество с вашей компанией , возможно мой опыт будет вам полезен и интересен ? Знаю итальянский, Английский и др.языки. Работала с разными категориями…
- [Валентина Воробьева] incoming: Добрый день , у меня есть опыт ведения с китайскими фабриками , это прописано в том числе в сопроводительном. И с этим сайтом есть опыт , все написать в сопроводительном письме невозможно.
- [Marlen Derdarov] system: [HH.ru] Resume evaluated: 50/100 (maybe) — The candidate demonstrates substantial experience in international procurement, particularly in engaging with Chinese suppliers. However, they lack a demonstrated active WeChat…
- [Marlen Derdarov] outgoing: [HH.ru] Уважаемый Марлен Дердаров, Спасибо за подачу заявки на должность Менеджера по закупкам в Китай. Я внимательно изучил ваше резюме и заметил, что вам не хватает опыта работы с B2B китайскими площадками. Учитывая э…
- [Marlen Derdarov] incoming: Опыт работы в ВЭД более 13 лет: Прекрасное владение английским и арабским языком, китайский язык HSK5 . Опыт в заграничных поездок ( Гуанчжоу, Шэньчжэнь, Фошань, Каир, Дубай) 1)Поиск поставщиков под ключ 2)Сюрвейерские …
- [Marlen Derdarov] incoming: У меня не хватает опыта))))) я суммарно 5 лет отработал в китайских компаниях

## Job 26: Менеджер по продажам (B2B, Сколково)

- slug: `sales-skolkovo-2026`
- interview_language: ru
- interviewer_name: Vladimir
- closing_type: wait
- screening_enabled: 1
- hh_sync_enabled: 1
- follow_up_persistence: 1

### Interview Prompts

- practical_q: Расскажите пример успешной сделки, где вы начинали коммуникацию с самого начала
- theory_q1: Какие навыки, на ваш взгляд, нужны менеджеру по продажам?

### Parsed Pipeline Goals

- Goal 1: Скрининг
  - Проверь резюме и отметь что уже видно (B2B опыт, холодные звонки, удалёнка). Не спрашивай повторно то что ясно из резюме. Задай только недостающее одним сообщением из списка: опыт B2B-продаж / работы с корпоративными кл…
  - Если кандидат явно не подходит (хочет только оклад, только офис, нет релевантного опыта) — вежливо завершить диалог
- Goal 2: Условия работы
  - Расскажи условия: задача — прозвон и переписка с участниками Сколково (~300 контактов в неделю), поиск ЛПР и передача эксперту Михаилу
  - KPI: встреча Zoom/офлайн — 4 000 ₽, Telegram ЛПР с диалогом — 5 000 ₽, Telegram ЛПР без диалога — 1 000 ₽
  - Испытательный срок: 1 неделя, фиксированные 10 000 ₽ в любом случае независимо от результата
  - Инструменты предоставляем: телефония Манго Телеком, Google Sheets, ИИ-инструменты
  - Спроси: интересно продолжить?
- Goal 3: Передача контакта
  - Кандидат готов → отправь: "Напишите руководителю в Telegram: @kobzevvv — он расскажет следующие шаги"
  - Отправить @kobzevvv в любом случае если кандидат дошёл до этого шага

### Candidate Sample

- Ирина Мишустина [SCREENING] bucket=medium must_haves_from_resume=0 messages=14
  - summary: ## Candidate Summary: Ирина Мишустина ### Must-haves - нет инфы: ❓ unknown ### Key Info - Salary expectations: 80000 RUR - Location/relocation: Белгород - Notice period: нет инфы - Languages: Русский: Родной - Motivatio…
  - resume: Name: Мишустина Ирина Михайловна Title: Персональный менеджер/Менеджер по продажам Location: Белгород Age: 35 Total experience: 9y 0m Desired salary: 80000 RUR --- Experience --- Менеджер по продажам @ ООО "ЯНДЕКС" (Яндекс.Бизнес/Яндекс.Директ) (2023-08-01 – …
- Светлана Пироженко [SCREENING] bucket=medium must_haves_from_resume=0 messages=3
  - summary: ## Candidate Summary: Светлана Пироженко ### Must-haves - : ❓ unknown ### Key Info - Salary expectations: 2000000 RUR - Location/relocation: Тамбов - Notice period: нет инфы - Languages: нет инфы - Motivation: нет инфы …
  - resume: Name: Пироженко Светлана Анатольевна Title: Директор по Маркетингу, PR, Амбассадор Location: Тамбов Age: 37 Total experience: 10y 7m Desired salary: 2000000 RUR --- Experience --- Аналитик, PR @ https://svetbusiness.ru/ (2020-11-07 – present) Виды деятельност…
- Артем Тяпкин [SCREENING] bucket=hidden_from_resume must_haves_from_resume=0 messages=6
  - summary: ## Краткая информация о кандидате: Артем Тяпкин ### Обязательные требования - Опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга: ✅ подтверждено (Опыт более 3 лет в B2B продажах IT-продуктов и юридически…
  - resume: Name: Тяпкин Артем Игоревич Title: Менеджер по продажам Location: Краснодар Age: 26 Total experience: 3y 7m Desired salary: 160000 RUR --- Experience --- Менеджер по продажам IT - продуктов @ Медиагруппа «Актион-МЦФЭР» (2024-01-01 – 2025-11-01) Основные обяза…
- Анастасия Маленёва [SCREENING] bucket=weak_or_risky must_haves_from_resume=0 messages=3
  - summary: ## Candidate Summary: Анастасия Маленёва ### Must-haves - Есть ли у вас опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга?: ❌ нет ### Key Info - Salary expectations: 100000 RUR - Location/relocation: Са…
  - resume: Name: Маленёва Анастасия Title: Оператор call-центра Location: Саратов Age: 41 Total experience: 0y 4m Desired salary: 100000 RUR --- Experience --- Визовый менеджер @ Единый Визовый Центр (2021-06-01 – 2021-09-01) Лидогенерация. Входящие (90%) исходящие (10%…
- Михаил Иванкевич [SCREENING] bucket=hidden_from_resume must_haves_from_resume=0 messages=4
  - summary: ## Краткая информация о кандидате: Михаил Иванкевич ### Обязательные требования - Требование: ✅ подтверждено (опыт B2B продаж в IT и финтех, работа с SaaS-решениями, привлечение клиентов SMB) ### Ключевая информация - О…
  - resume: Name: Иванкевич Михаил Николаевич Title: Менеджер по продажам Location: Калининград Age: 43 Total experience: 4y 8m Desired salary: 100000 RUR --- Experience --- Менеджер по продажам @ Портал Где этот дом (2025-06-01 – present) Ключевые обязанности и достижен…
- Зинаида  Лукьяненко [SCREENING] bucket=hidden_from_resume must_haves_from_resume=0 messages=7
  - summary: ## Candidate Summary: Зинаида Лукьяненко ### Must-haves - Есть ли у вас опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга?: ✅ confirmed (Менеджер по оптовым продажам @ ООО "Комплексные решения", Менедже…
  - resume: Name: Лукьяненко Зинаида Александровна Title: Менеджер по продажам Location: Волгоград Age: 38 Total experience: 11y 2m Desired salary: 100000 RUR --- Experience --- Менеджер по оптовым продажам @ ООО "Комплексные решения" (2023-06-01 – present) - Ведение кли…

### Dialog Examples

- [Зинаида  Лукьяненко] outgoing: [HH.ru] Зинаида Лукьяненко, спасибо за подробный ответ. Теперь давайте перейдем к сути задачи. Мы даем 300 контактов участников Сколково на неделю для проработки (можем дать больше, если эти закончатся). Vladimir
- [Зинаида  Лукьяненко] incoming: Ок, дальше какие действия
- [Зинаида  Лукьяненко] outgoing: [HH.ru] Зинаида Лукьяненко, отлично, давайте двигаться дальше! Мы предоставляем телефонию для вашей работы. Сервис сейчас находится в тестовом режиме, но уже показывает отличные результаты: 4 из 23 контактов продолжили …
- [Зинаида  Лукьяненко] incoming: Что по ЗП?
- [Анастасия Маленёва] outgoing: [HH.ru] Анастасия Маленёва, здравствуйте! У меня следующий вопрос: есть ли у Вас опыт B2B-продаж или продаж в сфере юридических услуг / консалтинга? Vladimir
- [Анастасия Маленёва] incoming: Добрый день! Меня зовут Анастасия. У меня есть коммерческое предложение по расширению вашего бизнеса! Вам нужен продуктивный, качественный и высококвалифицированный персонал? Не проблема! У нас имеется готовая горячая б…
- [Анастасия Маленёва] outgoing: [HH.ru] Анастасия Маленёва, добрый день! Вижу, Вы предлагаете услуги по подбору персонала. Это интересно. Уточните, пожалуйста, Вы готовы ответить на мои вопросы касательно Вашего опыта? Первый вопрос: есть ли у Вас опы…
- [Ирина Мишустина] outgoing: [HH.ru] Ирина Мишустина, Отлично, что у Вас есть такое четкое понимание важности аналитики и метрик. Расскажу о задаче: на неделю даём 300 контактов участников Сколково для проработки (можем дать больше, если закончатся…

## Initial Translation Notes

- job 26 is much simpler than the other two: it is a 3-step screening-and-handoff flow, not a long exploratory interview.
- job 9 and job 4 are closer to the current goals-pipeline model: they contain explicit staged goals, pending bullets and homework transition.
- the old system mixes three layers in one template: greeting copy, screening logic, and operational handoff. In V2 these should be separated into pipeline steps, FAQ/context, and sending policy.
- for realistic replay, top candidates already exist in legacy DB and can be reused as evaluation fixtures instead of inventing synthetic resumes.
