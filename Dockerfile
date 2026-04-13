# Stage 1: install production dependencies
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Stage 2: production image
FROM node:22-alpine AS app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY services/candidate-chatbot/src ./services/candidate-chatbot/src
COPY services/candidate-chatbot/migrations ./services/candidate-chatbot/migrations
COPY services/hh-connector/src ./services/hh-connector/src
USER node
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "services/candidate-chatbot/src/index.js"]
