FROM node:24.14.0-alpine
RUN apk add --no-cache git python3 py3-matplotlib
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
