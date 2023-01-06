FROM lucas42/lucos_navbar:latest as navbar
FROM node:19-alpine

WORKDIR /usr/src/app
COPY package* ./
RUN npm install

RUN mkdir src
COPY src src/
COPY --from=navbar lucos_navbar.js src/resources/

ENV NODE_ENV production
EXPOSE $PORT
EXPOSE $WEBSOCKET_PORT

CMD [ "npm", "start" ]