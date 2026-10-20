FROM node:22-slim
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 TRUST_PROXY=1 COOKIE_SECURE=1
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
