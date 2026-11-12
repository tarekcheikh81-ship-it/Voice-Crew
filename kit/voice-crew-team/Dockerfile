FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server server
ENV PORT=8000 STATE_FILE=/data/state.json
VOLUME /data
WORKDIR /app/server
# Secrets (ANTHROPIC_API_KEY, CREW_KEY, the agent and environment IDs) come from the host's environment settings, never from the image.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
