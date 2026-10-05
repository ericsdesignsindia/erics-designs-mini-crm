FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY assets/eric-rodgers-google-pay-qr.jpeg assets/erics-designs-crm-logo.png assets/jspdf.umd.min.js assets/payment-received-seal.svg assets/pdf-quotation-logo-clean.png assets/quotation-accepted-seal.svg assets/reference-document-logo.png assets/reference-payment-qr.png ./assets/
COPY *.js *.css *.html *.png *.svg site.webmanifest ./
RUN npm run build:dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "start"]
