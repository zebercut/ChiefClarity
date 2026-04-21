FROM node:20-slim

# Default timezone — override at runtime with -e TZ=America/Toronto
ENV TZ=America/Toronto

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8081 3099

CMD ["npx", "concurrently", "-k", "node scripts/api-proxy.js", "npx expo start --web --host 0.0.0.0"]
