FROM python:3.12-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RECIPES_DIR=/recipes IMAGE_CACHE_DIR=/image-cache
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /image-cache \
    && chmod 0777 /image-cache
COPY app.py .
COPY static ./static
EXPOSE 8080
USER nobody
CMD ["python", "app.py"]
