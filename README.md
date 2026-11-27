# TOVARIX · PixelForge UZ

Система управления магазином на React, TypeScript, Vite, Capacitor и Supabase.

## Запуск

Требуется Node.js 24. Для Android также нужны JDK 21, Android SDK 35 и Build Tools 34.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Укажите URL и publishable key выделенного проекта TOVARIX. Без этих двух параметров открывается прежний локальный режим. Его данные остаются в профиле браузера, а каталог можно выгрузить в XLSX. Остатки и продажи из локального режима автоматически в облако не переносятся.

Для разработки с отдельной локальной базой запустите `supabase start` и возьмите URL и публичный ключ из `supabase status`. Новый бизнес и первая торговая точка создаются после регистрации. Сотруднику сначала нужно зарегистрировать отдельный аккаунт. Затем владелец добавляет его по UUID и задаёт права. Перед продажей кассир открывает смену.

## Проверки и сборка

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run android:sync
(cd android && bash gradlew assembleDebug)
```

- Web/PWA находится в `dist/`.
- Android APK находится в `android/app/build/outputs/apk/debug/app-debug.apk`.
- `npm run test:postgres` использует `TOVARIX_TEST_POSTGRES`. Нужна пустая одноразовая база с правом создания тестовых ролей.
- `npm run test:browser` использует `TOVARIX_TEST_WEB`. Запустите production preview, собранный с URL и публичным ключом локального Supabase. Для этого теста локальная регистрация должна выдавать сессию сразу. Укажите `TOVARIX_CHROMIUM` или установите Chromium командой `npx playwright install chromium`.

Развёртывание, биллинг и ограничения описаны в [docs/RELEASE.md](docs/RELEASE.md).
