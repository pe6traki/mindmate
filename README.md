# Bastun MindMate

AI-воден инструмент за изследване на тревогата, базиран на доказани терапевтични техники.

## Как работи

- Разговор с AI терапевт в реално време
- Без регистрация, без съхранение на данни на сървъра
- Сесиите се запазват локално като JSON файл при потребителя
- Работи на десктоп и мобилен браузър

## Структура

```
index.html              — главна страница
css/style.css           — стилове
js/app.js               — frontend логика
worker.js               — Cloudflare Worker (API proxy към Claude)
functions/api/chat.js   — алтернатива: Cloudflare Pages Function
_headers                — security headers
```

## Деплойване

### Вариант 1 — Cloudflare Pages + Worker (препоръчително)

**Стъпка 1: Създай Cloudflare Worker**

1. Влез в [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Worker**
2. Дай му име (напр. `mindmate-api`) → **Deploy**
3. **Edit code** → замени всичко със съдържанието на `worker.js` → **Save and deploy**
4. **Settings → Variables and Secrets** → добави:
   - Type: **Secret**
   - Name: `ANTHROPIC_API_KEY`
   - Value: твоя Anthropic API ключ
5. Запиши URL-а на Worker-а (напр. `https://mindmate-api.YOUR_NAME.workers.dev`)

**Стъпка 2: Обнови API URL в app.js**

В горната част на `js/app.js` намери константата:
```js
const API_URL = 'YOUR_WORKER_URL_HERE';
```
и смени с URL-а на твоя Worker.

**Стъпка 3: Деплойни статичните файлове**

Качи в Cloudflare Pages (или GitHub Pages, Netlify и т.н.) — само статични файлове, без `worker.js`.

---

### Вариант 2 — Всичко на Cloudflare Pages

1. Качи repo-то в Cloudflare Pages
2. В **Settings → Environment Variables** добави:
   - Name: `ANTHROPIC_API_KEY`
   - Value: твоят Anthropic API ключ
   - Маркирай като **Secret**
3. Deploy

## Поверителност

- Сървърът не записва разговори
- API ключът е само в Cloudflare environment, не в кода
- Кодът е публичен — всеки може да провери какво прави
