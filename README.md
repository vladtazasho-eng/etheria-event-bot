# Etheria Event Bot

Окремий Discord-бот для бібліотеки шаблонів івентів і фільмів, створення
анонсів, голосових каналів, Discord Scheduled Events та панелі ведучого.

## Команди

Для івентів:

- `/event create` — створити шаблон;
- `/event edit` — редагувати шаблон;
- `/event delete` — приховати шаблон зі списку;
- `/event list` — переглянути шаблони;
- `/event start` — обрати шаблон, дату, час і ведучого та створити подію;
- `/event cancel` — скасувати майбутню подію.

Для фільмів доступні такі самі підкоманди через `/movie`.

Голосовий канал створюється видимим, але закритим для підключення. За
`OPEN_BEFORE_MINUTES` до початку бот відкриває `Connect` для `@everyone`.
У запланований час бот автоматично переводить Discord-подію у статус «Триває».
Початковий ліміт користувачів — 0 (без обмежень).

Панель ведучого дозволяє:

- змінювати ліміт голосового каналу від 0 до 99;
- від'єднувати користувача та забороняти йому повторний вхід;
- один раз повторно пінгувати відповідну роль після початку;
- завершувати Discord-подію та видаляти голосовий канал.

## Локальний запуск

Потрібен Node.js 22.13 або новіший.

```bash
npm install
npm run register
npm run dev
```

Перед локальним запуском створіть `.env` і додайте до нього обов'язкові
змінні, перелічені нижче в розділі Railway.

`npm run register` потрібно виконувати після зміни структури slash-команд.

## Налаштування Discord

Боту потрібні права:

- View Channels;
- Manage Channels;
- Manage Roles;
- Create Events;
- Manage Events;
- Connect;
- Move Members;
- Send Messages;
- Embed Links;
- Attach Files;
- Read Message History;
- Manage Messages;
- Mention Everyone, якщо ролі для пінгу не позначені як mentionable.

Роль бота повинна бути вище ролей/користувачів, якими він керує.

## Railway

1. Створіть Railway Service з цього GitHub-репозиторію.
2. Додайте Railway Volume з mount path `/app/data`.
3. Додайте обов'язкові Service Variables:

   ```text
   DISCORD_TOKEN
   DISCORD_CLIENT_ID
   DISCORD_GUILD_ID
   ANNOUNCEMENT_CHANNEL_ID
   EVENT_PING_ROLE_ID
   MOVIE_PING_ROLE_ID
   EVENT_VOICE_CATEGORY_ID
   ```

   `OPEN_BEFORE_MINUTES` і `TIMEZONE` необов'язкові: стандартні значення —
   `40` та `Europe/Kyiv`. `DATA_DIR` на Railway додавати не потрібно:
   підключений Volume автоматично надає `RAILWAY_VOLUME_MOUNT_PATH`.
4. Build command: `npm run build`.
5. Start command: `npm start`.
6. Не вмикайте App Sleep/Serverless і не створюйте додаткові replicas.
7. Увімкніть Daily та Weekly backups для Volume.

На Railway база та медіа зберігаються тут:

```text
/app/data/event-bot.sqlite
/app/data/media/
```

SQLite-таблиці створюються автоматично під час першого запуску.
