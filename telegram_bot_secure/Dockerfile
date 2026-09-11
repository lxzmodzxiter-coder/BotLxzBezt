FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN addgroup --system bot && adduser --system --ingroup bot bot
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . ./telegram_bot_secure/
RUN chown -R bot:bot /app
USER bot

CMD ["python", "-m", "telegram_bot_secure.main"]
