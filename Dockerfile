FROM node:20-alpine AS backend
WORKDIR /app/backend
COPY backend/package*.json ./
#RUN npm ci
RUN npm install
COPY backend .

FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
#RUN npm ci
RUN npm install
COPY frontend .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=backend /app/backend ./backend
COPY --from=frontend /app/frontend/dist ./frontend
WORKDIR /app/backend
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
