FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY dist ./dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "start"]
