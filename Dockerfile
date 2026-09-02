FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY telegram_bot/requirements.txt /app/telegram_bot/requirements.txt
RUN pip install --no-cache-dir -r /app/telegram_bot/requirements.txt

COPY telegram_bot /app/telegram_bot

CMD ["python", "-m", "telegram_bot.main"]
