# ---- 1. app web (PWA)
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2. gateway (Java + ts3j)
FROM maven:3.9-eclipse-temurin-21 AS gateway
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY scripts/install-ts3j.sh /tmp/install-ts3j.sh
RUN sh /tmp/install-ts3j.sh
WORKDIR /gateway
COPY gateway/pom.xml ./
RUN mvn -q dependency:go-offline || true
COPY gateway/src ./src
RUN mvn -q package

# ---- 3. imagem final
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=gateway /gateway/target/gateway.jar ./gateway.jar
COPY --from=web /web/dist ./web
ENV PORT=8080 WEB_DIR=/app/web
EXPOSE 8080
CMD ["java", "-jar", "/app/gateway.jar"]
