# Friend Messenger

Простой веб-мессенджер для друзей.

## Что уже есть

- регистрация и вход
- JWT в httpOnly cookie, чтобы не разлогинивало после перезапуска вкладки
- аватар при регистрации
- личные чаты 1 на 1
- текстовые сообщения
- отправка по Enter
- время отправки и имя отправителя
- хранение истории в SQLite
- загрузка последних 100 сообщений
- картинки в чате
- realtime через WebSocket
- базовый индикатор онлайн/оффлайн
- HTTPS режим, если положить сертификаты
- базовый индикатор `печатает...`

## Стек

- Node.js
- Express
- WebSocket (`ws`)
- SQLite (`better-sqlite3`)
- bcrypt
- JWT
- multer
- чистый HTML/CSS/JS без фреймворка

## Запуск

```bash
npm install
npm start
```

По умолчанию приложение стартует на:

```bash
http://localhost:3000
```

## HTTPS

Сервер автоматически поднимет HTTPS, если задать пути к сертификату и ключу:

```bash
HTTPS_CERT_PATH=./certs/cert.pem HTTPS_KEY_PATH=./certs/key.pem npm start
```

Для локальной разработки можно сделать self-signed сертификат через OpenSSL:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 365
```

Тогда запуск:

```bash
HTTPS_CERT_PATH=./certs/cert.pem HTTPS_KEY_PATH=./certs/key.pem npm start
```

## Как открыть друзьям доступ

1. Открыть порт `3000` на роутере.
2. Пробросить его на свой ПК.
3. Лучше использовать домен или DDNS.
4. Лучше поставить Nginx/Caddy перед Node.js и уже там держать нормальный HTTPS.

## Важные ограничения текущего MVP

- нет восстановления пароля
- нет редактирования и удаления сообщений
- нет групповых чатов
- нет поиска
- нет браузерных push-уведомлений
- нет лимитов на частоту отправки сообщений
- картинки не ужимаются автоматически
- `secure: false` у cookie в коде по умолчанию для удобной локальной разработки

## Что лучше поменять перед реальным использованием

В `server.js`:

- поменять `JWT_SECRET`
- включить `secure: true` у cookie, когда запустишь через HTTPS
- добавить rate limiting
- добавить проверку расширений и ресайз картинок
- вынести статику и TLS в Nginx/Caddy
- сделать резервные копии `messenger.db`

## Структура

```text
friend-messenger/
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ uploads/
│  ├─ avatars/
│  └─ images/
├─ messenger.db          # создастся автоматически
├─ package.json
├─ server.js
└─ README.md
```


## Windows-friendly update

This build removes native modules (`better-sqlite3`, `bcrypt`) so it installs on Windows with Node 24 more easily. Data is stored in `data/messenger.json`.
