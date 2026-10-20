# WPlan API — разведка (2026-10-20)

Сервис: **WPlan** — корпоративный учёт рабочего времени.
`https://wplan.office.lan` (внутренний адрес) (Next.js + NestJS GraphQL, nginx, ADFS SSO).

## Доступность из локального Node — ДА, ничего не режет

- **TLS:** сертификат подписан внутренним корпоративным Sub-CA (есть
  в системном keychain macOS).
  Из Node обязателен флаг **`node --use-system-ca`** (или `NODE_EXTRA_CA_CERTS`),
  иначе `SELF_SIGNED_CERT_IN_CHAIN`. Песочница context-mode игнорирует system CA —
  запускать login/запросы только через `node --use-system-ca`.
- **DNS:** имя в зоне `.lan` резолвится во внутренний IP. Если терминал вдруг не
  резолвит — см. memory `macos-internal-tld-dns` (пиннинг `/etc/resolver/office.lan`).
- **GraphQL-эндпоинт:** `https://wplan.office.lan/ru-RU/api/graphql` (локаль в пути;
  есть `-hr` вариант). POST отвечает 200, WAF/фильтрации нет.

## Аутентификация (проверено, работает)

`mutation Login` → поле `jwtLogin`. Вкладка «Office.lan» на форме входа означает:
к логину дописывается `@office.lan`, `source = 1` (`Offilan`); «Иной домен» → `source = 2` (`Dc`).

```graphql
mutation Login($username:String!,$password:String!,$twoFactorCode:String,
               $accessToken2Fa:String,$code:String,$redirectUri:String,$source:Float){
  jwtLogin(username:$username,password:$password,twoFactorCode:$twoFactorCode,
           accessToken2Fa:$accessToken2Fa,code:$code,redirectUri:$redirectUri,source:$source){
    _id fio login accessToken role
  }
}
```

- Пример: **username = `<логин>@office.lan`, source = 1** (вкладка «Office.lan»).
- `twoFactorCode` и `accessToken2Fa` ОБЯЗАТЕЛЬНО слать как `""` (не null) — иначе BAD_USER_INPUT.
- 2FA на этом аккаунте на уровне API **не требуется** — `jwtLogin` сразу вернул `accessToken` (JWT ~560 симв.).
- Успех выставляет сессионную cookie `connect.sid`. Авторизация запросов идёт по cookie
  `connect.sid`; также можно слать `Authorization: Bearer <accessToken>`.
- Если на аккаунте включат 2FA: `jwtVerify` (mutation `VerifyTwoFactor`) с `twoFactorCode` + `accessToken2Fa`.
- Рефреш-токена во фронте нет — JWT/сессия имеют TTL, бот должен переавторизовываться (логин/пароль без 2FA это позволяет).

## Операции для бота

**Состояние дня (read):**
```graphql
query { startOrFinishDayButtonState { isVisible isStart } }
```
`isStart:true` → день НЕ начат (кнопка «Начать»). `isStart:false` → день ИДЁТ (кнопка «Завершить»).

**Начать / завершить день (одна мутация-переключатель):**
```graphql
mutation StartOrFinishDay($isStart:Boolean!){ startOrFinishDay(isStart:$isStart) }
```
`isStart:true` — начать, `isStart:false` — завершить.

**События/интервалы за дату (факт прихода-ухода):**
```graphql
query($d:String!){ workTimeEventsForDate(date:$d){ startTime endTime } }
query($d:String!){ personalIntervalsForDate(date:$d){ intervals{ id startTime endTime } } }
```

**Инфо о сотруднике (расписание, часы, таймзона):**
```graphql
query { workerStartInfo { workerId workingHours timeZoneIanaName timeZoneRus startWork
         schedule { id daysOff remoteDays } } }
```
workerId и таймзона приходят из API индивидуально для каждого сотрудника.

**Рабочий календарь (какие дни рабочие, норма часов):**
```graphql
query PersonalSchedulesMonth($month:String!,$workerId:Float!){
  personalSchedulesMonth(workerId:$workerId,month:$month){
    date dayType isHoliday isWithPersonalSchedule workTime } }
```

## Уже есть в продукте (учесть, чтобы не дублировать)

У WPlan есть собственный Telegram-бот и настройки напоминаний:
- `workerPreferences.botSubscriptions`: `WorkStartReminder`, `ExitReminder`,
  `UnfinishedShifts`, `LateArrivals` и др. + `botLanguage`, `chatid` у сотрудника.
- `mutation UpdateWorkStartReminderSettings(reminderTimeLocal, repeatCount, repeatFrequencyMinutes)`
- `mutation UpdateWorkEndReminderSettings(notificationCondition, repeatCount, repeatFrequencyMinutes)`
- `mutation ChangeBotSubscription(subscriptionName, isEnabled)`

→ Напоминания о старте/конце дня и о незавершённом дне штатный бот уже умеет.
**Уникальная ценность нашего бота** — то, чего в продукте НЕТ:
автостарт/автозавершение дня по команде из Telegram и **авто-закрытие дня за 5 мин
до конца** (чтобы день засчитался).
