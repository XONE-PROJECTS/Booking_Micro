FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build -w @universal-booking/api 2>/dev/null || true
EXPOSE 6767
CMD ["npm", "run", "dev", "-w", "@universal-booking/api"]