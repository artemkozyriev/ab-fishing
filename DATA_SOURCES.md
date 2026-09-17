# Реестр источников данных и API

> Технический справочник для разработки. Все endpoint-ы проверены агентами 2026-09-16.
> ⚠️ Перед продакшеном перепроверить актуальность и получить разрешения где указано.

---

## 1. Регуляции по водоёмам Альберты ⭐ (ядро продукта)

### 1.1 Геометрия водоёмов — ArcGIS REST (лицензия OGL–Alberta ✅)
Базовый сервер:
```
https://geospatial.alberta.ca/titan/rest/services
```
Папка `fisheries` → сервис:
```
fisheries/fisheries_regulations/MapServer
```
- Слои: `0` River Regulations (polyline), `1` Lake Regulations (polygon), `2` Watersheds (HUC8), `4` Fish Management Zones.
- Поля: `WB_ID`, `WB_SEC_ID`, `FMZ`, `Official_Name`, `Common_Name`, `FEATURE_TYPE`. **Только геометрия + ID, правил нет.**
- Поддержка Query, `maxRecordCount=2000`, флаг `exceededTransferLimit` для пагинации.

Пример запроса (возвращает реальные WB_ID):
```
https://geospatial.alberta.ca/titan/rest/services/fisheries/fisheries_regulations/MapServer/1/query?where=1=1&outFields=WB_ID,Official_Name&f=json
```
Другие полезные слои в папке: `bull_trout_zone`, `arctic_grayling_zone_public`, `athabasca_rainbow_trout_zone`, `westslope_cutthroat_trout_zone`, `tod_angling_restriction_polygon` (ограничения по времени суток), `aep_fish_contact_districts`, `fwmis_hydrography`.

### 1.2 Сами регуляции — скрытый публичный JSON API ⚠️ (лицензия НЕ заявлена)
```
GET https://geospatial.alberta.ca/services/Fisheries/Regulation?waterbodyId=<WB_ID>
```
- Чистый JSON, HTTP 200, **без авторизации**.
- Обнаружен в конфиге виджета `AFRIRegulations`: `https://geospatial.alberta.ca/afr/widgets/AFRIRegulations/config.json` → поле `restApiUrl`.
- Проверено на WB_ID 3877, 3471, 3503 — все вернули данные.

Структура ответа (реальный пример, WB_ID=3877 «A-H LAKE»):
```json
[{
  "waterBodyId": 3877,
  "waterBodySectionId": 191,
  "waterBodyOfficialName": "A-H LAKE",
  "geoAdminName": "NB3",
  "regulations": [
    {
      "species": "NORTHERN PIKE",
      "season": "OPEN MAY 15 - MAR. 31",
      "bagLimit": 3,
      "sizeLimitMin": 63,
      "sizeLimitMax": null,
      "baitType": "Bait allowed.",
      "catchRules": "3 NORTHERN PIKE over 63 cm",
      "seasonStatus": "OPEN",
      "seasonStart": "MAY 15"
    }
  ]
}]
```

### 1.3 Схема сборки полной БД «водоём → правила»
1. Пройти слои `0` и `1` сервиса `fisheries_regulations` постранично (по 2000, следить за `exceededTransferLimit`), собрать все `WB_ID` + геометрию.
2. По каждому `WB_ID` → `GET /services/Fisheries/Regulation?waterbodyId=<WB_ID>`.
3. Сохранить локально (SQLite для приложения). Обновлять по сезонам.

> ✅ **Реализовано и проверено вживую 2026-09-16** — см. `scripts/fetch-regulations.mjs`.
> Фактические результаты прогона:
> - Слой 0 (River): **71 699** объектов; слой 1 (Lake): **73 251**. Всего **144 950**, уникальных WB_ID **144 872**.
> - ⚠️ **Поля слоёв различаются:** у рек (0) НЕТ `WB_SEC_ID` и `FEATURE_TYPE` (есть только `WB_ID, FMZ, Official_Name, Common_Name`). Запрашивать поля по факту из метаданных слоя, иначе HTTP 400.
> - ~**140 834** объектов — `Official_Name = "UNNAMED"` (мелкие безымянные). **Именованных: 4 038** — это ядро для приложения.
> - У именованных: **4 172** секции, **29 274** строки правил, **21** вид рыбы. Один водоём = несколько строк (виды × сезоны, напр. летний/зимний).
> - **HTTP 204** от Regulation API = у водоёма нет отдельной записи (действуют общие зональные правила по FMZ) — это норма, не ошибка. Встретилось у 4 именованных.
> - Скорость: ~80–110 запросов/с при concurrency 8. Пагинация ArcGIS: `resultOffset` + `orderByFields=OBJECTID`, формат `f=json` (или `f=geojson&outSR=4326` для геометрии).
> - **21 вид (реальный список из данных):** ARCTIC GRAYLING, BROOK/BROWN/BULL/CUTTHROAT/LAKE/RAINBOW/TIGER TROUT, BURBOT, DOLLY VARDEN, GOLDEYE, LAKE STURGEON, LAKE/MOUNTAIN WHITEFISH, NORTHERN PIKE, SAUGER, TROUT TOTAL, TULLIBEE (CISCO), WALLEYE, WALLEYE/SAUGER, YELLOW PERCH.

### 1.4 ⚠️ Юридический статус и действие
- Геоданные (1.1): **OGL–Alberta** — свободное коммерческое использование при **attribution** («Contains information licensed under the Open Government Licence – Alberta»).
- Регуляционный API (1.2): **без публичной лицензии/документации** — внутренний backend. Риски: могут закрыть, изменить формат без предупреждения, счесть использование несанкционированным.
- **ДЕЙСТВИЕ ДО ЗАПУСКА:** написать в Alberta Environment and Protected Areas / Fisheries (контакт метаданных: `PGC.Metadata@gov.ab.ca`), запросить официальное разрешение / дамп регуляционной БД / условия использования API.
- Официальные источники сверки: [geospatial.alberta.ca/afr](https://geospatial.alberta.ca/afr/), [PDF-гид 2026](https://albertaregulations.ca/2026-Alberta-Guide-to-Sportfishing-Regulations.pdf), [alberta.ca регуляции](https://www.alberta.ca/fishing-hunting-and-trapping-regulations).

### 1.5 Запасной источник — PDF-гид (только сверка)
```
https://albertaregulations.ca/2026-Alberta-Guide-to-Sportfishing-Regulations.pdf
```
⚠️ Парсинг рискован (сложная вёрстка, таблицы по FMZ, сноски; не привязан к WB_ID). Ошибка в лимитах = юр. риск. Использовать только для верификации данных из API.

---

## 2. Карты глубин / батиметрия

### Alberta Geological Survey — Lake Bathymetry (бесплатно ✅)
```
https://ags.aer.ca/interactive-data-and-tools/lake-bathymetry-data
```
- **169 озёр Альберты**. Форматы: shoreline contours (shapefile), bathymetry contours (shapefile), ASCII grid дна.
- Импорт: GDAL / QGIS / GeoPandas.
- Покрытие: 169 из тысяч озёр (популярные).

---

## 3. Гидрология (уровень/расход рек)

### ECCC / MSC GeoMet (бесплатно ✅)
```
https://api.weather.gc.ca/
https://api.weather.gc.ca/collections/hydrometric-realtime?lang=en
```
- Реалтайм уровень и расход воды, **2100+ станций** Канады (последние 30 дней).
- Тысячи датасетов: погода, климат, осадки, снег, лёд, паводки.
- Исторические данные — отдельный датасет HYDAT.

---

## 4. Погода / давление / луна / solunar

- **OpenWeather** (One Call API 3.0): погода, барометрическое давление, фазы луны. `https://openweathermap.org/api/one-call-3` (есть бесплатный тир, дальше платно).
- Solunar можно считать локально из астрономических формул (восход/закат солнца и луны, фазы) — библиотеки есть под все платформы.
- ⚠️ Эти признаки уже используют конкуренты — ценность только в связке с локальными данными Альберты.

---

## 5. Соцсети (отчёты об уловах)

- **Reddit API** (официальный, легальный ✅): r/albertafishing, r/FishingAB, r/Fishing. Предпочтительный путь.
  - ⚠️ Проверить актуальные условия pre-approval для персональных проектов (менялись в 2024–2025).
- **Facebook-группы**: скрейпинг рискован (ToS, анти-скрейпинг). Не закладываться.

---

## 6. Лицензии (для affiliate/справки)

- Система: **AlbertaRELM** (онлайн) + Private Licence Issuers (оператор Aspira Connect).
- Резидентская годовая: **$30 CAD** (16–64 года), требуется **WiN** (Wildlife Identification Number, разовая плата ~$8).
- Special Harvest Walleye Licence (Class A/B/C): **$12** каждая, first-come на установленные даты.
- Инфо: [mywildalberta.ca — fishing licences](https://mywildalberta.ca/buy-licences/fishing-licenses-fees/default.aspx).

---

## 7. Виды рыбы Альберты (18 промысловых)

walleye (судак), northern pike (щука), yellow perch (окунь), lake whitefish (сиг), arctic grayling (хариус), + 8 видов форели (bull trout, rainbow, brown, brook, cutthroat, lake trout, golden, tiger) и др.
Источник: [alberta.ca/alberta-game-fish-species](https://www.alberta.ca/alberta-game-fish-species).
Зональные слои-ограничения по видам см. в разделе 1.1 (bull_trout_zone и т.д.).
