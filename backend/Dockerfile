FROM python:3.9-slim

WORKDIR /workspace

# Install system dependencies required for psycopg2 and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY backend/requirements.txt /workspace/backend/requirements.txt
RUN pip install --no-cache-dir -r /workspace/backend/requirements.txt

# Copy application source code and ML artifacts
COPY backend /workspace/backend
COPY ml /workspace/ml
COPY simulator /workspace/simulator
COPY edge /workspace/edge
COPY data /workspace/data

# Ensure project root is in PYTHONPATH
ENV PYTHONPATH=/workspace
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
