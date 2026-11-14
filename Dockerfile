# BookOasis 3D 서재 도커 이미지 - 설치 방법은 docs/install-docker.md
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# 브런치 낭독의 Edge 음성까지 (없어도 브라우저 음성으로 동작)
RUN pip install --no-cache-dir -r requirements.txt edge-tts
COPY . .

# 설정(.env)은 /app/.env로 마운트, 데이터는 /data (볼륨)
ENV DATA_DIR=/data WEB_HOST=0.0.0.0 WEB_PORT=5932 PYTHONUNBUFFERED=1 TZ=Asia/Seoul
VOLUME ["/data"]
EXPOSE 5932
STOPSIGNAL SIGTERM
CMD ["python", "app.py"]
