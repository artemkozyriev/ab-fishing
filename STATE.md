# STATE — точка продолжения

Последнее обновление: 2026-09-28. Коммит: `e35660d`. Всё запушено (local = origin).

## 🌐 Живой сайт
**https://artemkozyriev.github.io/ab-fishing/**
Репозиторий: github.com/artemkozyriev/ab-fishing (аккаунт **artemkozyriev**).
Деплой автоматический: `git push` в `main` → GitHub Actions собирает и публикует папку `app/`.

## Что уже готово (MVP, задеплоено)
- Офлайн-PWA (vanilla JS, без сборки), полностью на английском.
- Поиск водоёма по названию (5 063 озёр/рек), правила по видам (сезоны, лимиты, размеры, наживка).
- Карта (Leaflet + OSM), кластеризация маркеров, вектор озёр и рек (офлайн).
- Фильтр по виду рыбы + «только где разрешён вылов».
- «Рядом» (GPS → point-in-polygon по озёрам).
- Офлайн-карта: вектор воды везде + кэш просмотренных тайлов + кнопка «Download area» (персистентный кэш) + управление областями (список/размер/очистка).
- Карты глубин (батиметрия AER/AGS): залитые зоны глубин (голубой→тёмно-синий), тап → глубина в метрах, подпись макс. глубины на озере, легенда (zoom ≥ 10).
- PWA-иконки (PNG 192/512/maskable/apple), service worker `ab-fishing-v11`.
- **Определение вида рыбы по фото (📷 ID), оффлайн**: on-device TF.js, двухэтапно (MobileNet v2 эмбеддинг → обученная голова, 19 видов). top-1 ≈ 45% / top-3 ≈ 69%. Детали — `FEATURE_FISH_ID.md`.

## Как продолжить работу локально
```bash
cd g:\Fishing_app
node scripts/serve.mjs        # → http://localhost:5173
```
Основные команды (npm-скрипты):
- `npm run fetch`       — выгрузить регуляции (scripts/fetch-regulations.mjs)
- `node scripts/fetch-bathymetry.mjs` — выгрузить батиметрию
- `npm run build-data`  — собрать app/data из data/
- `npm run icons`       — сгенерировать PNG-иконки
- `npm run serve`       — дев-сервер
- `npm run fetch-fish`  — собрать датасет фото рыб (iNaturalist → data/fish-images/)
- `npm run train-fish`  — обучить модель 📷 ID (tfjs-node → app/model/)

## 📷 Fish-ID — что закоммичено vs локальное (важно после переустановки)
**В git (приложение работает из чистого клона, переобучение не нужно):**
`app/fishid.js`, `app/vendor/` (tf.min.js + mobilenet ~14 МБ), `app/model/` (обученная голова + labels),
скрипты, доки. Модель уже обучена и задеплоена.

**Локальное, НЕ в git** (регенерируется, живёт только на этой машине):
- `data/fish-images/` (~433 МБ) — датасет. Пересобрать: `npm run fetch-fish`.
- `data/fish-emb-cache.*` (~18 МБ) — кэш MobileNet-эмбеддингов (ускоряет переобучение головы).
- `node_modules/` — после `npm install` на Windows скопировать
  `node_modules/@tensorflow/tfjs-node/deps/lib/tensorflow.dll` → `.../lib/napi-v8/`
  (иначе tfjs-node не грузится; см. `app/model/README.md`).

Полное описание фичи, метрики (top-1 ~45% / top-3 ~69%), архитектура и как поднять точность —
в **`FEATURE_FISH_ID.md`**; про модель/обучение — в **`app/model/README.md`**.

## Как задеплоить изменения
```bash
git add -A && git commit -m "..." && git push origin main
```
⚠️ При изменении файлов в `app/` — поднять версию `CACHE` в `app/sw.js` (иначе у пользователей останется старый офлайн-кэш).
⚠️ Push крупных файлов из этого окружения иногда падает по HTTP 408 — просто повторить `git push` (буфер уже увеличен).

## Структура
```
app/        PWA (index.html, app.js, db.js, sw.js, styles.css, data/, icons/)
scripts/    fetch-regulations, fetch-bathymetry, build-app-data, make-icons, serve
data/       сырые выгрузки (в .gitignore, регенерируются скриптами)
RESEARCH.md, DATA_SOURCES.md, DECISIONS.md — ресёрч, источники, решения/план
```

## Ключевые источники данных
- Регуляции: `https://geospatial.alberta.ca/services/Fisheries/Regulation?waterbodyId=<WB_ID>` + геометрия ArcGIS (OGL–Alberta). ⚠️ Регуляционный API без публичной лицензии — до продакшена получить разрешение провинции (`PGC.Metadata@gov.ab.ca`).
- Батиметрия: ArcGIS FeatureServer AER/AGS `Alberta_Lake_Bathymetry` (OGL–Alberta, атрибуция AER/AGS).

## Следующие шаги (не начаты)
- [ ] Тест на iOS (лимиты Safari; офлайн-данных ~24 МБ — проверить кэш на айфоне).
- [ ] Подписи глубин на промежуточных изобатах / тап-подсказки (базово уже есть тап + макс. метка).
- [ ] Запрос разрешения у провинции на данные регуляций (перед продакшеном).
- [ ] При масштабировании — свой тайл-провайдер / PMTiles (сейчас OSM корректно, с лимитами).
- [ ] Порт на React Native + Expo (нативный офлайн на iOS).
- [ ] Монетизация: freemium (карты глубин/прогноз как платные), affiliate FishingBooker, мерч.
- [x] Определение вида рыбы по фото — **готово и обучено** (вкладка 📷 ID, TF.js on-device, оффлайн,
      MobileNet v2 + голова, top-1 ≈ 45% / top-3 ≈ 69%). Переобучение: `npm run fetch-fish` →
      `npm run train-fish` (кэш эмбеддингов ускоряет), затем поднять CACHE в `sw.js`.
      Улучшить точность → fine-tuning базы / чистка датасета (см. `FEATURE_FISH_ID.md`).
      ⚠ Оффлайн-бандл вырос до ~37 МБ (+15 МБ) — перепроверить лимиты iOS Safari.

Детали и обоснования — в DECISIONS.md (чек-листы по фазам) и RESEARCH.md.
