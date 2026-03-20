FROM python:3.11-slim

WORKDIR /app

# Install poetry
RUN pip install poetry

# Copy dependency definitions
COPY pyproject.toml poetry.lock* ./

# Install dependencies without creating a virtual environment
RUN poetry config virtualenvs.create false \
    && poetry install --no-root --no-interaction

# Copy the application code (including the app folder)
COPY . ./

# Cloud Run sets the PORT environment variable to 8080 by default.
ENV PORT=8080
EXPOSE 8080

# Start the uvicorn server
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
