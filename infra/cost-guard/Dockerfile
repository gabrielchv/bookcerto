FROM python:3.12-slim

# Stdlib only — no pip install step, so there is no dependency surface and no
# supply-chain step to review. See main.py for why the metadata server is used
# instead of google-auth.
WORKDIR /app
COPY main.py .

ENV PYTHONUNBUFFERED=1 \
    PORT=8080

RUN useradd --system --uid 1000 guard
USER guard

EXPOSE 8080
CMD ["python3", "main.py"]
