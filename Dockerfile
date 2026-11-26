FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY client/public ./client/public
ENV PORT=4000
ENV ADAQ_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 4000
WORKDIR /app/server
CMD ["node", "server.js"]
