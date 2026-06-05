FROM node:22-alpine

WORKDIR /app

# Copy deploy directory contents (self-contained, no monorepo)
COPY deploy/package.json ./
COPY deploy/tsconfig.json ./
COPY deploy/src/ src/
COPY deploy/dashboard/ dashboard/

# Install and build in one step
RUN npm install --no-optional --no-audit --no-fund && npx tsc

EXPOSE 10000
ENV PORT=10000

CMD ["node", "dist/index.js"]