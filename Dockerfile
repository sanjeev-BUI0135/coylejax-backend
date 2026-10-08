FROM node:18

RUN apt-get update && apt-get install -y chromium ca-certificates fonts-liberation \
    && ln -s /usr/bin/chromium /usr/bin/chromium-browser \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN npm install

EXPOSE 3001

CMD [ "npm", "start" ]
