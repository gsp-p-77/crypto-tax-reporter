# --- Stage 1: build and dependencies ---
FROM node:22-slim AS base

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Ensure data directory exists inside container
RUN mkdir -p /app/data

# Expose the port (matches your Express app)
EXPOSE 3000

# Default command to start your app
CMD ["node", "index.js"]
