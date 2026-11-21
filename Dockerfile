FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js gameEngine.js botEngine.js cardMetadata.json ./
COPY public ./public

EXPOSE 8080

CMD ["node", "server.js"]
