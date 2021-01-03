FROM node:15-alpine

WORKDIR /usr/src/app
COPY package* ./
RUN npm install

COPY . .

ENV NODE_ENV production
EXPOSE $PORT

CMD [ "npm", "start" ]