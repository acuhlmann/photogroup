# Wake proxy — Cloud Run service that boots the GCE VM on demand
FROM node:24-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

USER nodejs
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/index.js"]
