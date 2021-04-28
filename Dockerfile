FROM node:16-alpine

WORKDIR /usr/src/app
COPY package* ./
RUN npm install

COPY . .

ENV NODE_ENV production
ENV PORT 8019
EXPOSE $PORT

CMD [ "npm", "start" ]