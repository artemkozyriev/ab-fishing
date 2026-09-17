# Ресёрч: рыболовное приложение для Альберты (Канада)

> Соло-разработчик, freemium, потенциал роста в бренд/мерч. Отчёт собран через многоагентный deep-research с состязательной проверкой фактов. Дата: **2026-09-16**.
> Все ключевые утверждения подтверждены источниками (URL в конце разделов). Опровергнутые/непроверенные гипотезы помечены явно.

---

## 0. Главный вывод (TL;DR)

Рынок fishing-приложений конкурентен на базовом уровне (погода, давление, луна, карты глубин — уже закрыто Fishbrain/ANGLR). Реальное окно — **гиперлокализация под Альберту**: офлайн-справочник регуляций **по каждому водоёму** + карты глубин на бесплатной гос-батиметрии. Это уникально, технически сложно для глобальных игроков и совпадает с личным интересом (сам рыбак).

**Критическая находка ресёрча:** структурированные данные регуляций Альберты **реально доступны машиночитаемо** — существует рабочий (недокументированный, но публичный) JSON API + официальная геометрия водоёмов под открытой лицензией. Это снимает главный риск проекта (парсинг PDF). Детали — в разделе 3 и в `DATA_SOURCES.md`.

---

## 1. Конкуренты — что уже закрыто

| Приложение | Что умеет | Цена | Вывод |
|---|---|---|---|
| **Fishbrain** | Точные локации уловов, прогноз клёва, **контуры глубин**, соцсеть рыбаков. 4.7/5, ~74K оценок, Editors' Choice, 12.5M+ загрузок | Pro ~**$74.99/год** ($9.99/мес) | Крупный устоявшийся лидер. Базовые data-фичи закрыты |
| **ANGLR** | Автолог погоды, **барометрического давления**, ветра; вкладка conditions с анализом паттернов | freemium | Данные о погоде/давлении — не дифференциатор |
| FishAngler, Fishing Points, Omnia, WeFish | Логбуки, карты, соцфункции | разные | Общие инструменты, без глубокой локализации под Альберту |

➡️ **Погода + давление + фаза луны + solunar + базовые карты глубин — НЕ дифференциатор.** Строить продукт вокруг «прогноза клёва по погоде» = выходить на переполненный рынок без преимущества.

**Данные о Fishbrain (оценки третьих сторон, погрешность велика):** ~10M установок на Android, 12.5M+ суммарно; ~15M заявленных англеров (маркетинговый охват, не MAU); оценочная выручка US ~$1M/мес App Store + ~$100k/мес Google Play (appfigures/Sensor Tower).

> ⚠️ **Опровергнуто проверкой:** гипотеза «у ANGLR слабый анализ данных → ниша» — отзывы не подтвердили (голосование 1-2 против). Не закладываться.

Источники: App Store [Fishbrain](https://apps.apple.com/us/app/fishbrain-fishing-app/id477967747?see-all=reviews) / [ANGLR](https://apps.apple.com/us/app/fishing-app-anglr-logbook/id1142347232?see-all=reviews); [Fishbrain Pro blog](https://fishbrain.com/blog/fishing/introducing-pro); [Sport Fishing Magazine](https://www.sportfishingmag.com/story/gear/fishbrain-pro-the-tool-every-angler-needs/); [appfigures](https://appfigures.com/reports/app-profile/212427169/downloads); [AppBrain](https://www.appbrain.com/dev/Fishbrain/).

---

## 2. Дифференциатор — окно возможностей

### 2.A Офлайн-справочник регуляций по водоёмам (быстрый старт, низкий риск)
Официальное приложение провинции ([geospatial.alberta.ca/afr](https://geospatial.alberta.ca/afr/)) — **web-based, работает только при сотовой связи**. Рыбачат часто без связи. Регуляции устроены **по каждому водоёму отдельно**:
- **18 промысловых видов** (walleye/судак, northern pike/щука, yellow perch, lake whitefish, arctic grayling, 8 видов форели и др.).
- Размерные/количественные лимиты и сезоны **варьируются по watershed units** внутри Fish Management Zones.
- Ice-fishing — те же year-round правила, отдельная проверка по каждому озеру.

➡️ Per-waterbody сложность — одновременно **барьер для глобальных конкурентов** и твоя защита. Локальный рыбак сделает точнее международного стартапа.
> ⚠️ Кавет: провинция уже даёт скачиваемый PDF-гид и офлайн-приложение AlbertaRELM (лицензии). Ниша — именно удобный **офлайн-просмотр регуляций** («я на озере X → что можно?»), а не лицензии.

### 2.B Карты глубин на бесплатной гос-батиметрии (долгий потенциал, платная фича)
**Alberta Geological Survey** бесплатно раздаёт батиметрию **169 озёр** в готовых GIS-форматах (shoreline contours shapefile, bathymetry contours shapefile, ASCII grid дна). У Fishbrain карты глубин — платные ($74.99/год). Можно дать дёшево/бесплатно для Альберты как крючок.
> ⚠️ Покрыто 169 из тысяч озёр — но это популярные озёра.

### 2.C Прогноз клёва — только фазой 2
Технически возможно (погода+давление+луна+solunar+уловы), факторы реально влияют. Но это уже делают Fishbrain/ANGLR. Ценность появляется **только** в связке с локальными данными Альберты (уровень рек ECCC, батиметрия AGS) и агрегацией отчётов из Reddit. Делать поверх локального фундамента, не как стартовую фичу.

Источники: [mywildalberta.ca/fishing/regulations](https://mywildalberta.ca/fishing/regulations/default.aspx); [alberta.ca/game-fish-species](https://www.alberta.ca/alberta-game-fish-species); [ice-fishing](https://mywildalberta.ca/fishing/ice-fishing.aspx); [ags.aer.ca lake-bathymetry](https://ags.aer.ca/interactive-data-and-tools/lake-bathymetry-data).

---

## 3. Данные и API (проверено — см. подробности в DATA_SOURCES.md)

### 3.1 Регуляции по водоёмам — ЕСТЬ машиночитаемый доступ ✅ (главная находка)
Приложение [geospatial.alberta.ca/afr](https://geospatial.alberta.ca/afr/) построено на Esri Web AppBuilder / ArcGIS Enterprise. Данные доступны двумя путями:

1. **Геометрия водоёмов (ArcGIS REST, лицензия OGL–Alberta):**
   `https://geospatial.alberta.ca/titan/rest/services` → папка `fisheries` → сервис `fisheries_regulations/MapServer` (слои: 0 River Regulations, 1 Lake Regulations, 2 Watersheds, 4 Fish Management Zones). Содержит **только геометрию + идентификаторы** (`WB_ID`, `Official_Name`, `FMZ`), правил в нём нет.

2. **Сами регуляции (скрытый, но публичный JSON API):**
   `GET https://geospatial.alberta.ca/services/Fisheries/Regulation?waterbodyId=<WB_ID>`
   Возвращает чистый JSON без авторизации. Поля: `species`, `season`/`seasonStatus`/`seasonStart`, `bagLimit`, `sizeLimitMin/Max`, `baitType`, `catchRules`, `comments`. Проверено на реальных WB_ID (3877, 3471, 3503) — HTTP 200 + данные.

**Схема сборки полной базы:** пройти слои 0/1 (постранично по 2000, флаг `exceededTransferLimit`), собрать все `WB_ID` + геометрию → по каждому дернуть `/services/Fisheries/Regulation`. Даёт полную БД «водоём → правила», без парсинга PDF.

> ⚠️ **Юридический риск (главный по проекту):** регуляционный API `/services/Fisheries/Regulation` **не имеет публичной лицензии/документации** — это внутренний backend приложения. Работает, но полагаться в продакшене рискованно (могут закрыть/изменить). **Рекомендация:** до запуска написать в Alberta Environment and Protected Areas / Fisheries (контакт метаданных `PGC.Metadata@gov.ab.ca`) и запросить официальное разрешение/дамп БД. Геоданные ArcGIS — под **OGL–Alberta** (свободное коммерческое использование при указании источника).
> Запасной путь — парсинг PDF-гида ([2026 Guide](https://albertaregulations.ca/2026-Alberta-Guide-to-Sportfishing-Regulations.pdf)) — рискован (ошибки в лимитах = юр. ответственность), использовать только для сверки.

### 3.2 Бесплатные гос-данные (без вложений)
- **ECCC / MSC GeoMet** — реалтайм гидрометрия: уровень и расход воды с **2100+ станций** Канады (последние 30 дней) + тысячи датасетов (осадки, снег, лёд, паводки). Endpoint: `api.weather.gc.ca`.
- **Alberta Geological Survey** — батиметрия 169 озёр (см. 2.B).
- **OpenWeather и аналоги** — погода, давление, фазы луны, solunar (но это у всех).

Источники: [api.weather.gc.ca](https://api.weather.gc.ca/); [hydrometric-realtime](https://api.weather.gc.ca/collections/hydrometric-realtime?lang=en); [open.canada.ca — Fish Management Zone (OGL–Alberta)](https://open.canada.ca/data/en/dataset/be508ec9-44dc-439e-a2b5-1f8550c65672).

---

## 4. Сбор данных из соцсетей — реалистичная оценка

- **Reddit** (r/albertafishing, r/FishingAB, r/Fishing) — есть **официальный Reddit API**. Это предпочтительный легальный путь. Использовать его.
- **Facebook-группы** — юридически рискованно, запрещено ToS/анти-скрейпингом. Решение суда Meta v. Bright Data (N.D. Cal., судья Chen, 23.01.2024) разрешает скрейпинг **публичных (logged-off)** данных, НО это единичное non-binding решение окружного суда, зависит от формулировки ToS, не покрывает logged-in. **Не закладываться как на фундамент.**

Источники: [fbm.com — Meta v. Bright Data](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/); [zyte.com](https://www.zyte.com/blog/california-court-meta-ruling/).

---

## 5. Рынок и монетизация

### 5.1 Размер рынка Альберты (проверено ✅)
Продажи **резидентских** лицензий на спортивную рыбалку (My Wild Alberta / RELM):
- 2021: **283 948** · 2022: 244 353 · 2023: 244 924 · 2024: 250 818 · 2025: **260 168**
- Нерезиденты 2025: канадцы 4 425 + из-за пределов Канады 1 077 (резиденты ~98% рынка).

➡️ **Обслуживаемый рынок: ~250 000–285 000 годовых лицензиатов.** Стабильно последние 5 лет.
Источник: [mywildalberta.ca — annual sales statistics](https://mywildalberta.ca/buy-licences/annual-sales-statistics.aspx).
> ⚠️ Не путать: датасет «Angling Licence Sales» на open.canada.ca — это **Британская Колумбия**, не Альберта.

### 5.2 Бенчмарки монетизации (RevenueCat State of Subscription Apps 2026)
- Freemium конверсия (download-to-paid D35) медиана **~2.1%** vs hard paywall **10.7%** (~5x).
- Прокси для ниши — **Health & Fitness**: trial-to-paid **37.7%**, download-to-paid D35 **2.9%**, RLTV год 1 **$35.64**, **68% подписок годовые**.
- Ценовые точки: **$9.99/мес**, $4.99–5.99/нед, медиана года **~$34.80**.
> ⚠️ Прямых бенчмарков по fishing/hunting-приложениям в открытых отчётах НЕТ (честный пробел). Health & Fitness — ближайший прокси.

Источник: [RevenueCat — State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps).

### 5.3 Подписка vs Lifetime
Для узкой **сезонной** региональной ниши (рыбалка — зима/лето) годовая подписка ощущается как «плачу 12 мес, ловлю 5» → давит на удержание. Рекомендация: **freemium + годовая подписка (основной SKU, с триалом) + lifetime как «страховочное» второе предложение** (цена lifetime ~5x годовой). ~35% подписочных приложений уже используют такой гибрид.
Источники: [RevenueCat — lifetime](https://www.revenuecat.com/blog/growth/lifetime-subscriptions); [Airbridge](https://www.airbridge.io/en/blog/should-you-offer-a-lifetime-subscription).

### 5.4 Affiliate (проверено, с корректировками)
| Программа | Ставка | Cookie | Комментарий |
|---|---|---|---|
| **FishingBooker** (гиды/чартеры) | **20–50%** | **90 дней** | ⭐ Лучшее для ниши: высокий чек, высокий %, длинное окно. Проверить покрытие гидов по Альберте |
| **Bass Pro / Cabela's Canada** | **~5.6%** (рыбол. снасти); 3.2% только оружейное | 14 дней | Через FlexOffers CA / Rakuten Advertising. Прежняя гипотеза «3.2%» скорректирована вверх |
| **Amazon Associates Canada** | ~3% (Sports & Outdoors) | ~24 ч | Низкий доход на клик, но легко вступить |
| Canadian Tire | 0.8–8% (разброс) | — | Ставка неоднозначна, уточнять напрямую |

> ⚠️ **Опровергнуто:** «Bass Pro/Cabela's = 3.2% как базовая ставка» — 3.2% относится к оружейной категории, для рыбалки ~5.6%.
> ⚠️ **Не найдено:** публичная affiliate-программа Fishbrain; программы локальных магазинов снастей Альберты (только прямые договорённости).
> ⚠️ **Private Licence Issuer** (продажа лицензий за комиссию): цена лицензии одинакова онлайн/офлайн (наценки покупателю нет). Issuer печатает теги в физической точке — плохо стыкуется с цифровым приложением. Условия/комиссия не подтверждены; запрашивать у Aspira (`Sales@AspiraConnect.com`). Маловероятный канал для соло.

Источники: [FishingBooker affiliate](https://help.fishingbooker.com/143082-policies/360018754973-How-do-I-become-an-affiliate-partner-); [FlexOffers — Bass Pro/Cabela's CA](https://www.flexoffers.com/affiliate-programs/bass-pro-shops-cabelas-canada-affiliate-program/); [Amazon.ca Associates](https://associates.amazon.ca/); [Aspira Connect](https://aspiraconnect.com/provincial-wildlife-agencies).

### 5.5 Путь к бренду/мерчу
Узкое лояльное комьюнити рыбаков Альберты хорошо конвертится в аудиторию под мерч — реалистичный путь роста (совпадает с целью пользователя).

---

## 6. Публикация приложения

### 6.1 Apple App Store
- **$99 USD/год** (в CAD ~135, курс плавает). Возможен **fee waiver** для гос/некоммерческих.
- **Mac НЕ обязателен** при сборке через **Expo EAS Build** (облачная сборка iOS) + `eas submit`.
- Ревью обычно **24–48 ч**. Риски отклонения: 5.1.1 (политика приватности, удаление аккаунта, геолокация «when in use»); **4.3** (тонкие обёртки над сайтом отклоняют — нужна нативная ценность: офлайн-карты, GPS).
- Для гос-регуляций: обязательный **дисклеймер** («справочно; official source — Alberta Fishing Regulations; проверяйте перед выездом») + дата/версия данных.

### 6.2 Google Play
- **$25 USD разово** (не ежегодно).
- **Барьер для новых личных аккаунтов** (созданных после 13.11.2023): закрытое тестирование **12 тестеров × 14 дней подряд** перед production (было 20, снижено до 12 в дек. 2024). Заложить ~2–3 недели, собрать тестеров из рыболовных сообществ.
- Организационный аккаунт требует **D-U-N-S** (бесплатно, до ~30 дней).

### 6.3 Альтернативы и стек
| Способ | Офлайн | Цена входа | Скорость | Ревью |
|---|---|---|---|---|
| Обычный сайт | Плохо | $0 | Мгновенно | Нет |
| **PWA** | Хорошо на Android, **слабо на iOS** (лимит ~50 МБ, очистка данных ч/з 7 дней бездействия) | $0 | Мгновенно | Нет |
| TWA в Google Play (Bubblewrap) | = PWA | $25 | +ревью +тестеры | Средний |
| **RN + Expo/EAS** (натив) | **Отлично** (SQLite/MMKV) | $99+$25 | Дни–недели | Средний |
| Flutter | Отлично | $99+$25 | Дни–недели | Средний |
| Capacitor (если есть веб) | Отлично | $99+$25 | Дни–недели | Средний |

**OTA-обновления (легально):** данные регуляций можно обновлять **мгновенно без ревью** (это контент/ассеты) через **Expo EAS Update**. Apple (3.3.2) и Google разрешают JS/интерпретируемый код, если не меняется назначение приложения. Новую сборку в стор — только при смене нативного кода/разрешений. Идеально для сезонно меняющихся регуляций.

### 6.4 Рекомендация по публикации
**Два шага на едином коде:**
1. **PWA как MVP** ($0, мгновенно): service worker + IndexedDB, офлайн-кэш регуляций, GPS. Закрывает Android + быстрый доступ по ссылке. Обязательный дисклеймер.
2. **Нативная обёртка (RN + Expo + EAS)** когда нужен надёжный офлайн на iOS и присутствие в сторах: один код iOS+Android+Web, сборка iOS без Mac, нативный SQLite (снимает лимиты Safari), OTA для регуляций.

**Бюджет входа в оба стора:** $25 (Google) + $99/год (Apple) ≈ **$124** первый год.

Источники: [Apple — membership](https://developer.apple.com/programs/whats-included/); [fee waivers](https://developer.apple.com/help/account/membership/fee-waivers/); [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/); [Google Play — testing req.](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en); [required info/D-U-N-S](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en); [PWA iOS limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide); [TWA guide](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2); [Expo EAS Update](https://docs.expo.dev/eas-update/introduction/); [Bitrise — OTA policy](https://bitrise.io/blog/post/what-app-stores-allow-with-ota-updates-apple-and-google-policy-explained).

---

## 7. Уникальность — честная оценка

| Направление | Аналоги? | Твоё преимущество |
|---|---|---|
| Прогноз клёва по погоде | ✅ Много | Нет |
| Общие карты глубин | ✅ Fishbrain (платно) | Локально бесплатно/дёшево |
| **Офлайн регуляции по водоёмам Альберты** | ❌ Практически нет | **Сильное, уникальное** |
| Агрегация Reddit-отчётов по Альберте | ❌ Нет специализированного | Среднее |

➡️ Настоящее «белое пятно»: **офлайн + per-waterbody регуляции + местная агрегация для Альберты.** Глобальным игрокам невыгодно моделировать правила по каждому озеру одной провинции.

---

## 8. Открытые вопросы (статус после проверки)

| Вопрос | Статус |
|---|---|
| Машиночитаемые регуляции по водоёмам? | ✅ **Решено** — есть API (раздел 3.1). Остаётся получить офиц. разрешение |
| Размер рынка Альберты? | ✅ **Решено** — ~250–285K лицензий/год |
| Реальные affiliate-ставки? | ✅ **Уточнено** — FishingBooker 20–50%, Bass Pro ~5.6% |
| Бенчмарки ниши fishing/hunting? | ⚠️ Прямых нет; прокси Health & Fitness |
| Комиссия Private Licence Issuer? | ⚠️ Не подтверждена; вероятно нерелевантно для цифрового продукта |

---

## 9. Каветы и что перепроверить перед запуском
- Цены конкурентов и бенчмарки RevenueCat time-sensitive — перепроверить перед запуском.
- Регуляционный API без публичной лицензии — **получить письменное разрешение провинции** (главный риск).
- Правило Google «12 тестеров» менялось (20→12) — перепроверить актуальную справку.
- Цена Apple в CAD расчётная — уточнить при оформлении.
- Точность регуляций критична (неверный лимит = юр. риск для пользователя) — нужен процесс регулярного обновления + дисклеймер.
